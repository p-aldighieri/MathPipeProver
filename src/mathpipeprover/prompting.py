from __future__ import annotations

from pathlib import Path


def load_prompt_template(prompts_root: Path, name: str, fallback: str) -> str:
    path = prompts_root / f"{name}.md"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return fallback


def render_template(template: str, values: dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{" + key + "}", value)
    return rendered


def bundle_markdown(files: list[tuple[str, str]], max_chars_per_file: int = 5000) -> str:
    if not files:
        return "(no readable markdown files)"

    lines: list[str] = []
    for rel_path, content in files:
        body = content
        if len(body) > max_chars_per_file:
            body = body[:max_chars_per_file] + "\n\n[TRUNCATED]"
        lines.append(f"## FILE: {rel_path}\n\n{body.strip()}\n")
    return "\n".join(lines).strip() + "\n"


# Per-role priority: files listed first are always included in full,
# files listed second are included as summaries (first 60 lines),
# everything else appears only as a file manifest line.
ROLE_CONTEXT_PRIORITY: dict[str, dict[str, list[str]]] = {
    "formalizer": {
        "full": ["claim.md"],
        "summary": [],
    },
    "literature": {
        "full": ["claim.md", "*/context/formalizer.md"],
        "summary": [],
    },
    "searcher": {
        "full": ["claim.md", "*/context/formalizer.md"],
        "summary": ["*/context/literature.md"],
    },
    "breakdown": {
        "full": ["*/context/formalizer.md", "*/context/strategy.md"],
        "summary": [],
    },
    "prover": {
        "full": [
            "*/context/formalizer.md",
            "*/context/breakdown.md",
            "*/context/breakdown_amendments.md",
        ],
        "summary": [
            "*/context/strategy.md",
            "*/context/reviewer_*.md",
        ],
    },
    "reviewer": {
        "full": [
            "*/context/formalizer.md",
            "*/context/breakdown.md",
            "*/context/prover_*.md",
        ],
        "summary": [
            "*/context/strategy.md",
            "*/context/assumption_delta.md",
        ],
    },
    "consolidator": {
        "full": [
            "claim.md",
            "*/context/formalizer.md",
            "*/context/breakdown.md",
            "*/context/prover_*.md",
            "*/context/knowledge_ledger.md",
        ],
        "summary": [
            "*/context/reviewer_*.md",
            "*/context/strategy.md",
        ],
    },
    "scope_keeper": {
        "full": [
            "*/context/assumption_delta.md",
            "*/context/scope_decision.md",
        ],
        "summary": ["*/context/formalizer.md"],
    },
}


def _matches_any_pattern(rel_path: str, patterns: list[str]) -> bool:
    from fnmatch import fnmatch
    return any(fnmatch(rel_path, p) for p in patterns)


def _summarize_file(content: str, max_lines: int = 60) -> str:
    lines = content.splitlines()
    if len(lines) <= max_lines:
        return content
    return "\n".join(lines[:max_lines]) + f"\n\n[... {len(lines) - max_lines} more lines omitted ...]"


def build_role_context(
    role: str,
    files: list[tuple[str, str]],
    max_chars_per_file: int = 5000,
) -> str:
    """Build a curated context bundle for a specific role.

    - Priority files: included in full
    - Summary files: first ~60 lines
    - Other readable files: listed as manifest only (name + size)
    """
    priorities = ROLE_CONTEXT_PRIORITY.get(role, {"full": [], "summary": []})
    full_patterns = priorities["full"]
    summary_patterns = priorities["summary"]

    full_files: list[tuple[str, str]] = []
    summary_files: list[tuple[str, str]] = []
    manifest_files: list[tuple[str, int]] = []

    for rel_path, content in files:
        if _matches_any_pattern(rel_path, full_patterns):
            body = content
            if len(body) > max_chars_per_file:
                body = body[:max_chars_per_file] + "\n\n[TRUNCATED]"
            full_files.append((rel_path, body))
        elif _matches_any_pattern(rel_path, summary_patterns):
            summary_files.append((rel_path, _summarize_file(content)))
        else:
            manifest_files.append((rel_path, len(content)))

    sections: list[str] = []

    if full_files:
        for rel_path, body in full_files:
            sections.append(f"## FILE: {rel_path}\n\n{body.strip()}\n")

    if summary_files:
        sections.append("---\n## SUMMARIES (truncated; full content available on request)\n")
        for rel_path, body in summary_files:
            sections.append(f"### {rel_path}\n\n{body.strip()}\n")

    if manifest_files:
        manifest_lines = ["---", "## OTHER AVAILABLE FILES (not loaded; request by name if needed)", ""]
        for rel_path, size in manifest_files:
            manifest_lines.append(f"- `{rel_path}` ({size} chars)")
        sections.append("\n".join(manifest_lines) + "\n")

    if not sections:
        return "(no readable files for this role)"

    return "\n".join(sections).strip() + "\n"
