from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from .config import load_config
from .dotenv_loader import load_dotenv
from .heartbeat import format_watch_result, watch_heartbeat
from .orchestrator import inspect_run, orchestrator_continue_run, orchestrator_revive_run, orchestrator_stop_run, report_run, resume_run, start_run
from .providers import ProviderHub


AXLE_OKAY_TOOLS = frozenset({"check", "verify-proof", "verify_proof"})


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

    _add_axle_parser(sub)

    heartbeat_p = sub.add_parser("watch-heartbeat", help="Wait for a browser-agent heartbeat to complete")
    heartbeat_p.add_argument("--heartbeat-json", required=True)
    heartbeat_p.add_argument("--response-file", default="")
    heartbeat_p.add_argument("--poll-seconds", type=float, default=10.0)
    heartbeat_p.add_argument("--stale-after-seconds", type=float, default=120.0)
    heartbeat_p.add_argument("--max-wait-seconds", type=float, default=0.0)
    heartbeat_p.add_argument("--notify", action="store_true", help="Show a macOS notification on terminal status")
    heartbeat_p.add_argument("--notify-command", default="", help="Shell command run on terminal status")

    return parser


def _add_axle_parser(sub: argparse._SubParsersAction) -> None:
    axle_p = sub.add_parser(
        "axle",
        help="Call the AXLE Lean verification API (check, verify-proof, sorry2lemma, ...)",
        description=(
            "Thin shell over the AXLE REST API. Skills invoke these subcommands "
            "via Bash; they read AXLE_API_KEY from the environment (or .env) and "
            "print the JSON response to stdout. Exit code 0 = success; 2 = HTTP "
            "succeeded but Lean compile failed (okay: false); 1 = transport/auth error."
        ),
    )
    axle_sub = axle_p.add_subparsers(dest="axle_command", required=True)

    def add_common(p: argparse.ArgumentParser, *, supports_environment: bool = True) -> None:
        if supports_environment:
            p.add_argument("--environment", default="", help="Lean toolchain (default: AXLE_DEFAULT_ENV or lean-4.29.0)")
            p.add_argument("--timeout", type=int, default=0, help="Server-side timeout in seconds (1..900)")
        p.add_argument("--log-path", default="", help="Append one JSONL audit entry per call to this file")

    env_p = axle_sub.add_parser("environments", help="List available Lean toolchains")
    add_common(env_p, supports_environment=False)

    smoke_p = axle_sub.add_parser("smoke", help="End-to-end auth + connectivity check (lists envs + tiny check)")
    add_common(smoke_p)

    check_p = axle_sub.add_parser("check", help="Compile a Lean source file")
    check_p.add_argument("--in", dest="in_file", required=True, help="Path to Lean source (use '-' for stdin)")
    check_p.add_argument("--mathlib-options", action="store_true")
    check_p.add_argument("--ignore-imports", action="store_true")
    add_common(check_p)

    verify_p = axle_sub.add_parser("verify-proof", help="Verify a Lean source satisfies a target signature")
    verify_p.add_argument("--in", dest="in_file", required=True, help="Candidate Lean source")
    verify_p.add_argument("--formal-statement", required=True, help="Target signature (path or '-' for stdin)")
    verify_p.add_argument(
        "--permitted-sorries",
        default="",
        help="Comma-separated declaration names that may remain as sorry",
    )
    verify_p.add_argument("--use-def-eq", action="store_true")
    verify_p.add_argument("--ignore-imports", action="store_true")
    verify_p.add_argument("--mathlib-options", action="store_true")
    add_common(verify_p)

    s2l_p = axle_sub.add_parser("sorry2lemma", help="Lift each sorry to a top-level lemma")
    s2l_p.add_argument("--in", dest="in_file", required=True)
    s2l_p.add_argument("--names", default="", help="Comma-separated declaration names to target")
    s2l_p.add_argument("--no-extract-errors", action="store_true")
    s2l_p.add_argument("--reconstruct-callsite", action="store_true")
    s2l_p.add_argument("--verbosity", type=int, default=0)
    add_common(s2l_p)

    repair_p = axle_sub.add_parser("repair-proofs", help="Apply bounded repair strategies (not a proof search)")
    repair_p.add_argument("--in", dest="in_file", required=True)
    repair_p.add_argument("--names", default="", help="Comma-separated declaration names to target")
    repair_p.add_argument(
        "--terminal-tactics",
        default="grind",
        help="Comma-separated tactics to try at sorry sites (default: grind)",
    )
    repair_p.add_argument(
        "--repairs",
        default="",
        help="Comma-separated subset of: remove_extraneous_tactics, apply_terminal_tactics, replace_unsafe_tactics",
    )
    repair_p.add_argument("--ignore-imports", action="store_true")
    add_common(repair_p)

    merge_p = axle_sub.add_parser("merge", help="Combine multiple Lean source files into one")
    merge_p.add_argument("--in", dest="in_files", action="append", required=True, help="Repeatable; one file per --in")
    merge_p.add_argument("--use-def-eq", action="store_true")
    merge_p.add_argument("--include-alts-as-comments", action="store_true")
    merge_p.add_argument("--ignore-imports", action="store_true")
    add_common(merge_p)

    disprove_p = axle_sub.add_parser("disprove", help="Plausible-backed counterexample search")
    disprove_p.add_argument("--in", dest="in_file", required=True)
    disprove_p.add_argument("--names", default="", help="Comma-separated declaration names to target")
    disprove_p.add_argument("--terminal-tactics", default="plausible")
    add_common(disprove_p)

    extract_p = axle_sub.add_parser("extract-decls", help="Split a multi-declaration Lean file into standalone units")
    extract_p.add_argument("--in", dest="in_file", required=True)
    add_common(extract_p)


