from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
import subprocess
import time
from typing import Any, Callable

from .config import WorkflowConfig
from .heartbeat import watch_heartbeat
from .orchestrator import RunResult, resume_run
from .storage import load_run_paths, read_json


@dataclass(frozen=True)
class PendingExternalAgentTask:
    run_id: str
    branch: str
    role: str
    run_dir: Path
    request_path: Path
    response_path: Path
    heartbeat_path: Path


@dataclass(frozen=True)
class SupervisorResult:
    run_id: str
    status: str
    run_dir: Path
    resumed_roles: int
    submit_launches: int


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def _append_supervisor_log(run_dir: Path, event: str, **fields: Any) -> None:
    payload = {"at": _now_iso(), "event": event, **fields}
    log_path = run_dir / "external_agent_supervisor.jsonl"
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def _response_ready(path: Path) -> bool:
    if not path.exists():
        return False
    return bool(path.read_text(encoding="utf-8", errors="replace").strip())


def _parse_iso8601(raw_value: str) -> datetime | None:
    value = raw_value.strip()
    if not value:
        return None
    if value.endswith("Z"):
        value = f"{value[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _inspect_heartbeat(heartbeat_path: Path, response_path: Path, stale_after_seconds: float) -> dict[str, Any]:
    if not heartbeat_path.exists():
        return {"status": "missing", "payload": {}}

    payload = json.loads(heartbeat_path.read_text(encoding="utf-8"))
    raw_status = str(payload.get("status", "")).strip() or "unknown"
    heartbeat_at = _parse_iso8601(str(payload.get("heartbeat_at", "")))
    stale = False
    if heartbeat_at and stale_after_seconds > 0 and raw_status in {"starting", "submitted", "waiting_reply"}:
        stale = (datetime.now(tz=UTC) - heartbeat_at).total_seconds() > stale_after_seconds

    if raw_status == "completed":
        status = "completed" if _response_ready(response_path) else "completed_missing_response"
    elif stale:
        status = "stale"
    else:
        status = raw_status

    return {"status": status, "payload": payload}


def _load_pending_task(run_id: str, config: WorkflowConfig, workspace_root: Path) -> tuple[Path, dict[str, Any], PendingExternalAgentTask | None]:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    state = read_json(paths.state_path)
    pending = state.get("pending_external_agent")
    if state.get("status") != "waiting_external_agent" or not pending:
        return paths.run_dir, state, None

    response_path = Path(str(pending["response_path"]))
    task = PendingExternalAgentTask(
        run_id=run_id,
        branch=str(pending["branch"]),
        role=str(pending["role"]),
        run_dir=paths.run_dir,
        request_path=response_path.with_name(f"{pending['role']}_request.md"),
        response_path=response_path,
        heartbeat_path=response_path.with_name(response_path.stem + "_heartbeat.json"),
    )
    return paths.run_dir, state, task


def _wait_for_handle(handle: Any, timeout_seconds: float = 5.0) -> None:
    if handle is None or not hasattr(handle, "wait"):
        return
    try:
        handle.wait(timeout=timeout_seconds)
    except Exception:
        return


def _terminate_handle(handle: Any) -> None:
    if handle is None:
        return
    if hasattr(handle, "poll") and handle.poll() is not None:
        return
    if hasattr(handle, "terminate"):
        try:
            handle.terminate()
        except Exception:
            return


def _build_real_submit_launcher(
    *,
    workspace_root: Path,
    project_url: str,
    cdp_url: str,
    poll_seconds: float,
    max_wait_seconds: float,
) -> Callable[[PendingExternalAgentTask], Any]:
    script_path = workspace_root / "scripts" / "chatgpt_browser_agent.sh"

    def launch(task: PendingExternalAgentTask) -> subprocess.Popen[str]:
        cmd = [
            str(script_path),
            "submit",
            "--project-url",
            project_url,
            "--request-file",
            str(task.request_path),
            "--response-file",
            str(task.response_path),
            "--heartbeat-json",
            str(task.heartbeat_path),
            "--poll-seconds",
            str(poll_seconds),
            "--max-wait-seconds",
            str(int(max_wait_seconds)),
        ]
        if cdp_url:
            cmd.extend(["--cdp-url", cdp_url])
        return subprocess.Popen(cmd, cwd=workspace_root)

    return launch


