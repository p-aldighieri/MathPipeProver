from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import json
from pathlib import Path
import subprocess
import sys
from typing import Any, Iterable

from .config import WorkflowConfig
from .orchestrator import RunResult
from .storage import load_run_paths, read_json


@dataclass(frozen=True)
class ClaudeSessionInvocation:
    session_id: str
    result_text: str
    assistant_text: str
    returncode: int


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _now_stamp() -> str:
    return datetime.now(tz=UTC).strftime("%Y%m%dT%H%M%SZ")


def _append_log_line(log_path: Path | None, line: str) -> None:
    if log_path is None:
        return
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def _iter_unique_paths(paths: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    ordered: list[Path] = []
    for path in paths:
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        ordered.append(path.resolve())
    return ordered


def _extract_claude_assistant_text(payload: dict[str, Any]) -> str:
    message = payload.get("message", {})
    if not isinstance(message, dict):
        return ""
    content = message.get("content", [])
    chunks: list[str] = []
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    chunks.append(text.strip())
    return "\n".join(chunks).strip()


def invoke_claude_print(
    *,
    prompt: str,
    cwd: Path,
    claude_bin: str = "claude",
    permission_mode: str = "bypassPermissions",
    dangerously_skip_permissions: bool = True,
    add_dirs: Iterable[Path] = (),
    session_id: str = "",
    resume_session_id: str = "",
    log_path: Path | None = None,
) -> ClaudeSessionInvocation:
    cmd = [
        claude_bin,
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--permission-mode",
        permission_mode,
    ]
    if dangerously_skip_permissions:
        cmd.append("--dangerously-skip-permissions")
    for add_dir in _iter_unique_paths(add_dirs):
        cmd.extend(["--add-dir", str(add_dir)])
    if session_id:
        cmd.extend(["--session-id", session_id])
    if resume_session_id:
        cmd.extend(["-r", resume_session_id])
    cmd.append(prompt)

    captured_session_id = session_id or resume_session_id
    result_text = ""
    assistant_text = ""
    result_payload: dict[str, Any] | None = None

    with subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="replace",
    ) as process:
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.rstrip("\n")
            _append_log_line(log_path, line)
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "system" and payload.get("subtype") == "init":
                session_value = payload.get("session_id")
                if isinstance(session_value, str) and session_value.strip():
                    captured_session_id = session_value.strip()
                continue
            if payload.get("type") == "assistant":
                assistant_value = _extract_claude_assistant_text(payload)
                if assistant_value:
                    assistant_text = assistant_value
                session_value = payload.get("session_id")
                if isinstance(session_value, str) and session_value.strip():
                    captured_session_id = session_value.strip()
                continue
            if payload.get("type") == "result":
                result_payload = payload
                result_value = payload.get("result")
                if isinstance(result_value, str) and result_value.strip():
                    result_text = result_value.strip()
                session_value = payload.get("session_id")
                if isinstance(session_value, str) and session_value.strip():
                    captured_session_id = session_value.strip()
        returncode = process.wait()

    if returncode != 0:
        raise RuntimeError(f"Claude command failed with exit code {returncode}: {' '.join(cmd)}")
    if result_payload and result_payload.get("is_error"):
        raise RuntimeError(f"Claude command returned an error result: {result_payload}")
    if not captured_session_id:
        raise RuntimeError("Claude command did not expose a session_id in stream-json output.")
    if not result_text:
        result_text = assistant_text
    return ClaudeSessionInvocation(
        session_id=captured_session_id,
        result_text=result_text,
        assistant_text=assistant_text,
        returncode=returncode,
    )


