from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from fnmatch import fnmatch
from pathlib import Path
from typing import Iterable
import json
import re
import shutil

from .config import RoleRuntimeConfig, WorkflowConfig
from .ledger import build_knowledge_ledger, count_scope_assumptions, extract_tagged_lines
from .markdown import to_markdown
from .policies import build_scope_policy
from .prompting import build_role_context, load_prompt_template, render_template
from .providers import LLMRequest, ProviderHub, estimate_tokens
from .roles import ROLE_SPECS, stub_response
from .review_parser import ReviewVerdict, parse_review_control, parse_review_verdict
from .storage import RunPaths, init_run_dir, load_run_paths, make_run_id, read_json, sanitize_name, write_json


@dataclass
class RunResult:
    run_id: str
    run_dir: Path
    status: str


@dataclass
class ExternalAgentPending(RuntimeError):
    branch: str
    role: str
    response_path: Path

    def __str__(self) -> str:
        return f"external agent response missing for role={self.role} branch={self.branch}: {self.response_path}"


@dataclass
class OrchestratorDecisionPending(RuntimeError):
    branch: str
    stop_phase: str
    suggested_phase: str
    reason: str

    def __str__(self) -> str:
        return (
            "orchestrator review required for "
            f"branch={self.branch} stop_phase={self.stop_phase} suggested_phase={self.suggested_phase or '-'}: {self.reason}"
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


_estimate_tokens = estimate_tokens


def _blank_metric() -> dict:
    return {
        "calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "estimated_calls": 0,
    }


def _ensure_metrics(state: dict) -> None:
    metrics = state.setdefault("metrics", {})
    defaults = _blank_metric()
    for key, value in defaults.items():
        metrics.setdefault(key, value)
    metrics.setdefault("by_role", {})


def _ensure_branch_structures(state: dict) -> None:
    branches = state.setdefault("branches", {})
    for _, bstate in branches.items():
        bstate.setdefault("status", "running")
        bstate.setdefault("review_cycles", 0)
        bstate.setdefault("current_phase", "breakdown")
        bstate.setdefault("selected_route", "")
        bstate.setdefault("last_reason", "")
        bstate.setdefault("score", 0.0)
        if "metrics" not in bstate:
            bstate["metrics"] = _blank_metric()


def _clear_orchestrator_decision(state: dict, branch: str = "") -> None:
    state.pop("pending_orchestrator_decision", None)
    if branch:
        bstate = state.get("branches", {}).get(branch, {})
        bstate.pop("pending_orchestrator_decision", None)


def _clear_external_agent_artifacts(run_dir: Path, branch: str, from_phase: str) -> None:
    ordered_roles = ["formalizer", "literature", "searcher", "breakdown", "prover", "reviewer", "consolidator"]
    if from_phase not in ordered_roles:
        return

    ext_dir = run_dir / f"branches/{branch}/external_agent"
    if not ext_dir.exists():
        return

    archive_dir = ext_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    for role in ordered_roles[ordered_roles.index(from_phase) :]:
        for suffix in ("request.md", "response.md", "response_heartbeat.json", "response_session.json"):
            src = ext_dir / f"{role}_{suffix}"
            if not src.exists():
                continue
            archived = archive_dir / f"{stamp}_{src.name}"
            shutil.move(str(src), str(archived))


def _handoff_to_orchestrator(
    paths: RunPaths,
    state: dict,
    branch: str,
    *,
    stop_phase: str,
    suggested_phase: str,
    reason: str,
) -> None:
    run_dir = paths.run_dir
    bstate = state["branches"][branch]
    decision_payload = {
        "branch": branch,
        "stop_phase": stop_phase,
        "suggested_phase": suggested_phase,
        "reason": reason,
    }
    bstate["status"] = "orchestrator_review"
    bstate["current_phase"] = "orchestrator_review"
    bstate["last_reason"] = reason
    bstate["pending_orchestrator_decision"] = decision_payload
    state["status"] = "waiting_orchestrator"
    state["current_phase"] = f"waiting_orchestrator:{branch}:{stop_phase}"
    state["pending_orchestrator_decision"] = decision_payload
    _append_event(
        run_dir,
        branch,
        f"orchestrator handoff: stop_phase={stop_phase} suggested_phase={suggested_phase or '-'} reason={reason}",
    )
    _write_run_state(paths, state)
    raise OrchestratorDecisionPending(
        branch=branch,
        stop_phase=stop_phase,
        suggested_phase=suggested_phase,
        reason=reason,
    )


def _record_token_usage(
    run_dir: Path,
    state: dict,
    branch: str,
    role: str,
    provider: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    total_tokens: int,
    estimated: bool,
    error: str = "",
) -> None:
    _ensure_metrics(state)
    _ensure_branch_structures(state)

    metrics = state["metrics"]
    metrics["calls"] += 1
    metrics["input_tokens"] += input_tokens
    metrics["output_tokens"] += output_tokens
    metrics["total_tokens"] += total_tokens
    if estimated:
        metrics["estimated_calls"] += 1

    by_role = metrics["by_role"]
    role_metrics = by_role.setdefault(
        role,
        {
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "estimated_calls": 0,
            "provider": provider,
            "model": model,
        },
    )
    role_metrics["calls"] += 1
    role_metrics["input_tokens"] += input_tokens
    role_metrics["output_tokens"] += output_tokens
    role_metrics["total_tokens"] += total_tokens
    role_metrics["provider"] = provider
    role_metrics["model"] = model
    if estimated:
        role_metrics["estimated_calls"] += 1

    bstate = state["branches"].setdefault(branch, {})
    bmetrics = bstate.setdefault("metrics", _blank_metric())
    bmetrics["calls"] += 1
    bmetrics["input_tokens"] += input_tokens
    bmetrics["output_tokens"] += output_tokens
    bmetrics["total_tokens"] += total_tokens
    if estimated:
        bmetrics["estimated_calls"] += 1

    token_event = {
        "ts": _now_iso(),
        "branch": branch,
        "role": role,
        "provider": provider,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "estimated": estimated,
        "error": error,
    }
    token_path = run_dir / f"branches/{branch}/token_events.jsonl"
    token_path.parent.mkdir(parents=True, exist_ok=True)
    with token_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(token_event, sort_keys=True) + "\n")

    summary_path = run_dir / "token_usage_summary.json"
    summary_path.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _expand_patterns(patterns: Iterable[str], branch: str) -> list[str]:
    return [p.replace("{branch}", branch) for p in patterns]


def _can_access(rel_path: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch(rel_path, pattern) for pattern in patterns)


