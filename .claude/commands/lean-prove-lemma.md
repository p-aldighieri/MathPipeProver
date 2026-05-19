---
description: Close one specific sorry with prover + reviewer + AXLE check cycle
argument-hint: <lemma-slug> --proof-repo PATH --project-url URL --port PORT
---

Run the lean_prover role on one focused lemma, audit with the prover-reviewer, and verify with AXLE `check`. Loop until the proof passes both audits or until retry budget exhausts (then escalate).

**Arguments:** `$ARGUMENTS`
- First positional: `<lemma-slug>` — must match a row in the Lemma Status table of `lean_state.md`
- `--proof-repo PATH`, `--project-url URL`, `--port PORT` as usual
- `--max-retries N` — default 5; how many prover-loop iterations before escalating

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Prompt templates live under `${MATHPIPEPROVER}/prompts/soft/` — substitute the actual MathPipeProver location. Trust `lean_state.md` over literal paths when reality differs.

## Steps

1. **Read state.** Verify the state is consistent with running the prover now (typically `Current phase: proving_lemmas`). Confirm `<lemma-slug>` exists in the Lemma Status table and is not yet `proved`.

2. **Assemble lemma context:**
   - The lemma's signature (extract from `main.lean`)
   - Its English statement (from `decomposition.md`)
   - The dependencies it cites (other lemmas + Mathlib imports + INVENTORY stubs)
   - Any prior AXLE error trace if this is a retry (kept in `diagnostics/lean_prover_<slug>_axle_errors_<n>.txt`)

3. **Render the prompt** from `${MATHPIPEPROVER}/prompts/soft/87_lean_prover_soft.md`, with the lemma context as `{context_bundle}`. Save to `diagnostics/lean_prover_<slug>_request_<n>.md`.

4. **Submit + harvest** via `/submit-role`. Save response to `diagnostics/lean_prover_<slug>_response_<n>.md`.

5. **Inspect the response control block:**
   - `status: STUCK` → save the obstruction report, do NOT update the file. Report to the user, recommend either re-decomposition or a Mathlib search. Stop.
   - `status: IMPORT_REQUEST` → the prover wants an import that isn't in the dep-audit table. Surface to the user — they decide whether to expand the dep-audit or have the prover work around it. Stop.
   - `status: PROVED` → continue.

6. **Run prover-reviewer.** Submit `${MATHPIPEPROVER}/prompts/soft/88_lean_prover_reviewer_soft.md` with the proof + lemma context. Check the `review_control` fields:
   - `hidden_sorries > 0` → REJECT, loop to step 3.
   - `axiom_declarations_introduced` non-empty → REJECT, loop to step 3 with translation-discipline emphasized.
   - `unsafe_tactics_used` non-empty → if just `native_decide` etc., REJECT and loop. If empty list, continue.
   - `verdict: PATCH_SMALL | PATCH_BIG` → loop to step 3 with reviewer feedback.
   - `verdict: REDO` → escalate to user.
   - `verdict: PASS` → continue to step 7.

7. **Save the proved lemma** to `{PROOF_REPO}/lean/lemmas/<slug>.lean` (just this lemma's `theorem … := by …` block, with required imports as a comment block at top for traceability).

8. **AXLE verification.** Build the test file by splicing the new proof into `main.lean`:
   ```bash
   cat INVENTORY.lean main.lean > /tmp/lemma_test.lean
   # … splice <slug>'s body in place …
   mpp axle check --in /tmp/lemma_test.lean --log-path {PROOF_REPO}/lean/axle_log.jsonl
   ```
   - Exit 0 → the proof compiles in context. Continue.
   - Exit 2 → save the error trace to `diagnostics/lean_prover_<slug>_axle_errors_<n>.txt`, loop to step 3 with errors as context.
   - Exit 1 → transport error, retry once.

9. **Disprove sanity check** (optional but cheap). Run `mpp axle disprove --in /tmp/lemma_test.lean --names <slug> --terminal-tactics plausible`. If Plausible finds a counterexample, the *Lean statement* is wrong — escalate immediately. This catches the case where everything typechecks but the lemma is actually false.

10. **Update state.** `lean_state.md`: mark `<slug>` row `proved=✓, reviewed=✓` in the Lemma Status table. Append history entry with retry count and any notable tactics used. Recommend the next un-proved lemma, in dependency order.

## Notes

- Retry budget is per-skill-invocation. A lemma that fails 5 times in this skill should not just keep looping in a wrapper — escalate so the user can decide whether to re-decompose, search Mathlib differently, or accept it as a permanent INVENTORY.lean stub.
- **Never** edit `main.lean` directly in this skill. Lemma proofs live in `lemmas/<slug>.lean`. The fan-in into `main.lean` happens in `/lean-merge` so a failed splice doesn't poison the skeleton.
- The disprove step is cheap (Plausible runs in seconds). Make it a habit, especially for non-trivial econ lemmas where vacuous antecedents are a real risk.
- If the prover keeps returning `STUCK` on the same obstruction, the issue is upstream — re-run `/lean-structure` on a tighter decomposition rather than throwing more prover passes at it.
