from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
import tomllib

from .policies import ModePolicy, load_mode_policy


@dataclass
class RoleRuntimeConfig:
    provider: str
    model: str
    temperature: float
    max_output_tokens: int
    reasoning_effort: str = "high"


@dataclass
class WorkflowConfig:
    mode: str
    policy: ModePolicy
    enable_literature: bool
    max_branches: int
    max_prover_cycles: int
    max_total_tokens: int
    max_tokens_per_branch: int
    max_total_calls: int
    max_calls_per_branch: int
    run_root: str
    prompts_root: str
    orchestrator_controls_stop: bool
    provider_timeout_seconds: int
    role_runtime: dict[str, RoleRuntimeConfig]
    provider_browser_agent: str
    smoke_models: dict[str, str]
    role_access: dict[str, dict[str, list[str]]]


DEFAULT_ROLE_ACCESS: dict[str, dict[str, list[str]]] = {
    "formalizer": {
        "read": ["claim.md", "branches/{branch}/context/*.md"],
        "write": ["branches/{branch}/context/formalizer.md"],
    },
    "literature": {
        "read": ["claim.md", "branches/{branch}/context/formalizer.md"],
        "write": ["branches/{branch}/context/literature.md"],
    },
    "searcher": {
        "read": ["claim.md", "branches/{branch}/context/formalizer.md", "branches/{branch}/context/literature.md"],
        "write": ["branches/{branch}/context/strategy.md"],
    },
    "breakdown": {
        "read": ["branches/{branch}/context/strategy.md", "branches/{branch}/context/formalizer.md"],
        "write": ["branches/{branch}/context/breakdown.md"],
    },
    "prover": {
        "read": ["branches/{branch}/context/*.md"],
        "write": ["branches/{branch}/context/prover_*.md"],
    },
    "reviewer": {
        "read": ["branches/{branch}/context/*.md"],
        "write": ["branches/{branch}/context/reviewer_*.md"],
    },
    "scope_keeper": {
        "read": ["branches/{branch}/context/*.md"],
        "write": ["branches/{branch}/context/scope_*.md", "branches/{branch}/context/assumption_delta.md"],
    },
    "consolidator": {
        "read": ["branches/{branch}/context/*.md", "claim.md"],
        "write": ["branches/{branch}/context/final_report.md"],
    },
}


DEFAULT_ROLE_RUNTIME: dict[str, RoleRuntimeConfig] = {
    "formalizer": RoleRuntimeConfig("stub", "gpt-5-mini", 0.2, 1200, reasoning_effort="high"),
    "literature": RoleRuntimeConfig("stub", "gpt-5-mini", 0.2, 1200, reasoning_effort="medium"),
    "searcher": RoleRuntimeConfig("stub", "gpt-5-mini", 0.3, 1200, reasoning_effort="high"),
    "breakdown": RoleRuntimeConfig("stub", "gpt-5-mini", 0.2, 1200, reasoning_effort="high"),
    "prover": RoleRuntimeConfig("stub", "gpt-5-mini", 0.2, 1200, reasoning_effort="high"),
    "reviewer": RoleRuntimeConfig("stub", "gpt-5-nano", 0.0, 600, reasoning_effort="high"),
    "consolidator": RoleRuntimeConfig("stub", "gpt-5-mini", 0.2, 1600, reasoning_effort="medium"),
}


DEFAULT_SMOKE_MODELS: dict[str, str] = {
    "openai": "gpt-5-nano",
    "anthropic": "claude-3-5-haiku-latest",
    "gemini": "gemini-2.0-flash",
}


def _read_toml(path: Path) -> dict[str, Any]:
    with path.open("rb") as fh:
        return tomllib.load(fh)


def _parse_role_runtime(role_runtime_data: dict[str, Any]) -> dict[str, RoleRuntimeConfig]:
    parsed: dict[str, RoleRuntimeConfig] = {}
    for role, defaults in DEFAULT_ROLE_RUNTIME.items():
        incoming = role_runtime_data.get(role, {})
        parsed[role] = RoleRuntimeConfig(
            provider=str(incoming.get("provider", defaults.provider)),
            model=str(incoming.get("model", defaults.model)),
            temperature=float(incoming.get("temperature", defaults.temperature)),
            max_output_tokens=int(incoming.get("max_output_tokens", defaults.max_output_tokens)),
            reasoning_effort=str(incoming.get("reasoning_effort", defaults.reasoning_effort)),
        )
    return parsed


def load_config(path: Path) -> WorkflowConfig:
    data = _read_toml(path)

    wf = data.get("workflow", {})
    providers = data.get("providers", {})
    role_access = data.get("role_access", {})
    role_runtime_data = data.get("role_runtime", {})
    smoke_models_in = data.get("smoke_models", {})

    mode = str(wf.get("mode", "semi_strict"))
    policy = load_mode_policy(mode)
    policy_overrides: dict[str, Any] = {}
    if "policy_allow_scope_changes" in wf:
        policy_overrides["allow_scope_changes"] = bool(wf.get("policy_allow_scope_changes"))
    if "policy_allow_new_assumptions" in wf:
        policy_overrides["allow_new_assumptions"] = bool(wf.get("policy_allow_new_assumptions"))
    if "policy_max_scope_changes_per_branch" in wf:
        policy_overrides["max_scope_changes_per_branch"] = int(wf.get("policy_max_scope_changes_per_branch"))
    if "policy_max_new_assumptions_per_branch" in wf:
        policy_overrides["max_new_assumptions_per_branch"] = int(wf.get("policy_max_new_assumptions_per_branch"))
    if "policy_require_scope_gate" in wf:
        policy_overrides["require_scope_gate"] = bool(wf.get("policy_require_scope_gate"))
    if policy_overrides:
        policy = replace(policy, **policy_overrides)

    parsed_role_access: dict[str, dict[str, list[str]]] = {}
    for role, defaults in DEFAULT_ROLE_ACCESS.items():
        incoming = role_access.get(role, {})
        parsed_role_access[role] = {
            "read": list(incoming.get("read", defaults["read"])),
            "write": list(incoming.get("write", defaults["write"])),
        }

    smoke_models: dict[str, str] = {}
    for provider, default_model in DEFAULT_SMOKE_MODELS.items():
        smoke_models[provider] = str(smoke_models_in.get(provider, default_model))

    return WorkflowConfig(
        mode=mode,
        policy=policy,
        enable_literature=bool(wf.get("enable_literature", True)),
        max_branches=int(wf.get("max_branches", 2)),
        max_prover_cycles=int(wf.get("max_prover_cycles", 3)),
        max_total_tokens=int(wf.get("max_total_tokens", 2_000_000)),
        max_tokens_per_branch=int(wf.get("max_tokens_per_branch", 1_000_000)),
        max_total_calls=int(wf.get("max_total_calls", 20_000)),
        max_calls_per_branch=int(wf.get("max_calls_per_branch", 5_000)),
        run_root=str(wf.get("run_root", "runs")),
        prompts_root=str(wf.get("prompts_root", "prompts")),
        orchestrator_controls_stop=bool(wf.get("orchestrator_controls_stop", False)),
        provider_timeout_seconds=int(wf.get("provider_timeout_seconds", 60)),
        role_runtime=_parse_role_runtime(role_runtime_data),
        provider_browser_agent=str(providers.get("browser_agent", "external_agent")),
        smoke_models=smoke_models,
        role_access=parsed_role_access,
    )
