"""Tests for the bounded default re-attack loop (max_attempt_rounds)."""

from pathlib import Path
import json

from mathpipeprover.config import load_config
from mathpipeprover.orchestrator import (
    _branch_met_objective,
    _build_attempt_dossier,
    _extract_md_section,
    _reattack_seed_phase,
    _reseed_for_reattack,
    _run_scheduler,
)
from mathpipeprover.storage import RunPaths


def _blank_metrics() -> dict:
    return {"calls": 0, "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "estimated_calls": 0}


def _config(tmp_path: Path, max_attempt_rounds: int) -> object:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        f"""
[workflow]
mode = "semi_strict"
enable_literature = true
max_branches = 1
max_prover_cycles = 1
run_root = "runs"
prompts_root = "prompts/api"
max_attempt_rounds = {max_attempt_rounds}
""",
        encoding="utf-8",
    )
    return load_config(config_path)


def _scaffold_run(tmp_path: Path, *, verdict: str) -> tuple[RunPaths, dict]:
    run_dir = tmp_path / "runs" / "run_test"
    ctx = run_dir / "branches" / "main" / "context"
    ctx.mkdir(parents=True)
    (run_dir / "claim.md").write_text("# Original Claim\n\nProve the thing.\n", encoding="utf-8")
    (ctx / "formalizer.md").write_text("formalizer output\n", encoding="utf-8")
    (ctx / "literature.md").write_text("literature output\n", encoding="utf-8")
    (ctx / "breakdown.md").write_text(
        "## Proof Breakdown\n\n### Lemma 1: key bound\n\n## Critical Obstruction\n\n"
        "Lemma 3 needs a uniform tail bound that the route never establishes.\n",
        encoding="utf-8",
    )
    (ctx / "reviewer_01.md").write_text(
        "```review_control\nverdict: PATCH_BIG\nroute_status: at_risk\n```\n\n"
        "## Verdict\n\nVERDICT: PATCH_BIG\nReason: gap at Lemma 3.\n\n"
        "## Opinion and Next Move\n\nThe route stalls at Lemma 3; the tail bound is unproven.\n",
        encoding="utf-8",
    )
    (ctx / "gatekeeper.md").write_text(
        "## Strategic Re-Attack\n\n- Strategy 1 — pivot via compactness.\n",
        encoding="utf-8",
    )
    paths = RunPaths(root=run_dir.parent, run_dir=run_dir, state_path=run_dir / "run_state.json")
    state = {
        "run_id": "run_test",
        "status": "running",
        "current_phase": "scheduler",
        "prelude_done": True,
        "prelude_phase": "done",
        "branches_spawned": True,
        "branch_order": ["main"],
        "winning_branch": "",
        "attempt_round": 1,
        "branches": {
            "main": {
                "status": "pass",
                "review_cycles": 1,
                "current_phase": "done",
                "selected_route": "Route A",
                "last_reason": "proof branch completed",
                "score": 5.0,
                "gatekeeper_verdict": verdict,
                "metrics": _blank_metrics(),
            }
        },
        "metrics": {**_blank_metrics(), "by_role": {}},
        "mode": "semi_strict",
    }
    (run_dir / "run_state.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    return paths, state


def test_branch_met_objective() -> None:
    assert _branch_met_objective({"status": "pass", "gatekeeper_verdict": "OBJECTIVE_MET"}) is True
    assert _branch_met_objective({"status": "pass", "gatekeeper_verdict": ""}) is True  # back-compat
    assert _branch_met_objective({"status": "pass", "gatekeeper_verdict": "OBJECTIVE_NARROWED"}) is False
    assert _branch_met_objective({"status": "stall", "gatekeeper_verdict": ""}) is False


def test_reattack_seed_phase() -> None:
    assert _reattack_seed_phase(["OBJECTIVE_NARROWED"]) == "searcher"
    assert _reattack_seed_phase([""]) == "searcher"
    assert _reattack_seed_phase(["OBJECTIVE_NARROWED", "OBJECTIVE_MISSED"]) == "formalizer"


def test_extract_md_section() -> None:
    text = "## A\n\nalpha\n\n## Strategic Re-Attack\n\n- s1\n- s2\n\n## B\n\nbeta\n"
    section = _extract_md_section(text, "Strategic Re-Attack")
    assert "- s1" in section and "- s2" in section
    assert "beta" not in section and "alpha" not in section
    assert _extract_md_section(text, "Nonexistent") == ""


def test_scheduler_completes_when_reattack_disabled(tmp_path: Path) -> None:
    # max_attempt_rounds=1: a narrowed pass branch still terminates as complete (legacy).
    config = _config(tmp_path, max_attempt_rounds=1)
    paths, state = _scaffold_run(tmp_path, verdict="OBJECTIVE_NARROWED")

    result = _run_scheduler(paths, state, config, hub=None, prompts_root=Path("prompts/api"))

    assert result.status == "complete"
    assert state["winning_branch"] == "main"
    assert not (paths.run_dir / "attempt_dossier.md").exists()


def test_scheduler_reattacks_and_reseeds_at_formalizer(tmp_path: Path) -> None:
    config = _config(tmp_path, max_attempt_rounds=2)
    paths, state = _scaffold_run(tmp_path, verdict="OBJECTIVE_MISSED")

    result = _run_scheduler(paths, state, config, hub=None, prompts_root=Path("prompts/api"))

    assert result.status == "reattack"
    # State re-seeded for a fresh attempt at the formalizer (OBJECTIVE_MISSED).
    assert state["attempt_round"] == 2
    assert state["prelude_done"] is False
    assert state["prelude_phase"] == "formalizer"
    assert state["branches_spawned"] is False
    assert state["branch_order"] == ["main"]
    assert state["branches"]["main"]["status"] == "running"
    assert state["branches"]["main"]["current_phase"] == "formalizer"

    # Dossier written with the prior attempt's lessons.
    dossier = (paths.run_dir / "attempt_dossier.md").read_text(encoding="utf-8")
    assert "Attempt 1" in dossier
    assert "Route A" in dossier
    assert "OBJECTIVE_MISSED" in dossier
    assert "compactness" in dossier  # pulled from gatekeeper Strategic Re-Attack
    # Widened signals: reviewer verdict + read, and the breakdown's central obstruction.
    assert "PATCH_BIG" in dossier
    assert "stalls at Lemma 3" in dossier
    assert "uniform tail bound" in dossier

    # Prior attempt snapshotted; formalizer wiped for a clean re-read.
    assert (paths.run_dir / "attempts" / "attempt_1" / "branches" / "main" / "context" / "formalizer.md").exists()
    assert not (paths.run_dir / "branches" / "main" / "context" / "formalizer.md").exists()


def test_reseed_at_searcher_keeps_formalizer_and_literature(tmp_path: Path) -> None:
    paths, state = _scaffold_run(tmp_path, verdict="OBJECTIVE_NARROWED")

    _build_attempt_dossier(paths, state, attempt_round=1, seed_phase="searcher")
    _reseed_for_reattack(paths, state, prev_round=1, seed_phase="searcher")

    ctx = paths.run_dir / "branches" / "main" / "context"
    # Carried over (reused on the next searcher pass)
    assert (ctx / "formalizer.md").exists()
    assert (ctx / "literature.md").exists()
    # Cleaned out (regenerated by the fresh attempt)
    assert not (ctx / "breakdown.md").exists()
    assert not (ctx / "gatekeeper.md").exists()
    assert state["prelude_phase"] == "searcher"
    assert state["attempt_round"] == 2
