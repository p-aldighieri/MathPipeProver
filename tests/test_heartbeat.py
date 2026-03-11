from __future__ import annotations

import json
from pathlib import Path
import threading
import time

from mathpipeprover.heartbeat import watch_heartbeat


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def test_watch_heartbeat_detects_completion_and_runs_notify_hook(tmp_path: Path) -> None:
    heartbeat_path = tmp_path / "response_heartbeat.json"
    response_path = tmp_path / "response.md"
    notify_path = tmp_path / "notify.txt"

    def writer() -> None:
        time.sleep(0.1)
        _write_json(
            heartbeat_path,
            {
                "status": "waiting_reply",
                "heartbeat_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "response_file": str(response_path),
                "chat_url": "https://chatgpt.com/c/example",
            },
        )
        time.sleep(0.15)
        response_path.write_text("## Response\nReady.\n", encoding="utf-8")
        _write_json(
            heartbeat_path,
            {
                "status": "completed",
                "heartbeat_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "response_file": str(response_path),
                "chat_url": "https://chatgpt.com/c/example",
            },
        )

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()

    result = watch_heartbeat(
        heartbeat_path=heartbeat_path,
        response_path=response_path,
        poll_seconds=0.05,
        stale_after_seconds=60.0,
        max_wait_seconds=5.0,
        notify_command=f"printf '%s' \"$MPP_HEARTBEAT_STATUS\" > {notify_path}",
    )

    thread.join(timeout=1.0)
    assert result.status == "completed"
    assert response_path.exists()
    assert notify_path.read_text(encoding="utf-8") == "completed"


def test_watch_heartbeat_detects_stale_worker(tmp_path: Path) -> None:
    heartbeat_path = tmp_path / "response_heartbeat.json"
    response_path = tmp_path / "response.md"
    _write_json(
        heartbeat_path,
        {
            "status": "waiting_reply",
            "heartbeat_at": "2000-01-01T00:00:00Z",
            "response_file": str(response_path),
        },
    )

    result = watch_heartbeat(
        heartbeat_path=heartbeat_path,
        response_path=response_path,
        poll_seconds=0.01,
        stale_after_seconds=0.01,
        max_wait_seconds=1.0,
    )

    assert result.status == "stale"
    assert "stale" in result.message
