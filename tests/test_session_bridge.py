from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from mathpipeprover.config import load_config
from mathpipeprover.orchestrator import RunResult
from mathpipeprover.session_bridge import (
    ClaudeSessionInvocation,
    build_claude_resume_prompt,
    invoke_claude_print,
    resume_run_via_claude_session,
)


class _FakePopen:
    def __init__(self, lines: list[str], returncode: int = 0) -> None:
        self.stdout = io.StringIO("".join(lines))
        self._returncode = returncode

    def __enter__(self) -> "_FakePopen":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def wait(self) -> int:
        return self._returncode


def _write_run_state(run_dir: Path, payload: dict[str, object]) -> None:
    (run_dir / "run_state.json").write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _config(tmp_path: Path) -> tuple[Path, object]:
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


def test_load_config_applies_policy_overrides(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
policy_max_scope_changes_per_branch = 999
policy_max_new_assumptions_per_branch = 123
policy_require_scope_gate = true

[providers]
browser_agent = "external_agent"
""",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.mode == "semi_strict"
    assert config.policy.max_scope_changes_per_branch == 999
    assert config.policy.max_new_assumptions_per_branch == 123
    assert config.policy.require_scope_gate is True


def test_build_claude_resume_prompt_biases_soft_runs_toward_continue(tmp_path: Path) -> None:
    prompt = build_claude_resume_prompt(
        run_id="run_soft",
        config_path=tmp_path / "config.toml",
        workspace_root=tmp_path,
    )

    assert "do NOT stop solely because assumption counts" in prompt
    assert "Prefer continuing the same branch whenever the route is still mathematically alive." in prompt


def test_invoke_claude_print_captures_session_and_result(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    captured_cmd: dict[str, list[str]] = {}

    def fake_popen(*args, **kwargs) -> _FakePopen:
        captured_cmd["value"] = list(args[0])
        return _FakePopen(
            [
                json.dumps({"type": "system", "subtype": "init", "session_id": "claude-session-1"}) + "\n",
                json.dumps(
                    {
                        "type": "assistant",
                        "session_id": "claude-session-1",
                        "message": {
                            "content": [{"type": "text", "text": "Bridge wake complete."}],
                        },
                    }
                )
                + "\n",
                json.dumps(
                    {
                        "type": "result",
                        "subtype": "success",
                        "is_error": False,
                        "result": "Bridge wake complete.",
                        "session_id": "claude-session-1",
                    }
                )
                + "\n",
            ]
        )

    monkeypatch.setattr("mathpipeprover.session_bridge.subprocess.Popen", fake_popen)
    log_path = tmp_path / "claude.jsonl"
    result = invoke_claude_print(
        prompt="Reply with bridge wake complete.",
        cwd=tmp_path,
        session_id="claude-session-1",
        log_path=log_path,
    )

    assert result == ClaudeSessionInvocation(
        session_id="claude-session-1",
        result_text="Bridge wake complete.",
        assistant_text="Bridge wake complete.",
        returncode=0,
    )
    assert "--dangerously-skip-permissions" in captured_cmd["value"]
    assert "claude-session-1" in log_path.read_text(encoding="utf-8")


def test_resume_run_via_claude_session_reads_updated_run_state(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    config_path, config = _config(tmp_path)
    run_dir = tmp_path / "runs" / "run_bridge"
    run_dir.mkdir(parents=True)
    (run_dir / "branches").mkdir()
    _write_run_state(
        run_dir,
        {
            "run_id": "run_bridge",
            "status": "waiting_external_agent",
            "current_phase": "waiting_external_agent:main:formalizer",
            "pending_external_agent": {
                "branch": "main",
                "role": "formalizer",
                "response_path": str(run_dir / "branches" / "main" / "external_agent" / "formalizer_response.md"),
            },
        },
    )

    def fake_invoke(**kwargs) -> ClaudeSessionInvocation:
        _write_run_state(
            run_dir,
            {
                "run_id": "run_bridge",
                "status": "complete",
                "current_phase": "done",
            },
        )
        return ClaudeSessionInvocation(
            session_id="claude-session-1",
            result_text="Run resumed.",
            assistant_text="Run resumed.",
            returncode=0,
        )

    monkeypatch.setattr("mathpipeprover.session_bridge.invoke_claude_print", fake_invoke)

    result = resume_run_via_claude_session(
        run_id="run_bridge",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
        session_id="claude-session-1",
    )

    assert result == RunResult(run_id="run_bridge", run_dir=run_dir, status="complete")


def test_resume_run_via_claude_session_raises_if_state_does_not_change(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    config_path, config = _config(tmp_path)
    run_dir = tmp_path / "runs" / "run_noop"
    run_dir.mkdir(parents=True)
    (run_dir / "branches").mkdir()
    _write_run_state(
        run_dir,
        {
            "run_id": "run_noop",
            "status": "waiting_external_agent",
            "current_phase": "waiting_external_agent:main:formalizer",
            "pending_external_agent": {
                "branch": "main",
                "role": "formalizer",
                "response_path": str(run_dir / "branches" / "main" / "external_agent" / "formalizer_response.md"),
            },
        },
    )

    monkeypatch.setattr(
        "mathpipeprover.session_bridge.invoke_claude_print",
        lambda **kwargs: ClaudeSessionInvocation(
            session_id="claude-session-1",
            result_text="No-op.",
            assistant_text="No-op.",
            returncode=0,
        ),
    )

    with pytest.raises(RuntimeError, match="did not advance"):
        resume_run_via_claude_session(
            run_id="run_noop",
            config=config,
            config_path=config_path,
            workspace_root=tmp_path,
            session_id="claude-session-1",
        )
