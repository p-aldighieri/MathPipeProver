from __future__ import annotations

from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_markdown(role: str, body: str) -> str:
    body = body.strip()
    if not body:
        body = "(empty response)"
    return f"# {role.title()} Output\n\nGenerated: {now_iso()}\n\n{body}\n"
