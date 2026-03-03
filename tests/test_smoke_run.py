from pathlib import Path
import json

from mathpipeprover.config import load_config
from mathpipeprover.orchestrator import start_run


def test_smoke_run(tmp_path: Path) -> None:
    config_path = tmp_path / "config.toml"
    config_path.write_text(
        """
[workflow]
mode = "semi_strict"
enable_literature = true
max_branches = 1
max_prover_cycles = 2
run_root = "runs"

[providers]
default = "stub"
cheap_reviewer = "stub"
browser_agent = "external_agent"
""",
        encoding="utf-8",
    )

    config = load_config(config_path)
    result = start_run(
        claim_text="Prove monotonicity under standard assumptions.",
        config=config,
        config_path=config_path,
        workspace_root=tmp_path,
    )

    assert result.status in {"complete", "failed"}
    assert result.run_dir.exists()
    assert (result.run_dir / "run_state.json").exists()
    assert (result.run_dir / "token_usage_summary.json").exists()

    state = json.loads((result.run_dir / "run_state.json").read_text(encoding="utf-8"))
    metrics = state.get("metrics", {})
    assert int(metrics.get("calls", 0)) > 0
