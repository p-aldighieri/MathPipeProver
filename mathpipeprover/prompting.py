from __future__ import annotations

from pathlib import Path
import re


def load_prompt_template(prompts_root: Path, name: str, fallback: str) -> str:
    path = _find_prompt_template_path(prompts_root, name)
    if path is not None:
        return _read_template_with_includes(path)
    return fallback


def render_template(template: str, values: dict[str, str]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{" + key + "}", value)
    return rendered


def bundle_markdown(files: list[tuple[str, str]], max_chars_per_file: int = 5000) -> str:
    if not files:
        return "(no readable markdown files)"

    del max_chars_per_file  # Compatibility only. Role context is never truncated.
    lines: list[str] = []
    for rel_path, content in files:
        lines.append(f"## FILE: {rel_path}\n\n{content.strip()}\n")
    return "\n".join(lines).strip() + "\n"


# Per-role priority: files listed first are loaded first and grouped as primary
# context. Files listed second are also loaded in full, but grouped separately
# so the packet keeps a stable structure without truncating content.
ROLE_CONTEXT_PRIORITY: dict[str, dict[str, list[str]]] = {
    "formalizer": {
        "full": ["claim.md"],
        "secondary": [],
    },
    "literature": {
        "full": ["claim.md", "*/context/formalizer.md"],
        "secondary": [],
    },
    "searcher": {
        "full": ["claim.md", "*/context/formalizer.md", "*/context/literature.md"],
        "secondary": [],
    },
    "breakdown": {
        "full": ["*/context/formalizer.md", "*/context/strategy.md"],
        "secondary": [],
    },
    "prover": {
        "full": [
            "*/context/formalizer.md",
            "*/context/breakdown.md",
            "*/context/breakdown_amendments.md",
        ],
        "secondary": [
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
        "secondary": [
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
        "secondary": [
            "*/context/reviewer_*.md",
            "*/context/strategy.md",
        ],
    },
    "scope_keeper": {
        "full": [
            "*/context/assumption_delta.md",
            "*/context/scope_decision.md",
        ],
        "secondary": ["*/context/formalizer.md"],
    },
}


def _matches_any_pattern(rel_path: str, patterns: list[str]) -> bool:
    from fnmatch import fnmatch
    return any(fnmatch(rel_path, p) for p in patterns)


_INCLUDE_PATTERN = re.compile(r"{{include:([^}]+)}}")


def _find_prompt_template_path(prompts_root: Path, name: str) -> Path | None:
    direct = prompts_root / f"{name}.md"
    if direct.exists():
        return direct

    # Suffix-by-folder convention: e.g. prompts/soft/01_formalizer_soft.md
    # The variant ("soft", "api", ...) is taken from the parent folder name.
    variant = prompts_root.name
    suffixed = sorted(prompts_root.glob(f"[0-9][0-9]_{name}_{variant}.md"))
    if suffixed:
        return suffixed[0]

    # Legacy: numbered files without a variant suffix.
    numbered = sorted(prompts_root.glob(f"[0-9][0-9]_{name}.md"))
    if numbered:
        return numbered[0]
    return None


def _read_template_with_includes(path: Path, seen: set[Path] | None = None) -> str:
    seen = seen or set()
    resolved = path.resolve()
    if resolved in seen:
        raise ValueError(f"Prompt include cycle detected at {path}")
    seen.add(resolved)

    text = path.read_text(encoding="utf-8")

    def replace(match: re.Match[str]) -> str:
        include_target = match.group(1).strip()
        include_path = (path.parent / include_target).resolve()
        if not include_path.exists():
            raise FileNotFoundError(f"Prompt include not found: {include_path}")
        return _read_template_with_includes(include_path, seen.copy()).rstrip()

    return _INCLUDE_PATTERN.sub(replace, text)

def build_role_context(
    role: str,
    files: list[tuple[str, str]],
    max_chars_per_file: int = 5000,
) -> str:
    """Build a curated context bundle for a specific role.

    - Priority files: included in full
    - Secondary files: included in full
    - Other readable files: listed as manifest only (name + size)
    """
    del max_chars_per_file  # Compatibility only. Role context is never truncated.
    priorities = ROLE_CONTEXT_PRIORITY.get(role, {"full": [], "secondary": []})
    full_patterns = priorities["full"]
    secondary_patterns = priorities["secondary"]

    full_files: list[tuple[str, str]] = []
    secondary_files: list[tuple[str, str]] = []
    manifest_files: list[tuple[str, int]] = []

    for rel_path, content in files:
        if _matches_any_pattern(rel_path, full_patterns):
            full_files.append((rel_path, content))
        elif _matches_any_pattern(rel_path, secondary_patterns):
            secondary_files.append((rel_path, content))
        else:
            manifest_files.append((rel_path, len(content)))

    sections: list[str] = []

    if full_files:
        for rel_path, body in full_files:
            sections.append(f"## FILE: {rel_path}\n\n{body.strip()}\n")

    if secondary_files:
        sections.append("---\n## ADDITIONAL LOADED FILES\n")
        for rel_path, body in secondary_files:
            sections.append(f"### {rel_path}\n\n{body.strip()}\n")

    if manifest_files:
        manifest_lines = ["---", "## OTHER AVAILABLE FILES (not loaded; request by name if needed)", ""]
        for rel_path, size in manifest_files:
            manifest_lines.append(f"- `{rel_path}` ({size} chars)")
        sections.append("\n".join(manifest_lines) + "\n")

    if not sections:
        return "(no readable files for this role)"

    return "\n".join(sections).strip() + "\n"