def _collect_readable_paths(run_dir: Path, branch: str, role: str, config: WorkflowConfig) -> list[Path]:
    allow_read = _expand_patterns(config.role_access.get(role, {}).get("read", []), branch)
    readable: list[Path] = []
    for path in sorted(run_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(run_dir).as_posix()
        if _can_access(rel, allow_read):
            readable.append(path)
    return readable


def _write_role_packet(run_dir: Path, branch: str, role: str, config: WorkflowConfig) -> None:
    packet_dir = run_dir / f"branches/{branch}/packets"
    packet_dir.mkdir(parents=True, exist_ok=True)
    packet_path = packet_dir / f"{role}_input.md"
    readable = _collect_readable_paths(run_dir, branch, role, config)

    lines = [f"# Input Packet: {role}", ""]
    if not readable:
        lines.append("No readable files for this role under current access policy.")
    else:
        lines.append("Readable files:")
        for path in readable:
            rel = path.relative_to(run_dir).as_posix()
            lines.append(f"- {rel}")
    lines.append("")
    packet_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _read_context_bundle(run_dir: Path, branch: str, role: str, config: WorkflowConfig) -> str:
    files_for_bundle: list[tuple[str, str]] = []
    for path in _collect_readable_paths(run_dir, branch, role, config):
        rel = path.relative_to(run_dir).as_posix()
        if path.suffix.lower() not in {".md", ".txt", ".json"}:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        files_for_bundle.append((rel, content))
    return build_role_context(role, files_for_bundle)


def _write_role_output(
    run_dir: Path,
    branch: str,
    role: str,
    file_name: str,
    content: str,
    config: WorkflowConfig,
) -> Path:
    rel_path = f"branches/{branch}/context/{file_name}"
    allow_write = _expand_patterns(config.role_access.get(role, {}).get("write", []), branch)
    if not _can_access(rel_path, allow_write):
        raise PermissionError(f"Role '{role}' not allowed to write {rel_path}")

    target = run_dir / rel_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(to_markdown(role, content), encoding="utf-8")
    return target


def _append_event(run_dir: Path, branch: str, text: str) -> None:
    event_path = run_dir / f"branches/{branch}/events.md"
    event_path.parent.mkdir(parents=True, exist_ok=True)
    with event_path.open("a", encoding="utf-8") as fh:
        fh.write(f"- {text}\n")


def _update_ledger(run_dir: Path, branch: str) -> None:
    ctx = run_dir / f"branches/{branch}/context"
    ctx.mkdir(parents=True, exist_ok=True)
    ledger_text = build_knowledge_ledger(ctx)
    (ctx / "knowledge_ledger.md").write_text(ledger_text, encoding="utf-8")


def _scope_decision(run_dir: Path, branch: str, config: WorkflowConfig) -> tuple[bool, str]:
    ctx = run_dir / f"branches/{branch}/context"
    tagged: list[tuple[str, str]] = []
    for path in sorted(ctx.glob("*.md")):
        if path.name.startswith("assumption_delta") or path.name.startswith("scope_decision"):
            continue
        tagged.extend(extract_tagged_lines(path.read_text(encoding="utf-8")))

    counts = count_scope_assumptions(tagged)
    policy = config.policy

    # When the scope gate is disabled (e.g. flexible mode), still write
    # delta files for observability but always allow.
    if not policy.require_scope_gate:
        delta_text = (
            "# Assumption Delta\n\n"
            f"- Added assumptions: {counts.assumptions_added}\n"
            f"- Removed assumptions: {counts.assumptions_removed}\n"
            f"- Scope changes: {counts.scope_changes}\n"
            f"- Mode: {policy.mode}\n"
        )
        decision_text = (
            "# Scope Decision\n\n"
            "- Allowed: yes\n"
            "- Reason: scope gate disabled\n"
        )
        ctx.mkdir(parents=True, exist_ok=True)
        (ctx / "assumption_delta.md").write_text(delta_text, encoding="utf-8")
        (ctx / "scope_decision.md").write_text(decision_text, encoding="utf-8")
        return True, "scope gate disabled"

    allowed = True
    reasons: list[str] = []

    if not policy.allow_scope_changes and counts.scope_changes > 0:
        allowed = False
        reasons.append("scope changes are not allowed in strict mode")
    if counts.scope_changes > policy.max_scope_changes_per_branch:
        allowed = False
        reasons.append(
            f"scope changes ({counts.scope_changes}) exceed max {policy.max_scope_changes_per_branch}"
        )

    if not policy.allow_new_assumptions and counts.assumptions_added > 0:
        allowed = False
        reasons.append("new assumptions are not allowed in strict mode")
    if counts.assumptions_added > policy.max_new_assumptions_per_branch:
        allowed = False
        reasons.append(
            f"new assumptions ({counts.assumptions_added}) exceed max {policy.max_new_assumptions_per_branch}"
        )

    reason_text = "approved"
    if reasons:
        reason_text = "; ".join(reasons)

    delta_text = (
        "# Assumption Delta\n\n"
        f"- Added assumptions: {counts.assumptions_added}\n"
        f"- Removed assumptions: {counts.assumptions_removed}\n"
        f"- Scope changes: {counts.scope_changes}\n"
        f"- Mode: {policy.mode}\n"
    )
    decision_text = (
        "# Scope Decision\n\n"
        f"- Allowed: {'yes' if allowed else 'no'}\n"
        f"- Reason: {reason_text}\n"
    )

    (ctx / "assumption_delta.md").write_text(delta_text, encoding="utf-8")
    (ctx / "scope_decision.md").write_text(decision_text, encoding="utf-8")
    return allowed, reason_text


def _handle_breakdown_amendments(run_dir: Path, branch: str) -> None:
    ctx = run_dir / f"branches/{branch}/context"
    amendments: list[str] = []
    for prover_file in sorted(ctx.glob("prover_*.md")):
        for tag, payload in extract_tagged_lines(prover_file.read_text(encoding="utf-8")):
            if tag == "BREAKDOWN_AMEND":
                amendments.append(payload)

    if not amendments:
        return

    amend_path = ctx / "breakdown_amendments.md"
    lines = ["# Breakdown Amendments", "", "Accepted by orchestrator policy:"]
    for item in amendments:
        lines.append(f"- {item}")
    amend_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    breakdown_path = ctx / "breakdown.md"
    if breakdown_path.exists():
        with breakdown_path.open("a", encoding="utf-8") as fh:
            fh.write("\n## Accepted Amendments\n")
            for item in amendments:
                fh.write(f"- {item}\n")


def _write_run_state(paths: RunPaths, state: dict) -> None:
    write_json(paths.state_path, state)


def _copy_config_snapshot(config_path: Path, run_dir: Path) -> None:
    shutil.copy2(config_path, run_dir / "config.snapshot.toml")


def _resolve_prompts_root(paths: RunPaths, config: WorkflowConfig) -> Path:
    candidate = Path(config.prompts_root)
    if candidate.is_absolute():
        return candidate
    workspace_root = paths.root.parent
    return workspace_root / candidate


def _recommended_phase_from_review_control(review_control: dict[str, str], allowed_tags: list[str]) -> str | None:
    raw = review_control.get("recommended_next_phase", "").strip().upper()
    if not raw:
        return None
    if raw in allowed_tags:
        return _tag_to_phase(raw)
    return None


def _is_soft_scaffolding_run(config: WorkflowConfig, prompts_root: Path) -> bool:
    return config.orchestrator_controls_stop and prompts_root.name == "prompts_soft"


def _next_phase_after_analysis_role(phase: str, config: WorkflowConfig) -> str:
    if phase == "formalizer":
        return "literature" if config.enable_literature else "searcher"
    if phase == "literature":
        return "searcher"
    if phase == "searcher":
        return "breakdown"
    raise ValueError(f"Unsupported analysis phase '{phase}'")


def _soft_role_handoff(
    paths: RunPaths,
    state: dict,
    branch: str,
    *,
    completed_phase: str,
    suggested_phase: str,
    reason: str,
) -> None:
    _handoff_to_orchestrator(
        paths,
        state,
        branch,
        stop_phase=completed_phase,
        suggested_phase=suggested_phase,
        reason=reason,
    )


def _soft_review_suggestion(
    review_control: dict[str, str],
    verdict: ReviewVerdict,
    cycle: int,
    config: WorkflowConfig,
) -> str:
    if verdict.is_pass:
        return _recommended_phase_from_review_control(
            review_control,
            ["CONSOLIDATOR", "PROVER", "BREAKDOWN", "SEARCHER"],
        ) or "consolidator"
    if verdict.needs_small_fix:
        fallback = "prover" if cycle < config.max_prover_cycles else "breakdown"
        return _recommended_phase_from_review_control(
            review_control,
            ["PROVER", "BREAKDOWN", "SEARCHER"],
        ) or fallback
    if verdict.needs_big_fix:
        return _recommended_phase_from_review_control(
            review_control,
            ["BREAKDOWN", "SEARCHER", "PROVER", "STOP_STALL"],
        ) or "breakdown"
    return _recommended_phase_from_review_control(
        review_control,
        ["SEARCHER", "BREAKDOWN", "PROVER", "STOP_STALL"],
    ) or "searcher"


def _hard_review_phase(
    review_control: dict[str, str],
    verdict: ReviewVerdict,
    cycle: int,
    config: WorkflowConfig,
) -> str:
    if verdict.is_pass:
        return _recommended_phase_from_review_control(review_control, ["CONSOLIDATOR", "PROVER"]) or "consolidator"
    if verdict.needs_small_fix:
        if cycle >= config.max_prover_cycles:
            return "stop_stall"
        return _recommended_phase_from_review_control(review_control, ["PROVER"]) or "prover"
    if verdict.needs_big_fix:
        if cycle >= config.max_prover_cycles:
            return "stop_stall"
        return _recommended_phase_from_review_control(
            review_control,
            ["BREAKDOWN", "PROVER", "SEARCHER", "STOP_STALL"],
        ) or "breakdown"
    return _recommended_phase_from_review_control(
        review_control,
        ["STOP_STALL", "PROVER", "SEARCHER", "BREAKDOWN"],
    ) or "stop_stall"


def _get_role_runtime(config: WorkflowConfig, role: str) -> RoleRuntimeConfig:
    runtime = config.role_runtime.get(role)
    if runtime:
        return runtime
    return RoleRuntimeConfig(provider="stub", model="gpt-5-nano", temperature=0.0, max_output_tokens=400)


def _check_budget_limits(state: dict, branch: str, config: WorkflowConfig) -> tuple[bool, str, bool]:
    _ensure_metrics(state)
    _ensure_branch_structures(state)

    global_metrics = state["metrics"]
    branch_metrics = state["branches"].get(branch, {}).get("metrics", _blank_metric())

    if int(global_metrics.get("total_tokens", 0)) > int(config.max_total_tokens):
        return False, "global token budget exceeded", True
    if int(global_metrics.get("calls", 0)) > int(config.max_total_calls):
        return False, "global call budget exceeded", True
    if int(branch_metrics.get("total_tokens", 0)) > int(config.max_tokens_per_branch):
        return False, "branch token budget exceeded", False
    if int(branch_metrics.get("calls", 0)) > int(config.max_calls_per_branch):
        return False, "branch call budget exceeded", False

    return True, "ok", False


def _external_agent_role_output(
    role: str,
    run_dir: Path,
    branch: str,
    prompt_text: str,
    runtime: RoleRuntimeConfig,
    state: dict,
) -> str:
    ext_dir = run_dir / f"branches/{branch}/external_agent"
    ext_dir.mkdir(parents=True, exist_ok=True)

    request_path = ext_dir / f"{role}_request.md"
    response_path = ext_dir / f"{role}_response.md"

    request_text = prompt_text.strip() + "\n"
    request_path.write_text(request_text, encoding="utf-8")

    if response_path.exists():
        content = response_path.read_text(encoding="utf-8", errors="replace").strip()
        if content:
            input_est = _estimate_tokens(request_text)
            output_est = _estimate_tokens(content)
            _record_token_usage(
                run_dir=run_dir,
                state=state,
                branch=branch,
                role=role,
                provider="external_agent",
                model=runtime.model,
                input_tokens=input_est,
                output_tokens=output_est,
                total_tokens=input_est + output_est,
                estimated=True,
            )
            return content

    pending = (
        "## External Agent Pending\n"
        f"[CONJECTURE] Waiting for external agent response file: `{response_path.name}`\n"
    )
    input_est = _estimate_tokens(request_text)
    output_est = _estimate_tokens(pending)
    _record_token_usage(
        run_dir=run_dir,
        state=state,
        branch=branch,
        role=role,
        provider="external_agent",
        model=runtime.model,
        input_tokens=input_est,
        output_tokens=output_est,
        total_tokens=input_est + output_est,
        estimated=True,
        error="external_agent_response_missing",
    )
    raise ExternalAgentPending(branch=branch, role=role, response_path=response_path)


def _call_role_model(
    role: str,
    cycle: int,
    run_dir: Path,
    branch: str,
    state: dict,
    config: WorkflowConfig,
    hub: ProviderHub,
    prompts_root: Path,
) -> str:
    runtime = _get_role_runtime(config, role)
    if runtime.provider.lower() in {"stub", "mock"}:
        stub_text = stub_response(role, cycle=cycle)
        _record_token_usage(
            run_dir=run_dir,
            state=state,
            branch=branch,
            role=role,
            provider=runtime.provider,
            model=runtime.model,
            input_tokens=0,
            output_tokens=_estimate_tokens(stub_text),
            total_tokens=_estimate_tokens(stub_text),
            estimated=True,
        )
        return stub_text

    role_spec = ROLE_SPECS.get(role)
    role_instructions = role_spec.instructions if role_spec else "Return markdown output."

    scope_policy = build_scope_policy(config.policy, role)

    template = load_prompt_template(
        prompts_root,
        role,
        (
            "You are role {role}.\n\n"
            "Role instructions:\n{role_instructions}\n\n"
            "{scope_policy}\n\n"
            "Workflow mode: {mode}\n"
            "Current phase: {current_phase}\n"
            "Branch: {branch}\n\n"
            "Context files:\n{context_bundle}\n\n"
            "Output markdown only."
        ),
    )

    context_bundle = _read_context_bundle(run_dir, branch, role, config)
    prompt = render_template(
        template,
        {
            "role": role,
            "role_instructions": role_instructions,
            "mode": config.mode,
            "current_phase": str(state.get("current_phase", "unknown")),
            "branch": branch,
            "context_bundle": context_bundle,
            "scope_policy": scope_policy,
        },
    )

    if runtime.provider.lower() == "external_agent":
        return _external_agent_role_output(
            role=role,
            run_dir=run_dir,
            branch=branch,
            prompt_text=prompt,
            runtime=runtime,
            state=state,
        )

    system_prompt = role_instructions
    if scope_policy:
        system_prompt = f"{role_instructions}\n\n{scope_policy}"

    req = LLMRequest(
        provider=runtime.provider,
        model=runtime.model,
        system_prompt=system_prompt,
        user_prompt=prompt,
        temperature=runtime.temperature,
        max_output_tokens=runtime.max_output_tokens,
        reasoning_effort=runtime.reasoning_effort,
    )

    try:
        resp = hub.complete(req)
        text = (resp.text or "").strip()
        if not text:
            text = stub_response(role, cycle=cycle)
        _record_token_usage(
            run_dir=run_dir,
            state=state,
            branch=branch,
            role=role,
            provider=runtime.provider,
            model=runtime.model,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            total_tokens=resp.usage.total_tokens,
            estimated=resp.usage.estimated,
        )
        return text
    except Exception as exc:  # noqa: BLE001
        fallback_text = (
            "## Provider Fallback\n"
            f"[CONJECTURE] Provider call failed for role '{role}': {type(exc).__name__}: {exc}\n\n"
            f"{stub_response(role, cycle=cycle)}"
        )
        input_est = _estimate_tokens(req.system_prompt + "\n" + req.user_prompt)
        output_est = _estimate_tokens(fallback_text)
        _record_token_usage(
            run_dir=run_dir,
            state=state,
            branch=branch,
            role=role,
            provider=runtime.provider,
            model=runtime.model,
            input_tokens=input_est,
            output_tokens=output_est,
            total_tokens=input_est + output_est,
            estimated=True,
            error=f"{type(exc).__name__}: {exc}",
        )
        return fallback_text


def _tag_to_phase(tag: str) -> str:
    mapping = {
        "FORMALIZER": "formalizer",
        "LITERATURE": "literature",
        "SEARCHER": "searcher",
        "BREAKDOWN": "breakdown",
        "PROVER": "prover",
        "REVIEWER": "reviewer",
        "CONSOLIDATOR": "consolidator",
        "STOP_PASS": "stop_pass",
        "STOP_FAIL_SCOPE": "stop_fail_scope",
        "STOP_STALL": "stop_stall",
        "STOP_BUDGET": "stop_budget",
    }
    return mapping.get(tag, "")


def _extract_strategy_routes(strategy_text: str) -> list[dict[str, str]]:
    routes: list[dict[str, str]] = []
    current_title = ""
    current_lines: list[str] = []

    for raw_line in strategy_text.splitlines():
        line = raw_line.rstrip()
        match = re.match(r"^\s*([0-9]{1,2})[\).:-]\s*(.+)$", line)
        if match:
            if current_title:
                routes.append(
                    {
                        "title": current_title.strip(),
                        "body": "\n".join(current_lines).strip(),
                    }
                )
            current_title = match.group(2).strip()
            current_lines = []
            continue
        if current_title:
            current_lines.append(line)

    if current_title:
        routes.append(
            {
                "title": current_title.strip(),
                "body": "\n".join(current_lines).strip(),
            }
        )

    if routes:
        return routes

    fallback = strategy_text.strip() or "single-route"
    return [{"title": "default_route", "body": fallback}]


def _branch_score(state: dict, branch: str) -> float:
    bstate = state.get("branches", {}).get(branch, {})
    cycles = int(bstate.get("review_cycles", 0))
    bmetrics = bstate.get("metrics", {})
    tokens = int(bmetrics.get("total_tokens", 0))
    # Higher score is better.
    return 1000.0 - float(cycles * 20) - float(tokens) / 1000.0


def _branch_status_is_terminal(status: str) -> bool:
    return status in {"pass", "fail_scope", "stall", "fail_budget", "invalid_phase", "failed"}


def _spawn_strategy_branches(paths: RunPaths, state: dict, config: WorkflowConfig) -> None:
    if state.get("branches_spawned"):
        return

    run_dir = paths.run_dir
    main_branch = "main"
    main_ctx = run_dir / f"branches/{main_branch}/context"
    strategy_path = main_ctx / "strategy.md"
    strategy_text = strategy_path.read_text(encoding="utf-8", errors="replace") if strategy_path.exists() else ""

    routes = _extract_strategy_routes(strategy_text)
    keep = max(1, int(config.max_branches))
    selected_routes = routes[:keep]
    pruned_routes = routes[keep:]

    branch_order: list[str] = []

    for idx, route in enumerate(selected_routes):
        if idx == 0:
            branch_name = "main"
            state["branches"][branch_name]["selected_route"] = route["title"]
            state["branches"][branch_name]["current_phase"] = "breakdown"
            state["branches"][branch_name]["status"] = "running"

            route_text = (
                "## Selected Route\n"
                f"{route['title']}\n\n"
                "## Route Details\n"
                f"{route['body']}\n"
            )
            strategy_path.write_text(to_markdown("searcher", route_text), encoding="utf-8")
            branch_order.append(branch_name)
            continue

        proposed = sanitize_name(f"route_{idx + 1}_{route['title']}")
        branch_name = proposed
        suffix = 2
        while branch_name in state.get("branches", {}):
            branch_name = f"{proposed}_{suffix}"
            suffix += 1

        src_ctx = run_dir / "branches/main/context"
        dst_ctx = run_dir / f"branches/{branch_name}/context"
        dst_ctx.mkdir(parents=True, exist_ok=True)

        for src_file in sorted(src_ctx.glob("*.md")):
            shutil.copy2(src_file, dst_ctx / src_file.name)

        branch_strategy_path = dst_ctx / "strategy.md"
        branch_strategy_text = (
            "## Selected Route\n"
            f"{route['title']}\n\n"
            "## Route Details\n"
            f"{route['body']}\n"
        )
        branch_strategy_path.write_text(to_markdown("searcher", branch_strategy_text), encoding="utf-8")

        state.setdefault("branches", {})[branch_name] = {
            "status": "running",
            "review_cycles": 0,
            "current_phase": "breakdown",
            "selected_route": route["title"],
            "last_reason": "",
            "score": 0.0,
            "metrics": _blank_metric(),
        }
        branch_order.append(branch_name)

    if pruned_routes:
        state["pruned_branches"] = [r["title"] for r in pruned_routes]

    state["branch_order"] = branch_order if branch_order else ["main"]
    state["branches_spawned"] = True


def _run_prelude(paths: RunPaths, state: dict, config: WorkflowConfig, hub: ProviderHub, prompts_root: Path) -> RunResult | None:
    run_dir = paths.run_dir
    branch = "main"
    soft_mode = _is_soft_scaffolding_run(config, prompts_root)

    state.setdefault("prelude_phase", "formalizer")
    phase = str(state.get("prelude_phase", "formalizer"))
    role_file_name = {
        "formalizer": "formalizer.md",
        "literature": "literature.md",
        "searcher": "strategy.md",
    }

    while phase in {"formalizer", "literature", "searcher"}:
        ok, reason, global_budget = _check_budget_limits(state, branch, config)
        if not ok:
            if config.orchestrator_controls_stop:
                _handoff_to_orchestrator(
                    paths,
                    state,
                    branch,
                    stop_phase="stop_budget",
                    suggested_phase=phase,
                    reason=reason,
                )
            state["status"] = "failed"
            state["current_phase"] = "stop_budget"
            state["branches"][branch]["status"] = "fail_budget"
            state["branches"][branch]["last_reason"] = reason
            _append_event(run_dir, branch, f"budget stop during prelude: {reason}")
            _write_run_state(paths, state)
            return RunResult(run_id=state["run_id"], run_dir=run_dir, status="failed")

        if phase == "literature" and not config.enable_literature:
            phase = "searcher"
            state["prelude_phase"] = phase
            _write_run_state(paths, state)
            continue

        _write_role_packet(run_dir, branch, phase, config)
        content = _call_role_model(
            role=phase,
            cycle=0,
            run_dir=run_dir,
            branch=branch,
            state=state,
            config=config,
            hub=hub,
            prompts_root=prompts_root,
        )
        _write_role_output(run_dir, branch, phase, role_file_name[phase], content, config)
        _append_event(run_dir, branch, f"prelude phase={phase} completed")
        _update_ledger(run_dir, branch)

        ok, reason, _ = _check_budget_limits(state, branch, config)
        if not ok:
            if config.orchestrator_controls_stop:
                _handoff_to_orchestrator(
                    paths,
                    state,
                    branch,
                    stop_phase="stop_budget",
                    suggested_phase=phase,
                    reason=reason,
                )
            state["status"] = "failed"
            state["current_phase"] = "stop_budget"
            state["branches"][branch]["status"] = "fail_budget"
            state["branches"][branch]["last_reason"] = reason
            _append_event(run_dir, branch, f"budget stop after prelude role: {reason}")
            _write_run_state(paths, state)
            return RunResult(run_id=state["run_id"], run_dir=run_dir, status="failed")

        next_phase = _next_phase_after_analysis_role(phase, config)

        if soft_mode:
            _soft_role_handoff(
                paths,
                state,
                branch,
                completed_phase=phase,
                suggested_phase=next_phase,
                reason=(
                    f"soft scaffolding {phase} pass completed; the smart orchestrator should inspect the result "
                    "and choose the next pass"
                ),
            )

        if next_phase == "breakdown":
            state["prelude_done"] = True
            state["prelude_phase"] = "done"
            state["current_phase"] = "scheduler"
            _write_run_state(paths, state)
            return None

        phase = next_phase
        state["prelude_phase"] = phase
        state["current_phase"] = f"prelude_{phase}"
        _write_run_state(paths, state)

    state["prelude_done"] = True
    state["prelude_phase"] = "done"
    state["current_phase"] = "scheduler"
    _write_run_state(paths, state)
    return None


def _run_branch(paths: RunPaths, state: dict, branch: str, config: WorkflowConfig, hub: ProviderHub, prompts_root: Path) -> None:
    run_dir = paths.run_dir
    bstate = state["branches"][branch]
    phase = str(bstate.get("current_phase", "breakdown"))
    soft_mode = _is_soft_scaffolding_run(config, prompts_root)
    analysis_role_output = {
        "formalizer": "formalizer.md",
        "literature": "literature.md",
        "searcher": "strategy.md",
    }

    while True:
        ok, reason, global_budget = _check_budget_limits(state, branch, config)
        if not ok:
            if config.orchestrator_controls_stop:
                _handoff_to_orchestrator(
                    paths,
                    state,
                    branch,
                    stop_phase="stop_budget",
                    suggested_phase=phase,
                    reason=reason,
                )
            bstate["status"] = "fail_budget"
            bstate["current_phase"] = "stop_budget"
            bstate["last_reason"] = reason
            _append_event(run_dir, branch, f"budget stop: {reason}")
            if global_budget:
                state["status"] = "failed"
                state["current_phase"] = "stop_budget"
            return

        if phase in {"formalizer", "literature", "searcher"}:
            if phase == "literature" and not config.enable_literature:
                phase = "searcher"
                bstate["current_phase"] = phase
                _write_run_state(paths, state)
                continue

            _write_role_packet(run_dir, branch, phase, config)
            analysis_content = _call_role_model(
                role=phase,
                cycle=0,
                run_dir=run_dir,
                branch=branch,
                state=state,
                config=config,
                hub=hub,
                prompts_root=prompts_root,
            )
            _write_role_output(run_dir, branch, phase, analysis_role_output[phase], analysis_content, config)
            _update_ledger(run_dir, branch)
            _append_event(run_dir, branch, f"phase={phase} completed")

            ok, reason, _ = _check_budget_limits(state, branch, config)
            if not ok:
                if config.orchestrator_controls_stop:
                    _handoff_to_orchestrator(
                        paths,
                        state,
                        branch,
                        stop_phase="stop_budget",
                        suggested_phase=phase,
                        reason=reason,
                    )
                bstate["status"] = "fail_budget"
                bstate["current_phase"] = "stop_budget"
                bstate["last_reason"] = reason
                _append_event(run_dir, branch, f"budget stop after {phase}: {reason}")
                if global_budget:
                    state["status"] = "failed"
                    state["current_phase"] = "stop_budget"
                return

            next_phase = _next_phase_after_analysis_role(phase, config)
            if soft_mode:
                _soft_role_handoff(
                    paths,
                    state,
                    branch,
                    completed_phase=phase,
                    suggested_phase=next_phase,
                    reason=(
                        f"soft scaffolding {phase} pass completed on branch {branch}; the smart orchestrator should "
                        "inspect the result and choose the next pass"
                    ),
                )

            phase = next_phase
            bstate["current_phase"] = phase
            _write_run_state(paths, state)
            continue

        if phase == "breakdown":
            _write_role_packet(run_dir, branch, "breakdown", config)
            breakdown_content = _call_role_model(
                role="breakdown",
                cycle=0,
                run_dir=run_dir,
                branch=branch,
                state=state,
                config=config,
                hub=hub,
                prompts_root=prompts_root,
            )
            _write_role_output(run_dir, branch, "breakdown", "breakdown.md", breakdown_content, config)
            _update_ledger(run_dir, branch)
            _append_event(run_dir, branch, "phase=breakdown completed")

            if soft_mode:
                _soft_role_handoff(
                    paths,
                    state,
                    branch,
                    completed_phase="breakdown",
                    suggested_phase="prover",
                    reason=(
                        f"soft scaffolding breakdown pass completed on branch {branch}; the smart orchestrator should "
                        "decide whether to prove, re-search, or revise the route"
                    ),
                )

            phase = "prover"
            bstate["current_phase"] = phase
            _write_run_state(paths, state)
            continue

        if phase == "prover":
            cycle = int(bstate.get("review_cycles", 0)) + 1
            if cycle > config.max_prover_cycles:
                if config.orchestrator_controls_stop:
                    _handoff_to_orchestrator(
                        paths,
                        state,
                        branch,
                        stop_phase="stop_stall",
                        suggested_phase="breakdown",
                        reason="max prover cycles reached",
                    )
                bstate["status"] = "stall"
                bstate["current_phase"] = "stop_stall"
                bstate["last_reason"] = "max prover cycles reached"
                _append_event(run_dir, branch, "run terminated: STALL (max cycles)")
                return

            _write_role_packet(run_dir, branch, "prover", config)
            prover_content = _call_role_model(
                role="prover",
                cycle=cycle - 1,
                run_dir=run_dir,
                branch=branch,
                state=state,
                config=config,
                hub=hub,
                prompts_root=prompts_root,
            )
            _write_role_output(run_dir, branch, "prover", f"prover_{cycle:02d}.md", prover_content, config)
            _handle_breakdown_amendments(run_dir, branch)
            _update_ledger(run_dir, branch)
            _append_event(run_dir, branch, f"prover cycle={cycle} completed")

            if soft_mode:
                _soft_role_handoff(
                    paths,
                    state,
                    branch,
                    completed_phase="prover",
                    suggested_phase="reviewer",
                    reason=(
                        f"soft scaffolding prover pass completed on branch {branch}; the smart orchestrator should "
                        "inspect the proof attempt before routing the next pass"
                    ),
                )

            phase = "reviewer"
            bstate["current_phase"] = phase
            _write_run_state(paths, state)
            continue

        if phase == "reviewer":
            cycle = int(bstate.get("review_cycles", 0)) + 1
            _write_role_packet(run_dir, branch, "reviewer", config)
            reviewer_content = _call_role_model(
                role="reviewer",
                cycle=cycle - 1,
                run_dir=run_dir,
                branch=branch,
                state=state,
                config=config,
                hub=hub,
                prompts_root=prompts_root,
            )
            _write_role_output(run_dir, branch, "reviewer", f"reviewer_{cycle:02d}.md", reviewer_content, config)
            _update_ledger(run_dir, branch)

            _write_role_packet(run_dir, branch, "scope_keeper", config)
            allowed_scope, scope_reason = _scope_decision(run_dir, branch, config)

            bstate["review_cycles"] = cycle
            review_control = parse_review_control(reviewer_content)
            if review_control:
                bstate["last_review_control"] = review_control
            verdict = parse_review_verdict(reviewer_content)
            bstate["last_verdict"] = verdict.level
            _write_run_state(paths, state)

            if not allowed_scope:
                if soft_mode:
                    suggested_phase = _recommended_phase_from_review_control(
                        review_control,
                        ["BREAKDOWN", "SEARCHER", "PROVER"],
                    ) or "breakdown"
                    _soft_role_handoff(
                        paths,
                        state,
                        branch,
                        completed_phase="reviewer",
                        suggested_phase=suggested_phase,
                        reason=f"scope rejected: {scope_reason}",
                    )
                phase = "stop_fail_scope"
            else:
                if soft_mode:
                    suggested_phase = _soft_review_suggestion(review_control, verdict, cycle, config)
                    _soft_role_handoff(
                        paths,
                        state,
                        branch,
                        completed_phase="reviewer",
                        suggested_phase=suggested_phase,
                        reason=f"review verdict={verdict.level}",
                    )
                phase = _hard_review_phase(review_control, verdict, cycle, config)

            if soft_mode and phase == "stop_stall":
                _soft_role_handoff(
                    paths,
                    state,
                    branch,
                    completed_phase="reviewer",
                    suggested_phase="breakdown",
                    reason="review indicated the branch is stalled",
                )

            bstate["current_phase"] = phase
            _append_event(run_dir, branch, f"reviewer cycle={cycle} verdict={verdict.level} next={phase}")
            _write_run_state(paths, state)
            continue

        if phase == "consolidator":
            _write_role_packet(run_dir, branch, "consolidator", config)
            final_content = _call_role_model(
                role="consolidator",
                cycle=0,
                run_dir=run_dir,
                branch=branch,
                state=state,
                config=config,
                hub=hub,
                prompts_root=prompts_root,
            )
            _write_role_output(run_dir, branch, "consolidator", "final_report.md", final_content, config)
            _update_ledger(run_dir, branch)
            _append_event(run_dir, branch, "phase=consolidator completed")

            if soft_mode:
                _soft_role_handoff(
                    paths,
                    state,
                    branch,
                    completed_phase="consolidator",
                    suggested_phase="",
                    reason=(
                        f"soft scaffolding consolidator pass completed on branch {branch}; the smart orchestrator should "
                        "decide whether to stop, revise, or launch another role"
                    ),
                )
            phase = "stop_pass"
            bstate["current_phase"] = phase
            _write_run_state(paths, state)
            continue

        if phase == "stop_fail_scope":
            if config.orchestrator_controls_stop:
                _handoff_to_orchestrator(
                    paths,
                    state,
                    branch,
                    stop_phase=phase,
                    suggested_phase="breakdown",
                    reason="scope rejected",
                )
            bstate["status"] = "fail_scope"
            bstate["last_reason"] = "scope rejected"
            _append_event(run_dir, branch, "run terminated: FAIL_SCOPE")
            return

        if phase == "stop_stall":
            if config.orchestrator_controls_stop:
                _handoff_to_orchestrator(
                    paths,
                    state,
                    branch,
                    stop_phase=phase,
                    suggested_phase="breakdown",
                    reason="stalled",
                )
            bstate["status"] = "stall"
            bstate["last_reason"] = "stalled"
            _append_event(run_dir, branch, "run terminated: STALL")
            return

        if phase == "stop_budget":
            if config.orchestrator_controls_stop:
                _handoff_to_orchestrator(
                    paths,
                    state,
                    branch,
                    stop_phase=phase,
                    suggested_phase="breakdown",
                    reason="budget exceeded",
                )
            bstate["status"] = "fail_budget"
            bstate["last_reason"] = "budget exceeded"
            _append_event(run_dir, branch, "run terminated: FAIL_BUDGET")
            return

        if phase == "stop_pass":
            bstate["status"] = "pass"
            bstate["current_phase"] = "done"
            bstate["score"] = _branch_score(state, branch)
            bstate["last_reason"] = "proof branch completed"
            _append_event(run_dir, branch, "branch complete: PASS")
            return

        bstate["status"] = "invalid_phase"
        bstate["last_reason"] = f"invalid phase {phase}"
        _append_event(run_dir, branch, f"run terminated: invalid phase '{phase}'")
        return


def _run_scheduler(paths: RunPaths, state: dict, config: WorkflowConfig, hub: ProviderHub, prompts_root: Path) -> RunResult:
    run_dir = paths.run_dir

    while True:
        if state.get("status") == "waiting_orchestrator":
            _write_run_state(paths, state)
            return RunResult(run_id=state["run_id"], run_dir=run_dir, status="waiting_orchestrator")

        active = [b for b in state.get("branch_order", []) if state["branches"].get(b, {}).get("status") == "running"]
        if not active:
            break

        for branch in active:
            _run_branch(paths, state, branch, config, hub, prompts_root)
            _write_run_state(paths, state)

            if state.get("status") == "failed" and state.get("current_phase") == "stop_budget":
                for b in state.get("branch_order", []):
                    if state["branches"].get(b, {}).get("status") == "running":
                        state["branches"][b]["status"] = "fail_budget"
                        state["branches"][b]["last_reason"] = "global budget exceeded"
                _write_run_state(paths, state)
                return RunResult(run_id=state["run_id"], run_dir=run_dir, status="failed")

    pass_branches = [b for b in state.get("branch_order", []) if state["branches"].get(b, {}).get("status") == "pass"]
    if pass_branches:
        winner = sorted(pass_branches, key=lambda b: state["branches"][b].get("score", 0.0), reverse=True)[0]
        state["winning_branch"] = winner
        state["status"] = "complete"
        state["current_phase"] = "done"
        _append_event(run_dir, winner, f"run complete: winner={winner}")
        _write_run_state(paths, state)
        return RunResult(run_id=state["run_id"], run_dir=run_dir, status="complete")

    state["status"] = "failed"
    state["current_phase"] = "done"
    _write_run_state(paths, state)
    return RunResult(run_id=state["run_id"], run_dir=run_dir, status="failed")


def start_run(claim_text: str, config: WorkflowConfig, config_path: Path, workspace_root: Path) -> RunResult:
    run_root = workspace_root / config.run_root
    run_root.mkdir(parents=True, exist_ok=True)

    run_id = make_run_id()
    paths = init_run_dir(run_root, run_id)

    (paths.run_dir / "claim.md").write_text(f"# Original Claim\n\n{claim_text.strip()}\n", encoding="utf-8")
    _copy_config_snapshot(config_path, paths.run_dir)

    state = {
        "run_id": run_id,
        "status": "running",
        "current_phase": "prelude",
        "prelude_done": False,
        "prelude_phase": "formalizer",
        "branches_spawned": False,
        "branch_order": ["main"],
        "pruned_branches": [],
        "winning_branch": "",
        "branches": {
            "main": {
                "status": "running",
                "review_cycles": 0,
                "current_phase": "formalizer",
                "selected_route": "",
                "last_reason": "",
                "score": 0.0,
                "metrics": _blank_metric(),
            }
        },
        "mode": config.mode,
    }
    _ensure_metrics(state)
    _ensure_branch_structures(state)
    _write_run_state(paths, state)

    return _continue_run(paths, config)


def resume_run(run_id: str, config: WorkflowConfig, workspace_root: Path) -> RunResult:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    return _continue_run(paths, config)


def orchestrator_continue_run(
    *,
    run_id: str,
    config: WorkflowConfig,
    workspace_root: Path,
    branch: str,
    phase: str,
) -> RunResult:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    state = read_json(paths.state_path)
    _ensure_metrics(state)
    _ensure_branch_structures(state)

    if state.get("status") != "waiting_orchestrator":
        raise RuntimeError(f"Run {run_id} is not waiting on orchestrator judgment.")
    if branch not in state.get("branches", {}):
        raise RuntimeError(f"Unknown branch '{branch}' for run {run_id}.")

    allowed_phases = {"formalizer", "literature", "searcher", "breakdown", "prover", "reviewer", "consolidator"}
    normalized_phase = phase.strip().lower()
    if normalized_phase not in allowed_phases:
        raise RuntimeError(f"Unsupported orchestrator continue phase '{phase}'.")

    bstate = state["branches"][branch]
    _clear_external_agent_artifacts(paths.run_dir, branch, normalized_phase)
    bstate["status"] = "running"
    bstate["current_phase"] = normalized_phase
    bstate["last_reason"] = f"continued by orchestrator into {normalized_phase}"
    _clear_orchestrator_decision(state, branch)
    state["status"] = "running"
    if normalized_phase in {"formalizer", "literature", "searcher"} and not state.get("prelude_done", False):
        state["prelude_done"] = False
        state["prelude_phase"] = normalized_phase
        state["current_phase"] = f"prelude_{normalized_phase}"
    elif not state.get("prelude_done", False) and normalized_phase == "breakdown":
        state["prelude_done"] = True
        state["prelude_phase"] = "done"
        state["current_phase"] = "scheduler"
    elif not state.get("prelude_done", False):
        state["prelude_done"] = True
        state["prelude_phase"] = "done"
        if not state.get("branches_spawned", False):
            state["branches_spawned"] = True
            state["branch_order"] = [branch]
            state["pruned_branches"] = []
        state["current_phase"] = "scheduler"
    else:
        state["current_phase"] = "scheduler"
    _append_event(paths.run_dir, branch, f"orchestrator continue: next={normalized_phase}")
    _write_run_state(paths, state)
    return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status="running")


