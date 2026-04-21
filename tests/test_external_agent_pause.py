from pathlib import Path
import json

from mathpipeprover.config import load_config
from mathpipeprover.orchestrator import resume_run, start_run


def test_external_agent_pauses_and_resumes(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 2
run_root = "runs"

[providers]
browser_agent = "external_agent"

[role_runtime.formalizer]
provider = "external_agent"
model = "chatgpt-extended-pro"
temperature = 0.0
max_output_tokens = 32000
reasoning_effort = "high"
""",
        encoding="utf-8",
    )

    config = load_config(config_path)
    first = start_run(
        claim_text="Formalize and prove the claim.",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
    )

    assert first.status == "waiting_external_agent"

    request_path = first.run_dir / "branches/main/external_agent/formalizer_request.md"
    response_path = first.run_dir / "branches/main/external_agent/formalizer_response.md"
    assert request_path.exists()
    assert not response_path.exists()

    state = json.loads((first.run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert state["status"] == "waiting_external_agent"
    assert state["pending_external_agent"]["role"] == "formalizer"

    response_path.write_text("## Formal Statement\n[USER] Response supplied by browser agent.\n", encoding="utf-8")

    resumed = resume_run(run_id=state["run_id"], config=config, workspace_root=tmp_path)
    assert resumed.status in {"complete", "failed"}

    resumed_state = json.loads((first.run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert resumed_state["status"] in {"complete", "failed"}
    assert "pending_external_agent" not in resumed_state


def test_soft_external_agent_request_uses_rendered_prompt_and_hands_back_to_orchestrator(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        """
[workflow]
mode = "semi_strict"
enable_literature = false
max_branches = 1
max_prover_cycles = 2
run_root = "runs"
prompts_root = "prompts_soft"
orchestrator_controls_stop = true

[providers]
browser_agent = "external_agent"

[role_runtime.formalizer]
provider = "external_agent"
model = "chatgpt-extended-pro"
temperature = 0.0
max_output_tokens = 32000
reasoning_effort = "high"
""",
        encoding="utf-8",
    )

    repo_root = Path(__file__).resolve().parents[1]
    (tmp_path / "prompts_soft").mkdir()
    (tmp_path / "prompt_fragments").mkdir()
    (tmp_path / "prompt_fragments" / "output_contract.md").write_text(
        (repo_root / "prompt_fragments" / "output_contract.md").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (tmp_path / "prompts_soft" / "01_formalizer.md").write_text(
        "Soft formalizer prompt.\n\n{{include:../prompt_fragments/output_contract.md}}\n\n## Context Packet\n\n{context_bundle}\n",
        encoding="utf-8",
    )

    config = load_config(config_path)
    first = start_run(
        claim_text="Formalize and prove the claim.",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
    )

    request_path = first.run_dir / "branches/main/external_agent/formalizer_request.md"
    response_path = first.run_dir / "branches/main/external_agent/formalizer_response.md"
    request_text = request_path.read_text(encoding="utf-8")

    assert "Soft formalizer prompt." in request_text
    assert "Do not try to edit repository files in place." in request_text
    assert "## Context Packet" in request_text

    response_path.write_text("## Formal Statement\nPrecise statement supplied.\n", encoding="utf-8")

    resumed = resume_run(run_id=first.run_id, config=config, workspace_root=tmp_path)
    assert resumed.status == "waiting_orchestrator"

    state = json.loads((first.run_dir / "run_state.json").read_text(encoding="utf-8"))
    assert state["status"] == "waiting_orchestrator"
    assert state["current_phase"] == "waiting_orchestrator:main:formalizer"
    assert state["pending_orchestrator_decision"]["suggested_phase"] == "searcher"
