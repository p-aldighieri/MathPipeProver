---
description: Final verification — AXLE verify_proof on the full file + per-lemma disprove + final meaning_check
argument-hint: --proof-repo PATH --project-url URL --port PORT
---

The closing audit: prove that `main.lean` (after merge) really discharges the main theorem against its target signature, with no `sorry`s outside of permitted INVENTORY.lean stubs, no axioms, and no Plausible counterexample at any lemma.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL`, `--port PORT` — for the final meaning_check pass

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. The meaning_check prompt lives at `${MATHPIPEPROVER}/prompts/soft/86_lean_meaning_check_soft.md` — substitute the actual MathPipeProver location. Trust `lean_state.md` over literal paths when reality differs.

## Steps

1. **Read state.** Verify the Lemma Status table in `lean_state.md` shows every lemma as `proved=✓, reviewed=✓, merged=✓` *except* those whose row was explicitly marked `permanent_stub=✓` (these are INVENTORY.lean items the user accepted as un-proved).

2. **Build the AXLE submission.** Concatenate `INVENTORY.lean` (stubs only) + `main.lean` (merged) → `/tmp/final.lean`. Extract the main theorem's *signature only* into `/tmp/final_signature.lean`.

3. **Run AXLE verify_proof.** The `permitted_sorries` list is *only* the slugs of permanent_stub lemmas:
   ```bash
   mpp axle verify-proof \
       --in /tmp/final.lean \
       --formal-statement /tmp/final_signature.lean \
       --permitted-sorries "<comma-separated permanent_stub slugs>" \
       --log-path {PROOF_REPO}/lean/axle_log.jsonl
   ```
   - Exit 0 = the proof compiles and matches the target signature, with no unpermitted sorrys. Continue to step 4.
   - Exit 2 = unpermitted sorrys remain, or signature doesn't match, or compile error. Surface and stop — this is a real failure, not a transient one.

4. **Per-lemma disprove sweep.** For each proved lemma (not stubs), run:
   ```bash
   mpp axle disprove \
       --in /tmp/final.lean \
       --names <slug> \
       --terminal-tactics plausible,decide \
       --log-path {PROOF_REPO}/lean/axle_log.jsonl
   ```
   If ANY lemma is disproved by Plausible, that lemma's *statement* is wrong even though it typechecks — escalate immediately. This is the cheapest catch for vacuous lemmas.

5. **Final meaning_check.** Submit `${MATHPIPEPROVER}/prompts/soft/86_lean_meaning_check_soft.md` with the full merged file + the original source proof as context. Specifically focus on the main theorem here — does the formalized version really say what the English claim said? At this point everything passes type-check; this is the last-line semantic audit.

6. **If all three checks green:**
   - Write a final report to `{PROOF_REPO}/lean/FORMALIZATION_REPORT.md` with:
     - The main theorem signature (Lean) and statement (English)
     - The dependency table (Mathlib imports + INVENTORY.lean entries)
     - The list of permanent stubs (with the user's acknowledgement reason)
     - The AXLE `verify_proof` info block (request_id, environment, timing)
     - Per-lemma proof length / tactic usage summary (`mpp axle extract-decls` for this)
   - Update `lean_state.md`: phase `→ done`, add a `Completed:` timestamp.
   - Commit `main.lean`, `INVENTORY.lean`, `lemmas/`, and `FORMALIZATION_REPORT.md` to the proof repo's git.

7. **If any check fails:** do NOT update phase to `done`. Surface the failure with full context and let the user decide whether to loop back into `/lean-prove-lemma` for a specific slug, re-verify deps, or accept a new permanent stub.

## Notes

- This skill is the gate. `done` only after `verify_proof` is 0, no `disprove` succeeded, and the final meaning_check signs off. No partial credit.
- The `FORMALIZATION_REPORT.md` is the durable record. Anyone reading it 6 months from now should be able to reconstruct what was proved, what was assumed (permanent stubs), and which Mathlib commit the proof depends on (well — the toolchain version, since AXLE doesn't expose the commit).
- If `disprove` produces a counterexample for a proved lemma, the proof's tactic must have closed a vacuous goal. This is rare but catastrophic — don't ship anything with a positive disprove result.
- If the final meaning_check flags `weakened` or `strengthened` on the main theorem only, you're shipping a different result than the English proof established. Surface to the user with the alternative as a `MATHEMATICAL_CONCERN`.
