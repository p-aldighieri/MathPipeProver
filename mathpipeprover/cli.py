from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from .config import load_config
from .dotenv_loader import load_dotenv
from .heartbeat import format_watch_result, watch_heartbeat
from .orchestrator import inspect_run, orchestrator_continue_run, orchestrator_revive_run, orchestrator_stop_run, report_run, resume_run, start_run
from .providers import ProviderHub


def _read_claim(args: argparse.Namespace) -> str:
    if args.claim_text:
        return args.claim_text
    if args.claim_file:
        return Path(args.claim_file).read_text(encoding="utf-8")
    raise ValueError("Provide --claim-text or --claim-file")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mpp", description="MathPipeProver smart proof-orchestration harness")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="Start a new run")
    run_p.add_argument("--claim-text", type=str, default="")
    run_p.add_argument("--claim-file", type=str, default="")
    run_p.add_argument("--config", type=str, default="config/default.toml")

    resume_p = sub.add_parser("resume", help="Resume a run")
    resume_p.add_argument("--run-id", required=True)
    resume_p.add_argument("--config", type=str, default="config/default.toml")

    continue_p = sub.add_parser("orchestrator-continue", help="Continue an orchestrator-reviewed soft-scaffolding run after operator judgment")
    continue_p.add_argument("--run-id", required=True)
    continue_p.add_argument("--config", type=str, default="config/default.toml")
    continue_p.add_argument("--branch", required=True)
    continue_p.add_argument("--phase", required=True)

    revive_p = sub.add_parser("orchestrator-revive", help="One-time revive of a terminal orchestrator-reviewed soft-scaffolding run")
    revive_p.add_argument("--run-id", required=True)
    revive_p.add_argument("--config", type=str, default="config/default.toml")
    revive_p.add_argument("--branch", required=True)
    revive_p.add_argument("--stop-phase", default="")
    revive_p.add_argument("--suggested-phase", default="")
    revive_p.add_argument("--reason", default="")

    stop_p = sub.add_parser("orchestrator-stop", help="Stop an orchestrator-reviewed soft-scaffolding run explicitly")
    stop_p.add_argument("--run-id", required=True)
    stop_p.add_argument("--config", type=str, default="config/default.toml")
    stop_p.add_argument("--status", choices=["failed", "complete"], default="failed")
    stop_p.add_argument("--branch", default="")
    stop_p.add_argument("--reason", default="")

    inspect_p = sub.add_parser("inspect", help="Inspect run state")
    inspect_p.add_argument("--run-id", required=True)
    inspect_p.add_argument("--config", type=str, default="config/default.toml")

    report_p = sub.add_parser("report", help="Show run report with branch and token details")
    report_p.add_argument("--run-id", required=True)
    report_p.add_argument("--config", type=str, default="config/default.toml")

    smoke_p = sub.add_parser("smoke-providers", help="Smoke test OpenAI/Anthropic/Gemini connectivity")
    smoke_p.add_argument("--config", type=str, default="config/default.toml")
    smoke_p.add_argument(
        "--providers",
        nargs="*",
        default=["openai", "anthropic", "gemini"],
        help="Subset to test (openai anthropic gemini)",
    )

    heartbeat_p = sub.add_parser("watch-heartbeat", help="Wait for a browser-agent heartbeat to complete")
    heartbeat_p.add_argument("--heartbeat-json", required=True)
    heartbeat_p.add_argument("--response-file", default="")
    heartbeat_p.add_argument("--poll-seconds", type=float, default=10.0)
    heartbeat_p.add_argument("--stale-after-seconds", type=float, default=120.0)
    heartbeat_p.add_argument("--max-wait-seconds", type=float, default=0.0)
    heartbeat_p.add_argument("--notify", action="store_true", help="Show a macOS notification on terminal status")
    heartbeat_p.add_argument("--notify-command", default="", help="Shell command run on terminal status")

    return parser


