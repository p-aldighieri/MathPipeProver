#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
import sys
import time
import uuid
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


sys.path.insert(0, str(_repo_root()))

from mathpipeprover.config import load_config  # noqa: E402
from mathpipeprover.session_bridge import invoke_claude_print, resume_run_via_claude_session  # noqa: E402


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")


def _append_event(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def _response_ready(path: Path) -> bool:
    if not path.exists():
        return False
    return bool(path.read_text(encoding="utf-8", errors="replace").strip())


def _bootstrap_prompt(*, repo_root: Path, claim_file: Path, config_file: Path) -> str:
    py_cmd = (
        f'PYTHONPATH="{repo_root}${{PYTHONPATH:+:$PYTHONPATH}}" '
        f'python3 -m mathpipeprover.cli run '
        f'--claim-file "{claim_file}" '
        f'--config "{config_file}"'
    )
    return (
        "You are running a no-browser smoke test for the MathPipeProver Claude session bridge. "
        "Use shell tools only. Run the exact command below from the current working directory and stop after the first "
        "external-agent handoff.\n\n"
        f"{py_cmd}\n\n"
        "After the command finishes, inspect the run_state.json to confirm the run is waiting on an external agent. "
        "End with a very short status note only."
    )


def _find_new_run_dir(run_root: Path, before: set[str]) -> Path:
    if not run_root.exists():
        raise RuntimeError(f"Run root was not created: {run_root}")
    candidates = [path for path in run_root.iterdir() if path.is_dir()]
    if not candidates:
        raise RuntimeError(f"No run directories were created under {run_root}")
    new_paths = [path for path in candidates if str(path) not in before]
    pool = new_paths or candidates
    return max(pool, key=lambda path: path.stat().st_mtime)


def bootstrap_claude(args: argparse.Namespace) -> int:
    repo_root = _repo_root()
    target_repo = Path(args.target_repo).resolve()
    claim_file = Path(args.claim_file).resolve()
    config_file = Path(args.config_file).resolve()
    metadata_file = Path(args.metadata_file).resolve()
    config = load_config(config_file)
    run_root = target_repo / config.run_root
    before = {str(path) for path in run_root.iterdir()} if run_root.exists() else set()
    session_id = args.session_id or str(uuid.uuid4())
    extra_dirs = [repo_root, *[Path(value).resolve() for value in args.claude_add_dir]]

    invoke_claude_print(
        prompt=_bootstrap_prompt(repo_root=repo_root, claim_file=claim_file, config_file=config_file),
        cwd=target_repo,
        claude_bin=args.claude_bin,
        permission_mode=args.claude_permission_mode,
        dangerously_skip_permissions=args.claude_dangerously_skip_permissions,
        add_dirs=extra_dirs,
        session_id=session_id,
        log_path=metadata_file.with_suffix(".bootstrap.jsonl"),
    )

    run_dir = _find_new_run_dir(run_root, before)
    state = _read_json(run_dir / "run_state.json")
    if str(state.get("status", "")) != "waiting_external_agent":
        raise RuntimeError(f"Bootstrap did not stop at an external-agent handoff: status={state.get('status')!r}")
    pending = state.get("pending_external_agent")
    if not isinstance(pending, dict):
        raise RuntimeError("Bootstrap run is missing pending_external_agent metadata.")
    response_file = str(pending["response_path"])
    payload = {
        "created_at": _now_iso(),
        "orchestrator": "claude",
        "session_id": session_id,
        "run_id": str(state["run_id"]),
        "run_dir": str(run_dir),
        "response_file": response_file,
        "target_repo": str(target_repo),
        "repo_root": str(repo_root),
        "claim_file": str(claim_file),
        "config_file": str(config_file),
        "claude_bin": args.claude_bin,
        "claude_permission_mode": args.claude_permission_mode,
        "claude_dangerously_skip_permissions": bool(args.claude_dangerously_skip_permissions),
        "claude_add_dir": [str(path) for path in extra_dirs],
    }
    _write_json(metadata_file, payload)
    print(f"metadata_file={metadata_file}")
    print(f"session_id={session_id}")
    print(f"run_id={state['run_id']}")
    print(f"run_dir={run_dir}")
    return 0


def write_dummy_response(args: argparse.Namespace) -> int:
    metadata = _read_json(Path(args.metadata_file).resolve())
    response_path = Path(metadata["response_file"])
    response_path.parent.mkdir(parents=True, exist_ok=True)
    body = args.body or "## Formal Statement\n[USER] Claude session-bridge smoke response.\n"
    response_path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8")
    print(f"response_file={response_path}")
    return 0


def watch_claude(args: argparse.Namespace) -> int:
    metadata_path = Path(args.metadata_file).resolve()
    metadata = _read_json(metadata_path)
    target_repo = Path(metadata["target_repo"])
    run_dir = Path(metadata["run_dir"])
    response_path = Path(metadata["response_file"])
    config_file = Path(metadata["config_file"])
    config = load_config(config_file)
    log_path = metadata_path.with_suffix(".watcher.jsonl")
    deadline = time.monotonic() + args.timeout_seconds if args.timeout_seconds > 0 else None
    event_fired = False

    while True:
        if deadline is not None and time.monotonic() > deadline:
            raise RuntimeError("Timed out waiting for the Claude session-bridge smoke response.")

        state = _read_json(run_dir / "run_state.json")
        status = str(state.get("status", ""))
        if status in {"complete", "failed"}:
            _append_event(log_path, {"at": _now_iso(), "event": "run_terminal", "status": status})
            print(f"run_id={metadata['run_id']}")
            print(f"status={status}")
            return 0

        if _response_ready(response_path) and not event_fired:
            _append_event(
                log_path,
                {
                    "at": _now_iso(),
                    "event": "response_ready",
                    "run_id": metadata["run_id"],
                    "response_file": str(response_path),
                },
            )
            result = resume_run_via_claude_session(
                run_id=str(metadata["run_id"]),
                config=config,
                config_path=config_file,
                workspace_root=target_repo,
                session_id=str(metadata["session_id"]),
                claude_bin=str(metadata.get("claude_bin", "claude")),
                permission_mode=str(metadata.get("claude_permission_mode", "bypassPermissions")),
                dangerously_skip_permissions=bool(metadata.get("claude_dangerously_skip_permissions", True)),
                add_dirs=[Path(path) for path in metadata.get("claude_add_dir", [])],
            )
            _append_event(
                log_path,
                {
                    "at": _now_iso(),
                    "event": "resume_completed",
                    "run_id": metadata["run_id"],
                    "status": result.status,
                },
            )
            event_fired = True
            if result.status in {"complete", "failed"}:
                print(f"run_id={metadata['run_id']}")
                print(f"status={result.status}")
                return 0

        time.sleep(args.poll_seconds)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="No-browser smoke helper for the Claude Code session bridge.")
    sub = parser.add_subparsers(dest="command", required=True)

    bootstrap_p = sub.add_parser("bootstrap-claude", help="Start a disposable Claude Code session and stop at the first external-agent handoff.")
    bootstrap_p.add_argument("--target-repo", required=True)
    bootstrap_p.add_argument("--claim-file", required=True)
    bootstrap_p.add_argument("--metadata-file", required=True)
    bootstrap_p.add_argument("--config-file", default=str(_repo_root() / "config" / "session_bridge_smoke.toml"))
    bootstrap_p.add_argument("--claude-bin", default="claude")
    bootstrap_p.add_argument("--claude-permission-mode", default="bypassPermissions")
    bootstrap_p.add_argument("--claude-dangerously-skip-permissions", action=argparse.BooleanOptionalAction, default=True)
    bootstrap_p.add_argument("--claude-add-dir", action="append", default=[])
    bootstrap_p.add_argument("--session-id", default="")

    response_p = sub.add_parser("write-dummy-response", help="Write a fake external-agent response file for the smoke run.")
    response_p.add_argument("--metadata-file", required=True)
    response_p.add_argument("--body", default="")

    watch_p = sub.add_parser("watch-claude", help="Wait for the fake response and resume the saved Claude Code session.")
    watch_p.add_argument("--metadata-file", required=True)
    watch_p.add_argument("--poll-seconds", type=float, default=2.0)
    watch_p.add_argument("--timeout-seconds", type=float, default=300.0)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "bootstrap-claude":
        return bootstrap_claude(args)
    if args.command == "write-dummy-response":
        return write_dummy_response(args)
    if args.command == "watch-claude":
        return watch_claude(args)
    raise ValueError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