def build_claude_resume_prompt(*, run_id: str, config_path: Path, workspace_root: Path) -> str:
    repo_root = _repo_root()
    python_cmd = "python" if sys.platform == "win32" else "python3"
    py_cmd = (
        f'cd "{workspace_root}" && '
        f'PYTHONPATH="{repo_root}${{PYTHONPATH:+:$PYTHONPATH}}" '
        f'{python_cmd} -m mathpipeprover.cli resume '
        f'--run-id "{run_id}" '
        f'--config "{config_path}"'
    )
    continue_cmd = (
        f'cd "{workspace_root}" && '
        f'PYTHONPATH="{repo_root}${{PYTHONPATH:+:$PYTHONPATH}}" '
        f'{python_cmd} -m mathpipeprover.cli orchestrator-continue '
        f'--run-id "{run_id}" '
        f'--config "{config_path}" '
        '--branch "<branch>" '
        '--phase "<phase>"'
    )
    stop_cmd = (
        f'cd "{workspace_root}" && '
        f'PYTHONPATH="{repo_root}${{PYTHONPATH:+:$PYTHONPATH}}" '
        f'{python_cmd} -m mathpipeprover.cli orchestrator-stop '
        f'--run-id "{run_id}" '
        f'--config "{config_path}" '
        '--status failed '
        '--branch "<branch>" '
        '--reason "<short reason>"'
    )
    return (
        "A MathPipeProver external-agent response is ready. "
        "You are a short-lived worker session woken by the supervisor daemon.\n\n"
        "## Boundaries\n"
        "- Do NOT watch heartbeats or block on heartbeat files. The supervisor owns heartbeat polling.\n"
        "- Do NOT submit anything to the browser or launch the browser agent. The supervisor owns browser submission.\n"
        "- Do NOT linger after making your decision. Exit promptly. The supervisor will wake you again when the next response is ready.\n"
        "- Keep context clean: read only the files needed for the current decision. Do not accumulate stale state.\n\n"
        "## Steps\n"
        "1. Inspect `run_state.json` to confirm the pending role.\n"
        "2. Run this exact shell command:\n"
        f"```\n{py_cmd}\n```\n"
        "3. Inspect `run_state.json` again.\n"
        "4. If the run is `waiting_external_agent` for another role, **stop immediately**. "
        "The supervisor will handle the next submission and wake you when it completes.\n"
        "5. If the run is `complete` or `failed`, **stop immediately**.\n"
        "6. If the run is `waiting_orchestrator`, you must judge what happens next. "
        "Inspect the latest reviewer/scope files and then either:\n"
        f"   - continue the branch with:\n```\n{continue_cmd}\n```\n"
        "   and rerun the resume command once, or\n"
        f"   - stop the run explicitly with:\n```\n{stop_cmd}\n```\n"
        "7. For soft-scaffolding automation, do NOT stop solely because assumption counts, "
        "scope-budget thresholds, or PATCH_SMALL/PATCH_BIG reviewer verdicts were triggered. "
        "Those are advisory signals, not automatic terminal conditions. Prefer continuing the "
        "same branch whenever the route is still mathematically alive.\n"
        "8. Do not leave the run in `waiting_orchestrator` without making a decision.\n\n"
        "## Source housekeeping\n"
        "Before exiting, check whether the ChatGPT project's durable sources need updating for "
        "the next role. If a branch was completed or pruned, its route memo should be removed. "
        "If the proof-state changed materially (e.g. after a consolidator pass or route pivot), "
        "the proof-state source should be refreshed. Write any needed changes to "
        "`runs/<run>/source_update_pending.json` as `{\"add\": [...paths], \"remove\": [...names]}`. "
        "The supervisor will apply them on the next submission. Keep durable sources to 4-6 files max.\n\n"
        "End with a one-line status note and exit."
    )


def resume_run_via_claude_session(
    *,
    run_id: str,
    config: WorkflowConfig,
    config_path: Path,
    workspace_root: Path,
    session_id: str,
    claude_bin: str = "claude",
    permission_mode: str = "bypassPermissions",
    dangerously_skip_permissions: bool = True,
    add_dirs: Iterable[Path] = (),
    log_path: Path | None = None,
) -> RunResult:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    before_state = read_json(paths.state_path)
    before_status = str(before_state.get("status", ""))
    before_phase = str(before_state.get("current_phase", ""))

    effective_add_dirs = _iter_unique_paths([_repo_root(), *add_dirs])
    effective_log = log_path or (paths.run_dir / "session_bridge" / f"claude_resume_{_now_stamp()}.jsonl")
    prompt = build_claude_resume_prompt(run_id=run_id, config_path=config_path.resolve(), workspace_root=workspace_root.resolve())
    invoke_claude_print(
        prompt=prompt,
        cwd=workspace_root.resolve(),
        claude_bin=claude_bin,
        permission_mode=permission_mode,
        dangerously_skip_permissions=dangerously_skip_permissions,
        add_dirs=effective_add_dirs,
        resume_session_id=session_id,
        log_path=effective_log,
    )

    after_state = read_json(paths.state_path)
    after_status = str(after_state.get("status", ""))
    after_phase = str(after_state.get("current_phase", ""))
    if after_status == before_status and after_phase == before_phase:
        raise RuntimeError(
            "Claude session wake-up did not advance the MathPipeProver run state. "
            f"status={after_status!r} phase={after_phase!r}"
        )
    return RunResult(run_id=run_id, run_dir=paths.run_dir, status=after_status)
