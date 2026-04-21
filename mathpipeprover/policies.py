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
        max_scope_changes_per_branch=5,
        max_new_assumptions_per_branch=5,
        require_scope_gate=True,
    ),
    "flexible": ModePolicy(
        mode="flexible",
        allow_scope_changes=True,
        allow_new_assumptions=True,
        max_scope_changes_per_branch=999,
        max_new_assumptions_per_branch=999,
        require_scope_gate=False,
    ),
}


def load_mode_policy(mode: str) -> ModePolicy:
    key = mode.strip().lower()
    if key not in DEFAULT_MODE_POLICIES:
        allowed = ", ".join(sorted(DEFAULT_MODE_POLICIES))
        raise ValueError(f"Unknown mode '{mode}'. Allowed: {allowed}")
    return DEFAULT_MODE_POLICIES[key]


# ---------------------------------------------------------------------------
# Scope-policy injection: prose paragraphs injected into role prompts so
# models understand and self-enforce scope rules.  Tag-counting in
# _scope_decision() remains as a mechanical backstop.
# ---------------------------------------------------------------------------

ROLE_CATEGORY: dict[str, str] = {
    "prover": "generative",
    "breakdown": "generative",
    "formalizer": "generative",
    "reviewer": "evaluative",
    "searcher": "planning",
    "literature": "planning",
    "consolidator": "consolidator",
    "scope_keeper": "backstop",
}

# mode × category → prose paragraph.  {max_new_assumptions} and
# {max_scope_changes} are filled at runtime from the active ModePolicy.
SCOPE_POLICY_TEXT: dict[tuple[str, str], str] = {
    # ---- strict ----
    ("strict", "generative"): (
        "SCOPE POLICY (strict): Do NOT introduce any new assumptions beyond "
        "those already stated by the user. Do NOT change the scope of the "
        "claim. Any line tagged [ASSUMPTION+] or [SCOPE] will cause the "
        "branch to be rejected by the scope gate. If you cannot proceed "
        "without a new assumption, state the gap explicitly and stop."
    ),
    ("strict", "evaluative"): (
        "SCOPE POLICY (strict): Reject the proof if ANY new assumptions "
        "(tagged [ASSUMPTION+] or untagged) or scope changes (tagged [SCOPE]) "
        "are present. Zero tolerance — even a single new assumption means "
        "the verdict cannot be PASS."
    ),
    ("strict", "planning"): (
        "SCOPE POLICY (strict): All proposed strategies and literature "
        "references must stay within the original claim scope. Do not "
        "suggest approaches that require additional assumptions."
    ),
    ("strict", "consolidator"): (
        "SCOPE POLICY (strict): The final report must use only the original "
        "user assumptions. Flag any residual [ASSUMPTION+] as an unresolved "
        "issue — the proof is incomplete if new assumptions remain."
    ),
    # ---- semi_strict ----
    ("semi_strict", "generative"): (
        "SCOPE POLICY (semi-strict): New assumptions are allowed when "
        "genuinely needed, but exercise restraint. Before introducing one, "
        "ask yourself: does this keep the problem faithful to the original "
        "formulation, or am I steering it toward an easier variant? The "
        "result should still be recognizably the problem the user asked "
        "about. Every new assumption MUST be tagged [ASSUMPTION+] with a "
        "justification explaining why it is necessary and why the proof "
        "cannot proceed without it. Scope changes must be tagged [SCOPE]. "
        "Untagged assumptions will be treated as errors."
    ),
    ("semi_strict", "evaluative"): (
        "SCOPE POLICY (semi-strict): New assumptions are acceptable if they "
        "are few, well-justified, and preserve the character of the original "
        "problem. Push back if assumptions feel like they are simplifying the "
        "problem rather than enabling the proof — the user asked about a "
        "specific claim and the proof should answer that claim, not a more "
        "convenient one. Flag any untagged new assumptions as errors. If the "
        "accumulated assumptions substantially change what is being proved, "
        "the verdict must reflect this as scope drift."
    ),
    ("semi_strict", "planning"): (
        "SCOPE POLICY (semi-strict): Strategies may rely on a small number "
        "of additional assumptions, but each must be explicitly noted and "
        "justified. Prefer approaches that stay close to the original "
        "formulation. If an approach requires significant scope narrowing, "
        "flag that tradeoff clearly."
    ),
    ("semi_strict", "consolidator"): (
        "SCOPE POLICY (semi-strict): List all [ASSUMPTION+] entries in the "
        "assumptions section. Clearly separate user-provided assumptions "
        "from new ones. Assess whether the new assumptions changed the "
        "character of what was proved — the reader should understand exactly "
        "how the final result relates to the original claim."
    ),
    # ---- flexible ----
    ("flexible", "generative"): (
        "SCOPE POLICY (flexible): You have latitude to introduce new "
        "assumptions and scope adjustments as needed. The key constraint is "
        "relevance: the final proof should still be interesting and "
        "recognizably about the original claim. Don't drift into proving "
        "something trivial or unrelated. Tag all assumptions ([ASSUMPTION+], "
        "[ASSUMPTION-], [SCOPE]) for traceability so the consolidator can "
        "produce an accurate assumptions list."
    ),
    ("flexible", "evaluative"): (
        "SCOPE POLICY (flexible): Focus on logical correctness. New "
        "assumptions are permitted — verify they are tagged for traceability "
        "but do not penalize the proof for scope expansion. Only flag scope "
        "issues if the assumptions have drifted so far that the result is no "
        "longer meaningfully about the original problem."
    ),
    ("flexible", "planning"): (
        "SCOPE POLICY (flexible): No strict scope restrictions. Prefer "
        "approaches that keep the problem interesting and relevant to the "
        "original claim. Tag any scope-affecting choices with [SCOPE] for "
        "traceability."
    ),
    ("flexible", "consolidator"): (
        "SCOPE POLICY (flexible): Compile a complete assumptions list "
        "distinguishing [USER] assumptions from [ASSUMPTION+] additions. "
        "Clearly describe how the proved result relates to the original "
        "claim — especially if scope changed significantly."
    ),
}


def build_scope_policy(policy: ModePolicy, role: str) -> str:
    category = ROLE_CATEGORY.get(role, "backstop")
    if category == "backstop":
        return ""
    key = (policy.mode, category)
    template = SCOPE_POLICY_TEXT.get(key, "")
    if not template:
        return ""
    return template.format(
        max_new_assumptions=policy.max_new_assumptions_per_branch,
        max_scope_changes=policy.max_scope_changes_per_branch,
    )