def orchestrator_revive_run(
    *,
    run_id: str,
    config: WorkflowConfig,
    workspace_root: Path,
    branch: str,
    stop_phase: str = "",
    suggested_phase: str = "",
    reason: str = "",
) -> RunResult:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    state = read_json(paths.state_path)
    _ensure_metrics(state)
    _ensure_branch_structures(state)

    if branch not in state.get("branches", {}):
        raise RuntimeError(f"Unknown branch '{branch}' for run {run_id}.")

    bstate = state["branches"][branch]
    inferred_stop_phase = stop_phase.strip().lower() or str(bstate.get("current_phase", "")).strip().lower()
    if not inferred_stop_phase.startswith("stop_"):
        inferred_stop_phase = "stop_stall"

    suggested = suggested_phase.strip().lower()
    if not suggested:
        suggested = "breakdown" if inferred_stop_phase in {"stop_fail_scope", "stop_stall", "stop_budget"} else "prover"

    decision_payload = {
        "branch": branch,
        "stop_phase": inferred_stop_phase,
        "suggested_phase": suggested,
        "reason": reason or bstate.get("last_reason", "") or "revived terminal soft-scaffolding run",
    }

    bstate["status"] = "orchestrator_review"
    bstate["current_phase"] = "orchestrator_review"
    bstate["last_reason"] = decision_payload["reason"]
    bstate["pending_orchestrator_decision"] = decision_payload
    state["status"] = "waiting_orchestrator"
    state["current_phase"] = f"waiting_orchestrator:{branch}:{inferred_stop_phase}"
    state["pending_orchestrator_decision"] = decision_payload
    state["winning_branch"] = ""
    state.pop("pending_external_agent", None)
    _append_event(
        paths.run_dir,
        branch,
        f"orchestrator revive: stop_phase={inferred_stop_phase} suggested_phase={suggested} reason={decision_payload['reason']}",
    )
    _write_run_state(paths, state)
    return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status="waiting_orchestrator")


