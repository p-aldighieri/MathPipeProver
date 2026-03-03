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
