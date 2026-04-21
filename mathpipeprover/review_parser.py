from __future__ import annotations

import json
import re
from dataclasses import dataclass


_REVIEW_CONTROL_BLOCK = re.compile(r"```review_control\s*(.*?)```", re.IGNORECASE | re.DOTALL)

# Reviewer verdict levels, ordered by severity (ascending).
VERDICT_LEVELS = ("PASS", "PATCH_SMALL", "PATCH_BIG", "REDO")
_VERDICT_LINE = re.compile(
    r"^\s*(?:#+\s*)?(?:VERDICT|verdict)\s*[:=]\s*(PASS|PATCH_SMALL|PATCH_BIG|REDO|FAIL)\b",
    re.MULTILINE,
)
_VERDICT_STANDALONE = re.compile(r"^\s*(?:#+\s*)?(PASS|PATCH_SMALL|PATCH_BIG|REDO|FAIL)\s*$", re.MULTILINE)


@dataclass
class ReviewVerdict:
    level: str  # PASS | PATCH_SMALL | PATCH_BIG | REDO
    raw_output: str

    @property
    def is_pass(self) -> bool:
        return self.level == "PASS"

    @property
    def needs_small_fix(self) -> bool:
        return self.level == "PATCH_SMALL"

    @property
    def needs_big_fix(self) -> bool:
        return self.level == "PATCH_BIG"

    @property
    def needs_redo(self) -> bool:
        return self.level == "REDO"


def _strip_fenced_code(text: str) -> str:
    stripped = (text or "").strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        lines = stripped.splitlines()
        if len(lines) >= 3:
            return "\n".join(lines[1:-1]).strip()
    return stripped


def _extract_json_candidate(text: str) -> str | None:
    cleaned = _strip_fenced_code(text)
    if not cleaned:
        return None

    if cleaned.startswith("{") and cleaned.endswith("}"):
        return cleaned

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        return cleaned[start : end + 1]
    return None


def parse_review_control(text: str) -> dict[str, str]:
    match = _REVIEW_CONTROL_BLOCK.search(text or "")
    if not match:
        return {}

    payload: dict[str, str] = {}
    for raw_line in match.group(1).splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        payload[key.strip().lower()] = value.strip()
    return payload


def parse_review_verdict(text: str) -> ReviewVerdict:
    """Parse reviewer output for a structured verdict line.

    Looks for:
      VERDICT: PASS / PATCH_SMALL / PATCH_BIG / REDO
    or a standalone line with the verdict keyword.
    Falls back to legacy PASS/FAIL detection for backwards compatibility.
    """
    raw_text = text or ""

    control = parse_review_control(raw_text)
    verdict_from_control = control.get("verdict", "").strip().upper()
    if verdict_from_control == "FAIL":
        verdict_from_control = "REDO"
    if verdict_from_control in VERDICT_LEVELS:
        return ReviewVerdict(level=verdict_from_control, raw_output=text)

    # Try structured format first: "VERDICT: LEVEL", optionally prefixed by markdown headings.
    match = _VERDICT_LINE.search(raw_text)
    if match:
        level = match.group(1).strip().upper()
        if level == "FAIL":
            level = "REDO"
        if level in VERDICT_LEVELS:
            return ReviewVerdict(level=level, raw_output=text)

    # Try JSON format: {"verdict": "PASS"}
    candidate = _extract_json_candidate(raw_text)
    if candidate:
        try:
            payload = json.loads(candidate)
            if isinstance(payload, dict):
                for key in ("verdict", "level", "result"):
                    val = payload.get(key)
                    if isinstance(val, str) and val.strip().upper() in VERDICT_LEVELS:
                        return ReviewVerdict(level=val.strip().upper(), raw_output=text)
        except json.JSONDecodeError:
            pass

    # Try standalone line: just "PASS" or "REDO" etc. on its own line
    match = _VERDICT_STANDALONE.search(raw_text)
    if match:
        level = match.group(1).strip().upper()
        if level == "FAIL":
            level = "REDO"
        if level in VERDICT_LEVELS:
            return ReviewVerdict(level=level, raw_output=text)

    # Fallback: search for keywords anywhere (legacy compat)
    first_lines = "\n".join(raw_text.splitlines()[:8]).upper()
    for level in ("PATCH_BIG", "PATCH_SMALL", "REDO", "PASS", "FAIL"):
        if re.search(rf"\b{re.escape(level)}\b", first_lines):
            normalized = "REDO" if level == "FAIL" else level
            if normalized in VERDICT_LEVELS:
                return ReviewVerdict(level=normalized, raw_output=text)

    # Default to REDO if we can't determine
    return ReviewVerdict(level="REDO", raw_output=text)
