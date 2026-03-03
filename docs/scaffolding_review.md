# Scaffolding Review

Reviewed source:
- `/Users/p-aldighieri/Library/CloudStorage/OneDrive-Personal/Economia/RA Piotr/scaffolding_plan.txt`

Review date:
- March 2, 2026

## What is already strong

1. The role decomposition is good and practical.
2. You already identified the hardest risk (scope drift).
3. You included modularity and optional steps early.
4. You recognized that strategy parallelism matters.
5. You noted both machine-facing and human-facing outputs.

## Module mapping (source -> implementation)

1. `A Orchestrator` -> `orchestrator/engine.py`, `scheduler.py`, `termination.py`
2. `A.1 Orchestration assistant` -> assistant policy module inside orchestrator (not a separate mandatory role in v0)
3. `B Formalizer/Goal parser` -> `roles/formalizer.py` + `contracts/GoalSpec`
4. `C Literature review` -> `roles/literature.py` (optional by config)
5. `D Searcher` -> `roles/searcher.py` + branch creation
6. `E Proof breakdown` -> `roles/breakdown.py`
7. `F Prover` -> `roles/prover.py` (stepwise, chunk-aware)
8. `G Reviewer` -> `roles/reviewer.py`
9. `H Scope keeper` -> `roles/scope_keeper.py` (continuous checks)
10. `I Final reviewer` -> `roles/final_reviewer.py`
11. `I Lean formalizer` -> `roles/lean_formalizer.py` (renamed module index in plan)
12. `J Consolidator` -> `roles/consolidator.py`

## Ambiguities found (need explicit policy)

1. Session continuity policy
- Should retry feedback go to same role session or fresh call?
- Recommendation: default to fresh call with summarized trace context; keep same session only in deterministic debug mode.

2. Scope amendment authority
- Who can approve theorem weakening?
- Recommendation: orchestrator proposes, user or policy gate approves.

3. Pass criteria granularity
- PASS at step/lemma/branch/final levels are mixed.
- Recommendation: define status at all four levels and require promotion rules.

4. Literature role boundary
- Does literature introduce assumptions?
- Recommendation: no; only suggest references/techniques.

5. Lean integration point
- Inside loop or post-loop?
- Recommendation: post-loop in v0, optional.

## Suggested changes (priority order)

1. Add a global "Assumption Delta Ledger" artifact.
2. Make scope checks run after every reviewer verdict.
3. Add strict schema validation for every role output.
4. Add branch pruning + revival policy.
5. Define hard termination limits for loops.
6. Split "final reviewer" from "formatting consolidator" responsibilities.
7. Reserve browser-agent mode as optional provider adapter.

## Conclusion

The scaffold is coherent and buildable. The main work is not inventing new roles, but enforcing strong contracts, loop governance, and explicit scope-delta control so proofs do not succeed by silently changing the original claim.
