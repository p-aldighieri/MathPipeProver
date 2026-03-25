from pathlib import Path
import json

from mathpipeprover.config import load_config
from mathpipeprover.orchestrator import orchestrator_continue_run, orchestrator_revive_run, orchestrator_stop_run, report_run, resume_run, start_run


def _write_config(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")


def test_multibranch_fanout_respects_max_branches(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 2
max_prover_cycles = 1
run_root = "runs"
""",
    )

    config = load_config(config_path)
    result = start_run(
        claim_text="Fan out branch test claim.",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
    )

    state = json.loads((result.run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert state.get("branches_spawned") is True
    assert len(state.get("branch_order", [])) == 2


def test_budget_guard_stops_run(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
max_total_tokens = 10
max_tokens_per_branch = 10
max_total_calls = 100
max_calls_per_branch = 100
run_root = "runs"
""",
    )

    config = load_config(config_path)
    result = start_run(
        claim_text="Budget guard test claim.",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
    )

    assert result.status == "failed"
    state = json.loads((result.run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert state.get("status") == "failed"
    assert state.get("current_phase") in {"stop_budget", "done"}


def test_report_contains_sections(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
""",
    )

    config = load_config(config_path)
    result = start_run(
        claim_text="Report test claim.",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
    )

    text = report_run(run_id=result.run_id, config=config, workspace_root=tmp_path)
    assert "Run Report:" in text
    assert "Branch Results:" in text
    assert "Role Usage:" in text


def test_soft_stop_hands_back_to_orchestrator(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
router_enabled = false
orchestrator_controls_stop = true
""",
    )

    config = load_config(config_path)
    run_id = "run_soft_handoff"
    run_dir = tmp_path / "runs" / run_id
    (run_dir / "branches" / "main" / "context").mkdir(parents=True)
    state = {
        "run_id": run_id,
        "status": "running",
        "current_phase": "scheduler",
        "prelude_done": True,
        "prelude_phase": "done",
        "branches_spawned": True,
        "branch_order": ["main"],
        "branches": {
            "main": {
                "status": "running",
                "review_cycles": 1,
                "current_phase": "stop_fail_scope",
                "selected_route": "route",
                "last_reason": "",
                "score": 0.0,
                "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0},
            }
        },
        "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0, "by_role": {}},
        "mode": config.mode,
    }
    (run_dir / "run_state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")

    result = resume_run(run_id=run_id, config=config, workspace_root=tmp_path)

    assert result.status == "waiting_orchestrator"
    updated = json.loads((run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert updated["status"] == "waiting_orchestrator"
    assert updated["current_phase"] == "waiting_orchestrator:main:stop_fail_scope"
    assert updated["pending_orchestrator_decision"]["suggested_phase"] == "breakdown"
    assert updated["branches"]["main"]["status"] == "orchestrator_review"


def test_orchestrator_continue_and_stop_are_explicit(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
router_enabled = false
orchestrator_controls_stop = true
""",
    )

    config = load_config(config_path)
    run_id = "run_orchestrator_controls"
    run_dir = tmp_path / "runs" / run_id
    (run_dir / "branches" / "main" / "context").mkdir(parents=True)
    waiting_state = {
        "run_id": run_id,
        "status": "waiting_orchestrator",
        "current_phase": "waiting_orchestrator:main:stop_stall",
        "prelude_done": True,
        "prelude_phase": "done",
        "branches_spawned": True,
        "branch_order": ["main"],
        "pending_orchestrator_decision": {
            "branch": "main",
            "stop_phase": "stop_stall",
            "suggested_phase": "breakdown",
            "reason": "stalled",
        },
        "branches": {
            "main": {
                "status": "orchestrator_review",
                "review_cycles": 3,
                "current_phase": "orchestrator_review",
                "selected_route": "route",
                "last_reason": "stalled",
                "score": 0.0,
                "pending_orchestrator_decision": {
                    "branch": "main",
                    "stop_phase": "stop_stall",
                    "suggested_phase": "breakdown",
                    "reason": "stalled",
                },
                "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0},
            }
        },
        "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0, "by_role": {}},
        "mode": config.mode,
    }
    (run_dir / "run_state.json").write_text(json.dumps(waiting_state, indent=2), encoding="utf-8")

    continued = orchestrator_continue_run(
        run_id=run_id,
        config=config,
        workspace_root=tmp_path,
        branch="main",
        phase="breakdown",
    )
    assert continued.status == "running"
    updated = json.loads((run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert updated["status"] == "running"
    assert updated["current_phase"] == "scheduler"
    assert updated["branches"]["main"]["status"] == "running"
    assert updated["branches"]["main"]["current_phase"] == "breakdown"
    assert "pending_orchestrator_decision" not in updated

    (run_dir / "run_state.json").write_text(json.dumps(waiting_state, indent=2), encoding="utf-8")
    stopped = orchestrator_stop_run(
        run_id=run_id,
        config=config,
        workspace_root=tmp_path,
        final_status="failed",
        branch="main",
        reason="explicit stop",
    )
    assert stopped.status == "failed"
    updated = json.loads((run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert updated["status"] == "failed"
    assert updated["current_phase"] == "done"
    assert updated["branches"]["main"]["status"] == "failed"


def test_orchestrator_revive_terminal_run(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
router_enabled = false
orchestrator_controls_stop = true
""",
    )

    config = load_config(config_path)
    run_id = "run_revival"
    run_dir = tmp_path / "runs" / run_id
    (run_dir / "branches" / "main" / "context").mkdir(parents=True)
    state = {
        "run_id": run_id,
        "status": "failed",
        "current_phase": "done",
        "prelude_done": True,
        "prelude_phase": "done",
        "branches_spawned": True,
        "branch_order": ["main"],
        "winning_branch": "main",
        "branches": {
            "main": {
                "status": "fail_scope",
                "review_cycles": 2,
                "current_phase": "stop_fail_scope",
                "selected_route": "route",
                "last_reason": "scope rejected",
                "score": 12.0,
                "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0},
            }
        },
        "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0, "by_role": {}},
        "mode": config.mode,
    }
    (run_dir / "run_state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")

    revived = orchestrator_revive_run(
        run_id=run_id,
        config=config,
        workspace_root=tmp_path,
        branch="main",
        suggested_phase="breakdown",
        reason="one-time revival",
    )

    assert revived.status == "waiting_orchestrator"
    updated = json.loads((run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert updated["status"] == "waiting_orchestrator"
    assert updated["current_phase"] == "waiting_orchestrator:main:stop_fail_scope"
    assert updated["winning_branch"] == ""
    assert updated["branches"]["main"]["status"] == "orchestrator_review"
    assert updated["branches"]["main"]["pending_orchestrator_decision"]["suggested_phase"] == "breakdown"


def test_orchestrator_continue_clears_stale_external_agent_artifacts(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    _write_config(
        config_path,
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
router_enabled = false
orchestrator_controls_stop = true
""",
    )

    config = load_config(config_path)
    run_id = "run_clear_external"
    run_dir = tmp_path / "runs" / run_id
    ext_dir = run_dir / "branches" / "main" / "external_agent"
    ext_dir.mkdir(parents=True)
    for name in [
        "breakdown_request.md",
        "breakdown_response.md",
        "breakdown_response_heartbeat.json",
        "breakdown_response_session.json",
        "prover_request.md",
        "prover_response.md",
        "reviewer_response.md",
    ]:
        (ext_dir / name).write_text(f"stale {name}", encoding="utf-8")

    state = {
        "run_id": run_id,
        "status": "waiting_orchestrator",
        "current_phase": "waiting_orchestrator:main:stop_stall",
        "prelude_done": True,
        "prelude_phase": "done",
        "branches_spawned": True,
        "branch_order": ["main"],
        "pending_orchestrator_decision": {
            "branch": "main",
            "stop_phase": "stop_stall",
            "suggested_phase": "breakdown",
            "reason": "stalled",
        },
        "branches": {
            "main": {
                "status": "orchestrator_review",
                "review_cycles": 3,
                "current_phase": "orchestrator_review",
                "selected_route": "route",
                "last_reason": "stalled",
                "score": 0.0,
                "pending_orchestrator_decision": {
                    "branch": "main",
                    "stop_phase": "stop_stall",
                    "suggested_phase": "breakdown",
                    "reason": "stalled",
                },
                "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0},
            }
        },
        "metrics": {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0, "by_role": {}},
        "mode": config.mode,
    }
    (run_dir / "run_state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")

    orchestrator_continue_run(
        run_id=run_id,
        config=config,
        workspace_root=tmp_path,
        branch="main",
        phase="breakdown",
    )

    archive_dir = ext_dir / "archive"
    assert archive_dir.exists()
    archived_names = sorted(p.name for p in archive_dir.iterdir())
    assert any(name.endswith("breakdown_response.md") for name in archived_names)
    assert any(name.endswith("prover_response.md") for name in archived_names)
    assert any(name.endswith("reviewer_response.md") for name in archived_names)
    assert not (ext_dir / "breakdown_response.md").exists()
    assert not (ext_dir / "prover_response.md").exists()
