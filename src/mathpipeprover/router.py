from __future__ import annotations

from dataclasses import dataclass
import json
import re


NEXT_TAG_PATTERN = re.compile(r"\[NEXT:([A-Z_]+)\]")


@dataclass
class RouterDecision:
    selected: str
    raw_output: str
    used_fallback: bool


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


def parse_next_from_json(text: str) -> str | None:
    candidate = _extract_json_candidate(text)
    if not candidate:
        return None
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    keys = ("next", "next_tag", "decision")
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            normalized = value.strip().upper()
            if normalized.startswith("NEXT:"):
                normalized = normalized.split("NEXT:", 1)[1].strip()
            return normalized.strip("[] ")
    return None


def parse_next_tag(text: str) -> str | None:
    hit = NEXT_TAG_PATTERN.search(text or "")
    if not hit:
        return None
    return hit.group(1)


def choose_router_decision(raw_output: str, allowed_tags: list[str], fallback_tag: str) -> RouterDecision:
    parsed = parse_next_from_json(raw_output) or parse_next_tag(raw_output)
    if parsed and parsed in allowed_tags:
        return RouterDecision(selected=parsed, raw_output=raw_output, used_fallback=False)
    return RouterDecision(selected=fallback_tag, raw_output=raw_output, used_fallback=True)
