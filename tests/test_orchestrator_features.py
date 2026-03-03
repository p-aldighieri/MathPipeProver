from pathlib import Path
import json

from mathpipeprover.config import load_config
from mathpipeprover.orchestrator import report_run, start_run


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