def orchestrator_stop_run(
    *,
    run_id: str,
    config: WorkflowConfig,
    workspace_root: Path,
    final_status: str = "failed",
    branch: str = "",
    reason: str = "",
) -> RunResult:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    state = read_json(paths.state_path)
    _ensure_metrics(state)
    _ensure_branch_structures(state)

    if final_status not in {"failed", "complete"}:
        raise RuntimeError(f"Unsupported orchestrator stop status '{final_status}'.")

    pending = state.get("pending_orchestrator_decision", {})
    target_branch = branch or str(pending.get("branch", "") or (state.get("winning_branch") or "main"))
    if target_branch and target_branch not in state.get("branches", {}):
        raise RuntimeError(f"Unknown branch '{target_branch}' for run {run_id}.")

    if target_branch:
        bstate = state["branches"][target_branch]
        bstate["current_phase"] = "done"
        bstate["last_reason"] = reason or f"stopped by orchestrator as {final_status}"
        bstate["status"] = "pass" if final_status == "complete" else "failed"
        if final_status == "complete":
            bstate["score"] = _branch_score(state, target_branch)
            state["winning_branch"] = target_branch
        _append_event(paths.run_dir, target_branch, f"orchestrator stop: status={final_status} reason={reason or '-'}")

    _clear_orchestrator_decision(state, target_branch)
    state["status"] = final_status
    state["current_phase"] = "done"
    _write_run_state(paths, state)
    return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status=final_status)


