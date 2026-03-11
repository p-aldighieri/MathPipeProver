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
router_enabled = false

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