def _read_axle_input(spec: str) -> str:
    if spec == "-":
        return sys.stdin.read()
    return Path(spec).read_text(encoding="utf-8")


def _csv(value: str) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _run_axle(args: argparse.Namespace) -> int:
    # Import locally so `mpp --help` works even if the module is being edited.
    from .axle import AxleClient, AxleError

    log_path = args.log_path if getattr(args, "log_path", "") else None
    environment = getattr(args, "environment", "") or None
    timeout = int(getattr(args, "timeout", 0) or 0) or None

    try:
        client = AxleClient(
            default_environment=environment,
            log_path=log_path,
        )
    except AxleError as exc:
        print(f"AXLE setup failed: {exc}", file=sys.stderr)
        return 1

    try:
        if args.axle_command == "environments":
            result: object = client.list_environments()

        elif args.axle_command == "smoke":
            envs = client.list_environments()
            tiny = client.check(
                'import Mathlib\n\nexample : 1 + 1 = 2 := rfl\n',
                environment=environment,
                timeout_seconds=timeout,
            )
            result = {
                "environments_available": [e.get("name") for e in envs if isinstance(e, dict)],
                "check_okay": tiny.get("okay"),
                "lean_messages": tiny.get("lean_messages"),
                "timings": tiny.get("timings"),
            }
            print(json.dumps(result, indent=2))
            return 0 if tiny.get("okay") is True else 2

        elif args.axle_command == "check":
            content = _read_axle_input(args.in_file)
            result = client.check(
                content,
                environment=environment,
                mathlib_options=args.mathlib_options,
                ignore_imports=args.ignore_imports,
                timeout_seconds=timeout,
            )

        elif args.axle_command == "verify-proof":
            content = _read_axle_input(args.in_file)
            formal_statement = _read_axle_input(args.formal_statement)
            result = client.verify_proof(
                content,
                formal_statement,
                environment=environment,
                permitted_sorries=_csv(args.permitted_sorries),
                use_def_eq=args.use_def_eq,
                ignore_imports=args.ignore_imports,
                mathlib_options=args.mathlib_options,
                timeout_seconds=timeout,
            )

        elif args.axle_command == "sorry2lemma":
            content = _read_axle_input(args.in_file)
            result = client.sorry2lemma(
                content,
                environment=environment,
                names=_csv(args.names) or None,
                extract_errors=not args.no_extract_errors,
                reconstruct_callsite=args.reconstruct_callsite,
                verbosity=args.verbosity,
                timeout_seconds=timeout,
            )

        elif args.axle_command == "repair-proofs":
            content = _read_axle_input(args.in_file)
            result = client.repair_proofs(
                content,
                environment=environment,
                names=_csv(args.names) or None,
                terminal_tactics=_csv(args.terminal_tactics) or None,
                repairs=_csv(args.repairs) or None,
                ignore_imports=args.ignore_imports,
                timeout_seconds=timeout,
            )

        elif args.axle_command == "merge":
            documents = [_read_axle_input(p) for p in args.in_files]
            result = client.merge(
                documents,
                environment=environment,
                use_def_eq=args.use_def_eq,
                include_alts_as_comments=args.include_alts_as_comments,
                ignore_imports=args.ignore_imports,
                timeout_seconds=timeout,
            )

        elif args.axle_command == "disprove":
            content = _read_axle_input(args.in_file)
            result = client.disprove(
                content,
                environment=environment,
                names=_csv(args.names) or None,
                terminal_tactics=_csv(args.terminal_tactics) or None,
                timeout_seconds=timeout,
            )

        elif args.axle_command == "extract-decls":
            content = _read_axle_input(args.in_file)
            result = client.extract_decls(
                content,
                environment=environment,
                timeout_seconds=timeout,
            )

        else:
            print(f"unknown axle subcommand: {args.axle_command}", file=sys.stderr)
            return 1

    except AxleError as exc:
        print(f"AXLE call failed: {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"input file not found: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2))
    if args.axle_command in AXLE_OKAY_TOOLS and isinstance(result, dict):
        return 0 if result.get("okay") is True else 2
    return 0


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

    if args.command == "axle":
        return _run_axle(args)

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
