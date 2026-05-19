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

2. **CHEAP-FIRST: try AXLE terminal tactics before any Pro round-trip.**
   Before spending a 30-90 min Extended Pro pass, try the auto-prover. AXLE's `repair_proofs` lets you stack multiple terminal tactics, so a single call often closes the easy and medium lemmas at no Pro cost.

   ```bash
   mpp axle repair-proofs \
     --in {PROOF_REPO}/lean/main.lean \
     --names <slug> \
     --terminal-tactics "grind,aesop,simp_all,exact?,decide,omega,polyrith,positivity" \
     --repairs "apply_terminal_tactics" \
     --timeout 900 \
     --log-path {PROOF_REPO}/lean/axle_log.jsonl
   ```

   If it returns a closed proof, splice it into `main.lean`, re-AXLE-check, and skip to step 7. If it returns "still has sorry" or compile errors, continue to step 3 (Pro).

   You can also batch the whole file: drop `--names` and AXLE will try the tactic stack at every sorry site. Worth doing once early in the phase to harvest the free closures.

3. **IN-THREAD: try a focused proof by hand** before invoking Pro. Many lemmas are 1-3 line structural unpacks — `⟨field1, field2, ...⟩` for `And`/`Exists`, or `by congr; funext; exact h ...` for definitional equalities of structures.

   Trigger Pro only when (a) AXLE repair didn't close it and (b) you can't see the proof from the English + Lean signature. This is the most common cost saver in practice.

4. **Assemble lemma context** (for the Pro pass):
   - The lemma's signature (extract from `main.lean`)
   - Its English statement (from `decomposition.md`)
   - The dependencies it cites (other lemmas + Mathlib imports + INVENTORY stubs)
   - Any prior AXLE error trace if this is a retry (kept in `diagnostics/lean_prover_<slug>_axle_errors_<n>.txt`)

5. **Render the prompt** from `${MATHPIPEPROVER}/prompts/soft/87_lean_prover_soft.md`, with the lemma context as `{context_bundle}`. Save to `diagnostics/lean_prover_<slug>_request_<n>.md`.

6. **Submit + harvest** via `/submit-role`. Save response to `diagnostics/lean_prover_<slug>_response_<n>.md`. (Parallelize: if you have several lemmas needing Pro, submit several at once in separate chats — the project supports concurrent chats, and harvesting is independent.)

7. **Inspect the response control block:**
   - `status: STUCK` → save the obstruction report, do NOT update the file. Report to the user, recommend either re-decomposition or a Mathlib search. Stop.
   - `status: IMPORT_REQUEST` → the prover wants an import that isn't in the dep-audit table. Surface to the user — they decide whether to expand the dep-audit or have the prover work around it. Stop.
   - `status: PROVED` → continue.

8. **AXLE verification (BEFORE the reviewer).** Splice the new proof into `main.lean` (or build a test file) and run:
   ```bash
   mpp axle check --in /tmp/lemma_test.lean --log-path {PROOF_REPO}/lean/axle_log.jsonl
   ```
   - Exit 0 → the proof compiles in context. Continue.
   - Exit 2 → save the error trace to `diagnostics/lean_prover_<slug>_axle_errors_<n>.txt`, loop to step 5 with errors as context.
   - Exit 1 → transport error, retry once.

   **Run AXLE first because there's no point asking Pro to audit a proof that doesn't even compile.** Putting AXLE before the reviewer (rather than after) is a workflow change from the original design.

9. **Run prover-reviewer (BATCHED when possible).** Submit `${MATHPIPEPROVER}/prompts/soft/88_lean_prover_reviewer_soft.md` with the proof + lemma context.

   **Batch 2-3 freshly-AXLE-clean lemmas into a single reviewer submission** when their statements are related (same DAG layer, same external dependencies). The reviewer is fast (5-15 min) but each round-trip has overhead; batching cuts orchestrator total time roughly by 3×.

   Check the `review_control` fields:
   - `hidden_sorries > 0` → REJECT, loop to step 5.
   - `axiom_declarations_introduced` non-empty → REJECT, loop to step 5 with translation-discipline emphasized.
   - `unsafe_tactics_used` non-empty → if just `native_decide` etc., REJECT and loop. If empty list, continue.
   - `verdict: PATCH_SMALL | PATCH_BIG` → loop to step 5 with reviewer feedback.
   - `verdict: REDO` → escalate to user.
   - `verdict: PASS` → continue to step 10.

10. **Save the proved lemma** to `{PROOF_REPO}/lean/lemmas/<slug>.lean` (just this lemma's `theorem … := by …` block, with required imports as a comment block at top for traceability).

11. **Disprove sanity check** — at the END, as a sweep over all newly-proved lemmas in one call:
    ```bash
    mpp axle disprove --in {PROOF_REPO}/lean/main.lean \
      --names <slug1>,<slug2>,<slug3>,... \
      --terminal-tactics plausible \
      --timeout 900 \
      --log-path {PROOF_REPO}/lean/axle_log.jsonl
    ```
    If `disproved_theorems` is non-empty for any name, the *Lean statement* is wrong — escalate immediately. Per-lemma sweeps catch the case where everything typechecks but the lemma is vacuously true / actually false (highest-priority for Lemma 7 / cone-intersection style theorems with subtle support hypotheses).

    A single batched call is faster and produces a cleaner audit log than per-lemma invocations.

12. **Update state.** `lean_state.md`: mark `<slug>` row `proved=✓, reviewed=✓` in the Lemma Status table. Append history entry with retry count and any notable tactics used (or "AXLE repair-proofs (terminal: ...)" if step 2 closed it). Recommend the next un-proved lemma, in dependency order.

## Notes

- Retry budget is per-skill-invocation. A lemma that fails 5 times in this skill should not just keep looping in a wrapper — escalate so the user can decide whether to re-decompose, search Mathlib differently, or accept it as a permanent INVENTORY.lean stub.
- **Never** edit `main.lean` directly in this skill. Lemma proofs live in `lemmas/<slug>.lean`. The fan-in into `main.lean` happens in `/lean-merge` so a failed splice doesn't poison the skeleton.
- The disprove step is cheap (Plausible runs in seconds). Make it a habit, especially for non-trivial econ lemmas where vacuous antecedents are a real risk.
- If the prover keeps returning `STUCK` on the same obstruction, the issue is upstream — re-run `/lean-structure` on a tighter decomposition rather than throwing more prover passes at it.
