from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RoleSpec:
    name: str
    instructions: str


_VOCABULARY_ANCHOR = (
    " Vocabulary anchoring: reuse the source paper's names and notation when the run has a source"
    " paper, else standard field terminology; prefer a plain repeated descriptive expression over"
    " coining a name, and coin only as a last resort — boring, self-describing, defined at first"
    " use, declared in a 'New Terms' block; keep workflow bookkeeping words (ledger, quarantine,"
    " gatekeeper, patched, kill-test) out of mathematical content."
)


ROLE_SPECS: dict[str, RoleSpec] = {
    "formalizer": RoleSpec(
        name="formalizer",
        instructions=(
            "Restate the claim precisely with explicit quantifiers, domains, definitions, and ambiguities. "
            "Do not try to prove the claim. Do not quietly add assumptions; surface ambiguities instead." + _VOCABULARY_ANCHOR
        ),
    ),
    "literature": RoleSpec(
        name="literature",
        instructions=(
            "Search reputable online literature sources for closely related results, proof strategies, counterexamples, "
            "and prior art. Distill what matters, say whether the claim looks already known, false, open, or unclear, "
            "and do not treat retrieval alone as a proof." + _VOCABULARY_ANCHOR
        ),
    ),
    "searcher": RoleSpec(
        name="searcher",
        instructions=(
            "Propose 2-4 genuinely distinct proof routes, using literature notes if available. For each route, "
            "name the core idea, key intermediate statements, likely failure point, and why the route is promising. "
            "Rank the routes with the most actionable one first." + _VOCABULARY_ANCHOR
        ),
    ),
    "breakdown": RoleSpec(
        name="breakdown",
        instructions=(
            "Decompose the proof into numbered lemmas with dependency order. Each lemma needs: precise statement, "
            "dependencies, technique hint, difficulty estimate. Identify the critical lemma and keep the plan editable "
            "when the prover or reviewer finds a structural issue." + _VOCABULARY_ANCHOR
        ),
    ),
    "prover": RoleSpec(
        name="prover",
        instructions=(
            "Advance the proof by proving the highest-leverage next statement from the breakdown. Every material step "
            "needs an explicit justification. A successful pass may prove the claim, produce a counterexample, prove "
            "the mildest viable weakening, or prove an impossibility result." + _VOCABULARY_ANCHOR
        ),
    ),
    "reviewer": RoleSpec(
        name="reviewer",
        instructions=(
            "Audit the current proof attempt for logical validity, completeness, and scope fidelity. Always issue a "
            "clear verdict, an opinion about route viability, and a concrete recommendation for the next pass so the "
            "orchestrator can decide what to do next." + _VOCABULARY_ANCHOR
        ),
    ),
    "scope_keeper": RoleSpec(
        name="scope_keeper",
        instructions=(
            "Mechanical backstop: count [ASSUMPTION+] and [SCOPE] tags against mode limits. "
            "Primary scope enforcement is handled by scope-policy paragraphs injected into "
            "each role's prompt, especially the reviewer."
        ),
    ),
    "consolidator": RoleSpec(
        name="consolidator",
        instructions=(
            "Assemble the current branch into a readable proof report with the formal claim, strategy, proved pieces, "
            "assumptions used, relationship to the original claim, and unresolved risks." + _VOCABULARY_ANCHOR
        ),
    ),
    "gatekeeper": RoleSpec(
        name="gatekeeper",
        instructions=(
            "Run automatically after the consolidator. Compare the ORIGINAL objective to the FINAL result as a scope "
            "question, not a logic audit. Classify each added or changed assumption as trivial regularity, "
            "meaningful narrowing, or scope-changing. If scope was meaningfully narrowed, propose strategies "
            "(one per narrowing as a baseline, no fixed count) for re-attacking the original objective from a "
            "fresh vantage point — at least one strategy should question the formalization itself, not just the "
            "proof technique. Do not re-check proofs step by step and do not propose lemma-level patches." + _VOCABULARY_ANCHOR
        ),
    ),
    "plain_reader_gate": RoleSpec(
        name="plain_reader_gate",
        instructions=(
            "Read the candidate author-facing deliverable with only the source paper for context, as the "
            "paper's authors would. Do not audit the mathematics; flag ungrounded terms, references to "
            "internal artifacts, process talk, and notation drift, each with a paper-anchored fix, and "
            "issue a verdict: RELEASE_CLEAN or REWRITE_REQUIRED."
        ),
    ),
}


def stub_response(role: str, cycle: int = 0) -> str:
    if role == "formalizer":
        return "## Formal Statement\nPrecise statement drafted.\n"
    if role == "literature":
        return "## Search Summary\nRelated references and techniques collected.\n"
    if role == "searcher":
        return (
            "## Candidate Routes\n"
            "1. Direct inequality route.\n"
            "2. Contradiction route.\n"
            "Route 1 appears more actionable.\n"
        )
    if role == "breakdown":
        return "## Proof Breakdown\n- Lemma 1\n- Lemma 2\n"
    if role == "prover":
        if cycle == 0:
            return (
                "## Proof Progress\n"
                "[DERIVED] Proved the first key step.\n"
                "[BREAKDOWN_AMEND] Add a bridge lemma between the route and the target claim.\n"
            )
        return "## Proof Progress\n[DERIVED] Closed the remaining local gap.\n"
    if role == "reviewer":
        return "```review_control\nverdict: PASS\nrecommended_next_phase: CONSOLIDATOR\n```\n\nVERDICT: PASS\n"
    if role == "scope_keeper":
        return "## Scope Decision\nNo policy violations detected.\n"
    if role == "consolidator":
        return "## Proof Report\nCurrent branch report assembled.\n"
    if role == "gatekeeper":
        return (
            "```gatekeeper_control\n"
            "verdict: OBJECTIVE_MET\n"
            "```\n\n"
            "VERDICT: OBJECTIVE_MET\n"
            "Reason: stub gatekeeper response.\n"
        )
    if role == "plain_reader_gate":
        return "## Verdict\nRELEASE_CLEAN\n\n## Flags\n(none)\n"
    return "(no output)"
