from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
import subprocess
import time
from typing import Any


ACTIVE_HEARTBEAT_STATUSES = {"starting", "submitted", "waiting_reply"}


def _parse_iso8601(value: str) -> datetime | None:
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.endswith("Z"):
        cleaned = f"{cleaned[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _now_utc() -> datetime:
    return datetime.now(tz=UTC)


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Heartbeat file must contain a JSON object: {path}")
    return data


def _response_ready(response_path: Path | None) -> bool:
    if response_path is None or not response_path.exists():
        return False
    return bool(response_path.read_text(encoding="utf-8", errors="replace").strip())


@dataclass(frozen=True)
class HeartbeatWatchResult:
    status: str
    message: str
    heartbeat_path: Path
    response_path: Path | None
    payload: dict[str, Any]


def _notify(
    *,
    enabled: bool,
    notify_command: str,
    title: str,
    message: str,
    payload: dict[str, Any],
    heartbeat_path: Path,
    response_path: Path | None,
) -> None:
    if not enabled and not notify_command:
        return

    env = os.environ.copy()
    env.update(
        {
            "MPP_HEARTBEAT_STATUS": str(payload.get("status", "")),
            "MPP_HEARTBEAT_FILE": str(heartbeat_path),
            "MPP_RESPONSE_FILE": str(response_path) if response_path else "",
            "MPP_HEARTBEAT_CHAT_URL": str(payload.get("chat_url", "")),
            "MPP_HEARTBEAT_MESSAGE": message,
        }
    )

    if notify_command:
        subprocess.run(notify_command, shell=True, check=True, env=env)

    if enabled and os.uname().sysname == "Darwin":
        escaped_title = title.replace('"', '\\"')
        escaped_message = message.replace('"', '\\"')
        script = f'display notification "{escaped_message}" with title "{escaped_title}"'
        subprocess.run(["osascript", "-e", script], check=True, env=env)


def watch_heartbeat(
    *,
    heartbeat_path: Path,
    response_path: Path | None = None,
    poll_seconds: float = 10.0,
    stale_after_seconds: float = 120.0,
    max_wait_seconds: float | None = None,
    notify: bool = False,
    notify_command: str = "",
) -> HeartbeatWatchResult:
    start_monotonic = time.monotonic()
    last_status: str | None = None
    last_payload: dict[str, Any] = {}

    while True:
        payload = _load_json(heartbeat_path)
        if payload:
            last_payload = payload
            status = str(payload.get("status", "")).strip() or "unknown"
            last_status = status
            response_candidate = response_path
            if response_candidate is None:
                raw_response = str(payload.get("response_file", "")).strip()
                response_candidate = Path(raw_response) if raw_response else None

            if status == "completed":
                if _response_ready(response_candidate):
                    message = "Heartbeat completed and response file is ready."
                    _notify(
                        enabled=notify,
                        notify_command=notify_command,
                        title="MathPipeProver heartbeat completed",
                        message=message,
                        payload=payload,
                        heartbeat_path=heartbeat_path,
                        response_path=response_candidate,
                    )
                    return HeartbeatWatchResult(
                        status="completed",
                        message=message,
                        heartbeat_path=heartbeat_path,
                        response_path=response_candidate,
                        payload=payload,
                    )
                status = "completed_missing_response"

            if status == "error":
                message = str(payload.get("error", "Heartbeat reported an error."))
                _notify(
                    enabled=notify,
                    notify_command=notify_command,
                    title="MathPipeProver heartbeat error",
                    message=message,
                    payload=payload,
                    heartbeat_path=heartbeat_path,
                    response_path=response_candidate,
                )
                return HeartbeatWatchResult(
                    status="error",
                    message=message,
                    heartbeat_path=heartbeat_path,
                    response_path=response_candidate,
                    payload=payload,
                )

            if status in ACTIVE_HEARTBEAT_STATUSES or status == "completed_missing_response":
                heartbeat_at = _parse_iso8601(str(payload.get("heartbeat_at", "")))
                if heartbeat_at and stale_after_seconds > 0:
                    age_seconds = (_now_utc() - heartbeat_at).total_seconds()
                    if age_seconds > stale_after_seconds:
                        message = f"Heartbeat is stale ({age_seconds:.1f}s old) while status={status}."
                        stale_payload = dict(payload)
                        stale_payload["status"] = "stale"
                        _notify(
                            enabled=notify,
                            notify_command=notify_command,
                            title="MathPipeProver heartbeat stale",
                            message=message,
                            payload=stale_payload,
                            heartbeat_path=heartbeat_path,
                            response_path=response_candidate,
                        )
                        return HeartbeatWatchResult(
                            status="stale",
                            message=message,
                            heartbeat_path=heartbeat_path,
                            response_path=response_candidate,
                            payload=stale_payload,
                        )

        elapsed_seconds = time.monotonic() - start_monotonic
        if max_wait_seconds is not None and max_wait_seconds > 0 and elapsed_seconds > max_wait_seconds:
            message = f"Timed out after {elapsed_seconds:.1f}s waiting for heartbeat completion."
            timeout_payload = dict(last_payload)
            timeout_payload["status"] = "timeout"
            if not timeout_payload.get("heartbeat_at"):
                timeout_payload["heartbeat_at"] = _now_utc().isoformat().replace("+00:00", "Z")
            _notify(
                enabled=notify,
                notify_command=notify_command,
                title="MathPipeProver heartbeat timeout",
                message=message,
                payload=timeout_payload,
                heartbeat_path=heartbeat_path,
                response_path=response_path,
            )
            return HeartbeatWatchResult(
                status="timeout",
                message=message,
                heartbeat_path=heartbeat_path,
                response_path=response_path,
                payload=timeout_payload,
            )

        if last_status is None and not heartbeat_path.exists():
            time.sleep(poll_seconds)
            continue

        time.sleep(poll_seconds)


def format_watch_result(result: HeartbeatWatchResult) -> str:
    response_text = str(result.response_path) if result.response_path else ""
    return (
        f"status={result.status}\n"
        f"message={result.message}\n"
        f"heartbeat={result.heartbeat_path}\n"
        f"response={response_text}\n"
    )
