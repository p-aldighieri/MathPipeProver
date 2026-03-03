from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModePolicy:
    mode: str
    allow_scope_changes: bool
    allow_new_assumptions: bool
    max_scope_changes_per_branch: int
    max_new_assumptions_per_branch: int
    require_scope_gate: bool


DEFAULT_MODE_POLICIES: dict[str, ModePolicy] = {
    "strict": ModePolicy(
        mode="strict",
        allow_scope_changes=False,
        allow_new_assumptions=False,
        max_scope_changes_per_branch=0,
        max_new_assumptions_per_branch=0,
        require_scope_gate=True,
    ),
    "semi_strict": ModePolicy(
        mode="semi_strict",
        allow_scope_changes=True,
        allow_new_assumptions=True,
        max_scope_changes_per_branch=2,
        max_new_assumptions_per_branch=2,
        require_scope_gate=True,
    ),
    "flexible": ModePolicy(
        mode="flexible",
        allow_scope_changes=True,
        allow_new_assumptions=True,
        max_scope_changes_per_branch=6,
        max_new_assumptions_per_branch=6,
        require_scope_gate=False,
    ),
}


def load_mode_policy(mode: str) -> ModePolicy:
    key = mode.strip().lower()
    if key not in DEFAULT_MODE_POLICIES:
        allowed = ", ".join(sorted(DEFAULT_MODE_POLICIES))
        raise ValueError(f"Unknown mode '{mode}'. Allowed: {allowed}")
    return DEFAULT_MODE_POLICIES[key]