def _continue_run(paths: RunPaths, config: WorkflowConfig) -> RunResult:
    state = read_json(paths.state_path)
    _ensure_metrics(state)
    _ensure_branch_structures(state)

    if state.get("status") == "waiting_orchestrator":
        return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status="waiting_orchestrator")

    if state.get("status") in {"complete", "failed"} and state.get("current_phase") == "done":
        return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status=state["status"])

    if state.get("status") == "waiting_external_agent":
        state["status"] = "running"
        state.pop("pending_external_agent", None)
        _write_run_state(paths, state)

    hub = ProviderHub(timeout_seconds=config.provider_timeout_seconds)
    prompts_root = _resolve_prompts_root(paths, config)

    try:
        if not state.get("prelude_done", False):
            prelude_result = _run_prelude(paths, state, config, hub, prompts_root)
            if prelude_result is not None:
                return prelude_result

        if not state.get("branches_spawned", False):
            _spawn_strategy_branches(paths, state, config)
            state["current_phase"] = "scheduler"
            _write_run_state(paths, state)

        return _run_scheduler(paths, state, config, hub, prompts_root)
    except ExternalAgentPending as pending:
        state["status"] = "waiting_external_agent"
        state["pending_external_agent"] = {
            "branch": pending.branch,
            "role": pending.role,
            "response_path": str(pending.response_path),
        }
        state["current_phase"] = f"waiting_external_agent:{pending.branch}:{pending.role}"
        _write_run_state(paths, state)
        return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status="waiting_external_agent")
    except OrchestratorDecisionPending:
        return RunResult(run_id=state["run_id"], run_dir=paths.run_dir, status="waiting_orchestrator")


