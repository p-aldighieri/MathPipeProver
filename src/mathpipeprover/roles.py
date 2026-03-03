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
            "Transform the informal claim into a precise formal statement with explicit quantifiers and domains. "
            "List all user assumptions tagged [USER]. Tag any new assumptions [ASSUMPTION+] with justification. "
            "Tag scope ambiguities with [SCOPE]. Identify the mathematical domain and claim type."
        ),
    ),
    "literature": RoleSpec(
        name="literature",
        instructions=(
            "Survey relevant known theorems, techniques, and proof approaches. Tag evidence with [LIT]. "
            "Identify applicable proof techniques and assess difficulty. Note known counterexamples to related statements. "
            "Do not claim proof validity from retrieval alone."
        ),
    ),
    "searcher": RoleSpec(
        name="searcher",
        instructions=(
            "Propose 2-4 genuinely distinct proof strategies, each with: core technique, key intermediate steps, "
            "likely failure point, and complexity estimate. Rank by feasibility with most promising first. "
            "Number each route starting from 1. Tag scope-narrowing routes with [SCOPE]."
        ),
    ),
    "breakdown": RoleSpec(
        name="breakdown",
        instructions=(
            "Decompose the proof into numbered lemmas with dependency order. Each lemma needs: precise statement, "
            "dependencies, technique hint, difficulty estimate. Identify the critical lemma (hardest step). "
            "Include glue steps connecting lemmas to the final conclusion. The plan should be editable via [BREAKDOWN_AMEND]."
        ),
    ),
    "prover": RoleSpec(
        name="prover",
        instructions=(
            "Advance the proof by proving lemmas from the breakdown. Every step must have explicit justification "
            "(known theorem, previous lemma, or direct computation). Tag conclusions [DERIVED], new assumptions "
            "[ASSUMPTION+]/[ASSUMPTION-], and breakdown change requests [BREAKDOWN_AMEND]. "
            "Be explicit about gaps. Reference lemmas by number. Maintain a status summary of what's proved."
        ),
    ),
    "reviewer": RoleSpec(
        name="reviewer",
        instructions=(
            "Check each proof step for logical validity, completeness, and correct citations. Check scope compliance. "
            "Issue a structured verdict: VERDICT: PASS (correct and complete), VERDICT: PATCH_SMALL (minor fixable issues), "
            "VERDICT: PATCH_BIG (needs restructuring), or VERDICT: REDO (fundamentally flawed approach). "
            "Be precise about errors. Tag scope changes with [SCOPE]."
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
            "Assemble the final proof report: unified narrative with formal statement, strategy used, "
            "definitions, ordered lemma proofs, main result assembly, proof status (complete/partial/conditional), "
            "assumptions used, unresolved risks, and evidence trail."
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
        return "## Verdict\nVERDICT: PASS\n"
    if role == "scope_keeper":
        return "## Scope Decision\nNo policy violations detected.\n"
    if role == "consolidator":
        return "## Final Proof\nDraft final proof assembled from branch context.\n"
    return "(no output)"