def _run_provider_smoke(config_path: Path, providers: list[str]) -> int:
    config = load_config(config_path)
    hub = ProviderHub(timeout_seconds=config.provider_timeout_seconds)
    status_code = 0

    key_presence = {
        "openai": bool(os.environ.get("OPENAI_API_KEY")),
        "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "gemini": bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")),
    }

    for provider in providers:
        provider_key = provider.lower().strip()
        model = config.smoke_models.get(provider_key, "")
        has_key = key_presence.get(provider_key, False)
        if not model:
            print(f"[{provider_key}] SKIP model not configured")
            status_code = 1
            continue
        if not has_key:
            print(f"[{provider_key}] SKIP missing API key env var")
            status_code = 1
            continue

        ok, detail = hub.smoke_test(provider=provider_key, model=model)
        if ok:
            print(f"[{provider_key}] PASS model={model} output={detail}")
        else:
            lowered = detail.lower()
            if "quota" in lowered or "insufficient_quota" in lowered:
                print(f"[{provider_key}] WARN_QUOTA model={model} detail={detail}")
            else:
                print(f"[{provider_key}] FAIL model={model} detail={detail}")
                status_code = 1

    return status_code


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cwd = Path.cwd()
    load_dotenv(cwd / ".env", override=True)
    config = None
    config_path = None
    if hasattr(args, "config"):
        config_path = Path(args.config)
        if not config_path.is_absolute():
            config_path = cwd / config_path
        config = load_config(config_path)

    if args.command == "run":
        assert config is not None
        assert config_path is not None
        claim = _read_claim(args)
        result = start_run(claim_text=claim, config=config, config_path=config_path, workspace_root=cwd)
        print(f"run_id={result.run_id}")
        print(f"status={result.status}")
        print(f"run_dir={result.run_dir}")
        return 0

    if args.command == "resume":
        assert config is not None
        result = resume_run(run_id=args.run_id, config=config, workspace_root=cwd)
        print(f"run_id={result.run_id}")
        print(f"status={result.status}")
        print(f"run_dir={result.run_dir}")
        return 0

    if args.command == "orchestrator-continue":
        assert config is not None
        result = orchestrator_continue_run(
            run_id=args.run_id,
            config=config,
            workspace_root=cwd,
            branch=args.branch,
            phase=args.phase,
        )
        print(f"run_id={result.run_id}")
        print(f"status={result.status}")
        print(f"run_dir={result.run_dir}")
        return 0

    if args.command == "orchestrator-revive":
        assert config is not None
        result = orchestrator_revive_run(
            run_id=args.run_id,
            config=config,
            workspace_root=cwd,
            branch=args.branch,
            stop_phase=args.stop_phase,
            suggested_phase=args.suggested_phase,
            reason=args.reason,
        )
        print(f"run_id={result.run_id}")
        print(f"status={result.status}")
        print(f"run_dir={result.run_dir}")
        return 0

    if args.command == "orchestrator-stop":
        assert config is not None
        result = orchestrator_stop_run(
            run_id=args.run_id,
            config=config,
            workspace_root=cwd,
            final_status=args.status,
            branch=args.branch,
            reason=args.reason,
        )
        print(f"run_id={result.run_id}")
        print(f"status={result.status}")
        print(f"run_dir={result.run_dir}")
        return 0

    if args.command == "inspect":
        assert config is not None
        print(inspect_run(run_id=args.run_id, config=config, workspace_root=cwd))
        return 0

    if args.command == "report":
        assert config is not None
        print(report_run(run_id=args.run_id, config=config, workspace_root=cwd))
        return 0

    if args.command == "smoke-providers":
        assert config_path is not None
        return _run_provider_smoke(config_path=config_path, providers=args.providers)

    if args.command == "watch-heartbeat":
        response_path = Path(args.response_file) if args.response_file else None
        max_wait_seconds = args.max_wait_seconds if args.max_wait_seconds > 0 else None
        result = watch_heartbeat(
            heartbeat_path=Path(args.heartbeat_json),
            response_path=response_path,
            poll_seconds=args.poll_seconds,
            stale_after_seconds=args.stale_after_seconds,
            max_wait_seconds=max_wait_seconds,
            notify=args.notify,
            notify_command=args.notify_command,
        )
        print(format_watch_result(result), end="")
        return {"completed": 0, "error": 1, "stale": 2, "timeout": 3}.get(result.status, 4)

    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