def inspect_run(run_id: str, config: WorkflowConfig, workspace_root: Path) -> str:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    state = read_json(paths.state_path)

    lines = [
        f"Run ID: {state.get('run_id')}",
        f"Status: {state.get('status')}",
        f"Mode: {state.get('mode')}",
        f"Current phase: {state.get('current_phase')}",
        f"Prelude done: {state.get('prelude_done')}",
        f"Run dir: {paths.run_dir}",
        "",
        "Tokens:",
        f"- calls={state.get('metrics', {}).get('calls', 0)}",
        f"- input={state.get('metrics', {}).get('input_tokens', 0)}",
        f"- output={state.get('metrics', {}).get('output_tokens', 0)}",
        f"- total={state.get('metrics', {}).get('total_tokens', 0)}",
        f"- estimated_calls={state.get('metrics', {}).get('estimated_calls', 0)}",
        "",
        "Branches:",
    ]

    branches = state.get("branches", {})
    for name in state.get("branch_order", []):
        bstate = branches.get(name, {})
        bmetrics = bstate.get("metrics", {})
        lines.append(
            (
                f"- {name}: status={bstate.get('status')} phase={bstate.get('current_phase')} "
                f"cycles={bstate.get('review_cycles')} tokens={bmetrics.get('total_tokens', 0)} "
                f"route={bstate.get('selected_route', '')}"
            )
        )

    if state.get("winning_branch"):
        lines.append("")
        lines.append(f"Winner: {state.get('winning_branch')}")

    if state.get("pending_external_agent"):
        pending = state["pending_external_agent"]
        lines.append("")
        lines.append("Pending External Agent:")
        lines.append(f"- branch={pending.get('branch')}")
        lines.append(f"- role={pending.get('role')}")
        lines.append(f"- response_path={pending.get('response_path')}")

    if state.get("pruned_branches"):
        lines.append("")
        lines.append("Pruned Routes:")
        for route in state.get("pruned_branches", []):
            lines.append(f"- {route}")

    return "\n".join(lines)


