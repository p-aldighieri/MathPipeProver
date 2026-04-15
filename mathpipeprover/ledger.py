from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

TAG_PATTERN = re.compile(r"^\[(USER|LIT|DERIVED|CONJECTURE|SCOPE|ASSUMPTION\+|ASSUMPTION\-|BREAKDOWN_AMEND)\]\s+(.*)$")


@dataclass
class LedgerCounts:
    scope_changes: int = 0
    assumptions_added: int = 0
    assumptions_removed: int = 0


def extract_tagged_lines(markdown_text: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for line in markdown_text.splitlines():
        hit = TAG_PATTERN.match(line.strip())
        if hit:
            rows.append((hit.group(1), hit.group(2).strip()))
    return rows


def count_scope_assumptions(rows: list[tuple[str, str]]) -> LedgerCounts:
    counts = LedgerCounts()
    for tag, _ in rows:
        if tag == "SCOPE":
            counts.scope_changes += 1
        elif tag == "ASSUMPTION+":
            counts.assumptions_added += 1
        elif tag == "ASSUMPTION-":
            counts.assumptions_removed += 1
    return counts


def build_knowledge_ledger(branch_context_dir: Path) -> str:
    lines = ["# Knowledge Ledger", ""]
    for file_path in sorted(branch_context_dir.glob("*.md")):
        if file_path.name == "knowledge_ledger.md":
            continue
        text = file_path.read_text(encoding="utf-8")
        tagged = extract_tagged_lines(text)
        if not tagged:
            continue
        lines.append(f"## {file_path.name}")
        for tag, content in tagged:
            lines.append(f"- [{tag}] {content}")
        lines.append("")
    if len(lines) == 2:
        lines.append("No tagged evidence lines found yet.")
    return "\n".join(lines).rstrip() + "\n"
