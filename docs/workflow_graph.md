# MathPipeProver Workflow Graphs

These diagrams describe the current repo reality: a smart orchestrator runs the proof, with the browser lane handling ChatGPT submission and recovery.

## Smart-Scaffolding Loop

![Smart-Scaffolding Loop](img/workflow_main.svg)

- The orchestrator chooses the next narrow task, curates context, and decides whether a route should continue. Every completed soft role returns control to the orchestrator.
- Branch-local context grows through repeated `breakdown -> prover -> reviewer` cycles until a branch passes, stalls, or is pruned.
- `waiting_orchestrator` is an intentional handoff for judgment, not an error state.
- After consolidator, the pipeline runs the gatekeeper automatically. The gatekeeper performs a scope check (not a logic audit) and, when scope was meaningfully narrowed, proposes route-level re-attacks. The orchestrator then picks the next edge. The image above predates the gatekeeper; the textual flow is `consolidator -> gatekeeper -> {objective met? stop : document attempt + build dossier -> searcher | formalizer reread}`, with the orchestrator picking the edge.
- **Attempts and re-attack.** One full `searcher -> ... -> gatekeeper` push is an *attempt* (a larger unit than a route-branch; an attempt usually contains several branches). When an attempt ends short of the objective — gatekeeper `OBJECTIVE_NARROWED`/`OBJECTIVE_MISSED`, or all routes stalled / out of budget — the default is to preserve the attempt, append an **attempt dossier** (lessons learned, refuted routes, central obstruction), and loop back to the searcher feeding it that dossier, opening a fresh attempt. The objective, paper, and proof-state carry across unchanged; an `OBJECTIVE_MISSED` re-read may legitimately loop all the way back to the formalizer. Stopping is the justified exception (objective met, disproved, distinct strategies exhausted, or human stop). In the API pipeline this loop is automated and bounded by `max_attempt_rounds` (default `1` = off); in smart scaffolding the orchestrator runs it by judgment (see `docs/soft_scaffolding.md` §Attempts and the Default Re-Attack Loop).

## Optional Post-Gatekeeper Simplification Loop

When the gatekeeper returns `OBJECTIVE_MET` and the result is locked, an optional simplification pipeline can run to find a cleaner proof of the same theorem ("as simple as possible, but not simpler"). It mirrors the main loop with `prove` swapped for `simplify, theorem preserved`:

`simplify-breakdown (blocks + dependency DAG) -> {per block, in parallel: simplify-search -> simplifier -> reviewer (correctness) -> simplify-compare (strictly-simpler ∧ same-strength)} -> consolidator (reassemble + seam-check) -> gatekeeper (scope)`.

A block's simpler proof is adopted only if it is both correct and strictly-simpler-at-same-strength with its interface preserved; otherwise the original block is kept. Parallelism runs on two axes — blocks (those with no shared interface in the DAG) × routes (per block). Templates: `09_simplify_breakdown`, `0a_simplify_search`, `0b_simplifier`, `0c_simplify_compare`, reusing `06_reviewer`, `07_consolidator`, `08_gatekeeper`. See `docs/soft_scaffolding.md` §Optional Post-Gatekeeper Simplification Pipeline.

## Governance Policy Modes

![Governance Policy Modes](img/workflow_governance_policy.svg)

Governance policy (`strict`, `semi_strict`, `flexible`) is separate from the repository's operating taxonomy (smart scaffolding / API pipeline). Policy modes govern scope and assumption tolerance inside the proof loop.

## Budget Gates

Budget checks run at the top of each phase iteration:

- Global: `max_total_tokens`, `max_total_calls`
- Per-branch: `max_tokens_per_branch`, `max_calls_per_branch`

If a branch exceeds its budget, it moves to `fail_budget`. If the run exceeds global budget, all remaining branches stop.

## Role Data Flow

![Role Data Flow](img/workflow_role_dataflow.svg)

- Durable browser project sources hold stable reference material that should survive across many role turns.
- Branch-local markdown files are the live working set for the current route.
- Literature notes can live in both layers on purpose: a stable literature memo may sit in durable sources, while the current `literature.md` should still be passed explicitly to `searcher` when route selection depends on it.
- Each role packet loads priority files in full, loads secondary files in a separate section, and lists everything else as manifest-only.
- Soft scaffolding stays sane by narrowing the task and packet on purpose rather than truncating important files.