def report_run(run_id: str, config: WorkflowConfig, workspace_root: Path) -> str:
    run_root = workspace_root / config.run_root
    paths = load_run_paths(run_root, run_id)
    state = read_json(paths.state_path)

    metrics = state.get("metrics", {})
    by_role = metrics.get("by_role", {})

    lines = [
        f"Run Report: {run_id}",
        f"Status: {state.get('status')}",
        f"Mode: {state.get('mode')}",
        f"Winning branch: {state.get('winning_branch', '') or '(none)'}",
        "",
        "Global Usage:",
        f"- calls={metrics.get('calls', 0)}",
        f"- input_tokens={metrics.get('input_tokens', 0)}",
        f"- output_tokens={metrics.get('output_tokens', 0)}",
        f"- total_tokens={metrics.get('total_tokens', 0)}",
        f"- estimated_calls={metrics.get('estimated_calls', 0)}",
        "",
        "Branch Results:",
    ]

    for branch in state.get("branch_order", []):
        bstate = state.get("branches", {}).get(branch, {})
        bmetrics = bstate.get("metrics", {})
        lines.append(
            (
                f"- {branch}: status={bstate.get('status')} score={bstate.get('score', 0):.2f} "
                f"cycles={bstate.get('review_cycles', 0)} tokens={bmetrics.get('total_tokens', 0)} "
                f"reason={bstate.get('last_reason', '')}"
            )
        )

    lines.append("")
    lines.append("Role Usage:")
    ordered_roles = sorted(
        by_role.items(),
        key=lambda item: int(item[1].get("total_tokens", 0)),
        reverse=True,
    )
    for role, data in ordered_roles:
        lines.append(
            (
                f"- {role}: provider={data.get('provider')} model={data.get('model')} "
                f"calls={data.get('calls', 0)} total_tokens={data.get('total_tokens', 0)} "
                f"estimated_calls={data.get('estimated_calls', 0)}"
            )
        )

    if state.get("pruned_branches"):
        lines.append("")
        lines.append("Pruned Routes:")
        for route in state.get("pruned_branches", []):
            lines.append(f"- {route}")

    return "\n".join(lines)
