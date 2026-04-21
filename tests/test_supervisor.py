from __future__ import annotations

from datetime import UTC, datetime
import json
from pathlib import Path
import threading
import time

from mathpipeprover.config import WorkflowConfig, load_config
from mathpipeprover.orchestrator import RunResult
from mathpipeprover.supervisor import (
    PendingExternalAgentTask,
    detached_supervisor_status,
    launch_detached_supervisor,
    supervise_external_agents,
)


class _FakeHandle:
    def __init__(self) -> None:
        self._done = False
        self._terminated = False

    def mark_done(self) -> None:
        self._done = True

    def poll(self) -> int | None:
        if self._terminated:
            return -15
        return 0 if self._done else None

    def wait(self, timeout: float | None = None) -> int:
        deadline = time.monotonic() + (timeout or 1.0)
        while self.poll() is None and time.monotonic() < deadline:
            time.sleep(0.01)
        return 0 if self.poll() is not None else -1

    def terminate(self) -> None:
        self._terminated = True


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _write_run_state(run_dir: Path, payload: dict[str, object]) -> None:
    (run_dir / "run_state.json").write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _config(tmp_path: Path) -> tuple[Path, WorkflowConfig]:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
router_enabled = false

[providers]
browser_agent = "external_agent"
""",
        encoding="utf-8",
    )
    return config_path, load_config(config_path)


def test_supervisor_launches_submit_and_resumes(tmp_path: Path) -> None:
    _, config = _config(tmp_path)
    run_dir = tmp_path / "runs" / "run_test"
    ext_dir = run_dir / "branches" / "main" / "external_agent"
    ext_dir.mkdir(parents=True)

    request_path = ext_dir / "prover_request.md"
    response_path = ext_dir / "prover_response.md"
    heartbeat_path = ext_dir / "prover_response_heartbeat.json"
    request_path.write_text("# Request\n", encoding="utf-8")
    _write_run_state(
        run_dir,
        {
            "run_id": "run_test",
            "status": "waiting_external_agent",
            "current_phase": "waiting_external_agent:main:prover",
            "pending_external_agent": {
                "branch": "main",
                "role": "prover",
                "response_path": str(response_path),
            },
        },
    )

    launch_count = {"value": 0}

    def launcher(task: PendingExternalAgentTask) -> _FakeHandle:
        launch_count["value"] += 1
        handle = _FakeHandle()

        def writer() -> None:
            time.sleep(0.05)
            _write_json(
                heartbeat_path,
                {
                    "status": "waiting_reply",
                    "heartbeat_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
                    "response_file": str(response_path),
                },
            )
            time.sleep(0.05)
            response_path.write_text("## Response\nDone.\n", encoding="utf-8")
            _write_json(
                heartbeat_path,
                {
                    "status": "completed",
                    "heartbeat_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
                    "response_file": str(response_path),
                },
            )
            handle.mark_done()

        threading.Thread(target=writer, daemon=True).start()
        return handle

    resume_count = {"value": 0}

    def resume_callback() -> RunResult:
        resume_count["value"] += 1
        _write_run_state(
            run_dir,
            {
                "run_id": "run_test",
                "status": "complete",
                "current_phase": "done",
            },
        )
        return RunResult(run_id="run_test", run_dir=run_dir, status="complete")

    result = supervise_external_agents(
        run_id="run_test",
        config=config,
        workspace_root=tmp_path,
        project_url="https://chatgpt.example/project",
        poll_seconds=0.02,
        stale_after_seconds=1.0,
        max_wait_seconds=2.0,
        idle_poll_seconds=0.01,
        max_submit_attempts=1,
        submit_launcher=launcher,
        resume_callback=resume_callback,
    )

    assert result.status == "complete"
    assert result.resumed_roles == 1
    assert result.submit_launches == 1
    assert launch_count["value"] == 1
    assert resume_count["value"] == 1


def test_supervisor_relaunches_after_stale_heartbeat(tmp_path: Path) -> None:
    _, config = _config(tmp_path)
    run_dir = tmp_path / "runs" / "run_retry"
    ext_dir = run_dir / "branches" / "main" / "external_agent"
    ext_dir.mkdir(parents=True)

    request_path = ext_dir / "reviewer_request.md"
    response_path = ext_dir / "reviewer_response.md"
    heartbeat_path = ext_dir / "reviewer_response_heartbeat.json"
    request_path.write_text("# Request\n", encoding="utf-8")
    _write_json(
        heartbeat_path,
        {
            "status": "waiting_reply",
            "heartbeat_at": "2000-01-01T00:00:00Z",
            "response_file": str(response_path),
        },
    )
    _write_run_state(
        run_dir,
        {
            "run_id": "run_retry",
            "status": "waiting_external_agent",
            "current_phase": "waiting_external_agent:main:reviewer",
            "pending_external_agent": {
                "branch": "main",
                "role": "reviewer",
                "response_path": str(response_path),
            },
        },
    )

    launch_count = {"value": 0}

    def launcher(task: PendingExternalAgentTask) -> _FakeHandle:
        launch_count["value"] += 1
        handle = _FakeHandle()

        def writer() -> None:
            time.sleep(0.05)
            _write_json(
                heartbeat_path,
                {
                    "status": "submitted",
                    "heartbeat_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
                    "response_file": str(response_path),
                },
            )
            time.sleep(0.05)
            response_path.write_text("## Review\nReady.\n", encoding="utf-8")
            _write_json(
                heartbeat_path,
                {
                    "status": "completed",
                    "heartbeat_at": datetime.now(tz=UTC).isoformat().replace("+00:00", "Z"),
                    "response_file": str(response_path),
                },
            )
            handle.mark_done()

        threading.Thread(target=writer, daemon=True).start()
        return handle

    def resume_callback() -> RunResult:
        _write_run_state(
            run_dir,
            {
                "run_id": "run_retry",
                "status": "complete",
                "current_phase": "done",
            },
        )
        return RunResult(run_id="run_retry", run_dir=run_dir, status="complete")

    result = supervise_external_agents(
        run_id="run_retry",
        config=config,
        workspace_root=tmp_path,
        project_url="https://chatgpt.example/project",
        poll_seconds=0.02,
        stale_after_seconds=0.2,
        max_wait_seconds=2.0,
        idle_poll_seconds=0.01,
        max_submit_attempts=2,
        submit_launcher=launcher,
        resume_callback=resume_callback,
    )

    assert result.status == "complete"
    assert result.resumed_roles == 1
    assert result.submit_launches == 1
    assert launch_count["value"] == 1


class _FakePopen:
    def __init__(self, cmd: list[str], **_: object) -> None:
        self.cmd = cmd
        self.pid = 424242


def test_launch_detached_supervisor_writes_runtime_metadata(tmp_path: Path, monkeypatch) -> None:
    config_path, config = _config(tmp_path)
    run_dir = tmp_path / config.run_root / "run_detached"
    run_dir.mkdir(parents=True)
    _write_run_state(run_dir, {"run_id": "run_detached", "status": "waiting_external_agent"})

    captured: dict[str, object] = {}

    def fake_popen(cmd: list[str], **kwargs: object) -> _FakePopen:
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return _FakePopen(cmd, **kwargs)

    monkeypatch.setattr("mathpipeprover.supervisor.subprocess.Popen", fake_popen)
    monkeypatch.setattr("mathpipeprover.supervisor._pid_is_alive", lambda pid: pid == 424242)

    launch = launch_detached_supervisor(
        run_id="run_detached",
        config_path=config_path,
        workspace_root=tmp_path,
        project_url="https://chatgpt.example/project",
        cdp_url="http://127.0.0.1:9222",
    )

    assert launch.pid == 424242
    assert launch.pid_path.exists()
    assert launch.metadata_path.exists()
    status = detached_supervisor_status(run_id="run_detached", config=config, workspace_root=tmp_path)
    assert status.alive is True
    assert status.pid == 424242
    assert "supervise-external-agent" in " ".join(status.command)
