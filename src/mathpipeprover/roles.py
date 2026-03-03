from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoleSpec:
    name: str
    instructions: str


ROLE_SPECS: dict[str, RoleSpec] = {
    "workflow_router": RoleSpec(
        name="workflow_router",
        instructions=(
            "Read workflow state and output one routing decision as JSON: "
            '{"next":"TAG"}. Do not explain. Do not output multiple decisions.'
        ),
    ),
    "formalizer": RoleSpec(
        name="formalizer",
        instructions=(
            "Restate claim with clear quantifiers. Keep user assumptions explicit. "
            "If anything new is introduced, tag each line with [ASSUMPTION+] or [SCOPE]."
        ),
    ),
    "literature": RoleSpec(
        name="literature",
        instructions=(
            "Retrieve relevant known results and techniques. Tag evidence lines with [LIT]. "
            "Do not claim proof validity from retrieval alone."
        ),
    ),
    "searcher": RoleSpec(
        name="searcher",
        instructions=(
            "Propose 2-4 routes with likely failure modes. If route narrows scope, tag with [SCOPE]."
        ),
    ),
    "breakdown": RoleSpec(
        name="breakdown",
        instructions=(
            "Create lemma-level breakdown. Keep it editable by prover. "
            "Future changes should be tagged [BREAKDOWN_AMEND]."
        ),
    ),
    "prover": RoleSpec(
        name="prover",
        instructions=(
            "Advance proof steps. If you need to change assumptions, tag [ASSUMPTION+]/[ASSUMPTION-]. "
            "If breakdown must change, tag [BREAKDOWN_AMEND]."
        ),
    ),
    "reviewer": RoleSpec(
        name="reviewer",
        instructions=(
            "Review logic and scope drift. Return PASS or FAIL. "
            "Tag detected scope changes with [SCOPE]."
        ),
    ),
    "scope_keeper": RoleSpec(
        name="scope_keeper",
        instructions=(
            "Evaluate assumption/scope changes against current mode policy and decide accept/reject."
        ),
    ),
    "consolidator": RoleSpec(
        name="consolidator",
        instructions=(
            "Write final human-readable proof report and include unresolved risks."
        ),
    ),
}


def stub_response(role: str, cycle: int = 0) -> str:
    if role == "formalizer":
        return "## Claim Restatement\n[USER] Formalized claim drafted.\n"
    if role == "literature":
        return "## Retrieved Ideas\n[LIT] Similar monotonicity argument found in related theorem.\n"
    if role == "searcher":
        return (
            "## Candidate Routes\n"
            "1. Direct inequality route.\n"
            "2. Contradiction route.\n"
            "[DERIVED] Route 1 appears lower-cost.\n"
        )
    if role == "breakdown":
        return "## Lemma Plan\n- Lemma 1\n- Lemma 2\n"
    if role == "prover":
        if cycle == 0:
            return (
                "## Step Attempt\n"
                "[DERIVED] Proved base step.\n"
                "[BREAKDOWN_AMEND] Add bridge lemma connecting route to target claim.\n"
            )
        return "## Step Attempt\n[DERIVED] Closed remaining gap.\n"
    if role == "reviewer":
        return "## Verdict\nPASS\n"
    if role == "scope_keeper":
        return "## Scope Decision\nNo policy violations detected.\n"
    if role == "consolidator":
        return "## Final Proof\nDraft final proof assembled from branch context.\n"
    return "(no output)"
