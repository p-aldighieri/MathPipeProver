from __future__ import annotations

from pathlib import Path
import os


def _parse_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].strip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if value.startswith('"') and value.endswith('"') and len(value) >= 2:
        value = value[1:-1]
    elif value.startswith("'") and value.endswith("'") and len(value) >= 2:
        value = value[1:-1]
    return key, value


def load_dotenv(path: Path, override: bool = True) -> dict[str, str]:
    loaded: dict[str, str] = {}
    if not path.exists() or not path.is_file():
        return loaded

    text = path.read_text(encoding="utf-8", errors="replace")
    for raw_line in text.splitlines():
        parsed = _parse_line(raw_line)
        if not parsed:
            continue
        key, value = parsed
        if override or key not in os.environ:
            os.environ[key] = value
            loaded[key] = value
    return loaded