def supervise_external_agents(
    *,
    run_id: str,
    config: WorkflowConfig,
    workspace_root: Path,
    project_url: str,
    cdp_url: str = "",
    poll_seconds: float = 10.0,
    stale_after_seconds: float = 120.0,
    max_wait_seconds: float = 5400.0,
    notify: bool = False,
    notify_command: str = "",
    idle_poll_seconds: float = 1.0,
    max_submit_attempts: int = 3,
    submit_launcher: Callable[[PendingExternalAgentTask], Any] | None = None,
    resume_callback: Callable[[], RunResult] | None = None,
) -> SupervisorResult:
    launcher = submit_launcher or _build_real_submit_launcher(
        workspace_root=workspace_root,
        project_url=project_url,
        cdp_url=cdp_url,
        poll_seconds=poll_seconds,
        max_wait_seconds=max_wait_seconds,
    )
    resume_fn = resume_callback or (lambda: resume_run(run_id=run_id, config=config, workspace_root=workspace_root))
    submit_attempts: dict[str, int] = {}
    resumed_roles = 0
    submit_launches = 0

    while True:
        run_dir, state, task = _load_pending_task(run_id, config, workspace_root)
        state_status = str(state.get("status", ""))
        if state_status in {"complete", "failed"}:
            _append_supervisor_log(run_dir, "run_terminal", status=state_status)
            return SupervisorResult(
                run_id=run_id,
                status=state_status,
                run_dir=run_dir,
                resumed_roles=resumed_roles,
                submit_launches=submit_launches,
            )

        if task is None:
            time.sleep(idle_poll_seconds)
            continue

        task_key = str(task.response_path)
        _append_supervisor_log(run_dir, "task_pending", branch=task.branch, role=task.role, response_path=task_key)

        if _response_ready(task.response_path):
            _append_supervisor_log(run_dir, "resume_ready_response", branch=task.branch, role=task.role)
            result = resume_fn()
            resumed_roles += 1
            _append_supervisor_log(run_dir, "resume_completed", branch=task.branch, role=task.role, status=result.status)
            continue

        heartbeat = _inspect_heartbeat(task.heartbeat_path, task.response_path, stale_after_seconds)
        handle = None
        heartbeat_status = str(heartbeat["status"])

        if heartbeat_status not in {"starting", "submitted", "waiting_reply"}:
            attempt = submit_attempts.get(task_key, 0) + 1
            submit_attempts[task_key] = attempt
            if attempt > max_submit_attempts:
                _append_supervisor_log(
                    run_dir,
                    "submit_attempts_exhausted",
                    branch=task.branch,
                    role=task.role,
                    attempts=attempt - 1,
                    heartbeat_status=heartbeat_status,
                )
                raise RuntimeError(
                    f"Exceeded submit attempts for role={task.role} branch={task.branch} after heartbeat status={heartbeat_status}"
                )

            if task.heartbeat_path.exists():
                task.heartbeat_path.unlink()
                _append_supervisor_log(
                    run_dir,
                    "heartbeat_reset",
                    branch=task.branch,
                    role=task.role,
                    previous_heartbeat_status=heartbeat_status,
                )

            _append_supervisor_log(
                run_dir,
                "submit_launch",
                branch=task.branch,
                role=task.role,
                attempt=attempt,
                heartbeat_status=heartbeat_status,
            )
            handle = launcher(task)
            submit_launches += 1
        else:
            _append_supervisor_log(
                run_dir,
                "watch_existing_heartbeat",
                branch=task.branch,
                role=task.role,
                heartbeat_status=heartbeat_status,
            )

        watch_result = watch_heartbeat(
            heartbeat_path=task.heartbeat_path,
            response_path=task.response_path,
            poll_seconds=poll_seconds,
            stale_after_seconds=stale_after_seconds,
            max_wait_seconds=max_wait_seconds,
            notify=notify,
            notify_command=notify_command,
        )
        _append_supervisor_log(
            run_dir,
            "heartbeat_terminal",
            branch=task.branch,
            role=task.role,
            heartbeat_status=watch_result.status,
            message=watch_result.message,
        )

        if watch_result.status == "completed":
            _wait_for_handle(handle)
            result = resume_fn()
            resumed_roles += 1
            _append_supervisor_log(run_dir, "resume_completed", branch=task.branch, role=task.role, status=result.status)
            continue

        _terminate_handle(handle)
        if watch_result.status in {"stale", "timeout", "error"}:
            continue

        raise RuntimeError(f"Unexpected heartbeat terminal status: {watch_result.status}")
