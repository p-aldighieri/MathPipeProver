from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import json
import re


@dataclass
class RunPaths:
    root: Path
    run_dir: Path
    state_path: Path


def make_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"run_{stamp}_{os.getpid()}"


def init_run_dir(root: Path, run_id: str) -> RunPaths:
    run_dir = root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "branches").mkdir()
    return RunPaths(root=root, run_dir=run_dir, state_path=run_dir / "run_state.json")


def load_run_paths(root: Path, run_id: str) -> RunPaths:
    run_dir = root / run_id
    if not run_dir.exists():
        raise FileNotFoundError(f"Run '{run_id}' does not exist under {root}")
    return RunPaths(root=root, run_dir=run_dir, state_path=run_dir / "run_state.json")


def write_json(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sanitize_name(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._-")
    return safe or "branch"
