---
description: Final verification — global translation + smuggling + gold check + per-theorem deep audit + final compile, plus AXLE verify_proof and final meaning_check
argument-hint: --proof-repo PATH --project-url URL --port PORT
---

The closing audit: prove that `main.lean` (after merge) really discharges the main theorem against its target signature, with no `sorry`s outside of permitted INVENTORY.lean stubs, no axioms, no Plausible counterexample at any lemma, no smuggling residue, and a faithful Lean ↔ English correspondence.

This is the **gate**. `done` only after every check below passes. No partial credit.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL`, `--port PORT` — for the meaning_check + audit submissions

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Soft prompts live at `${MATHPIPEPROVER}/prompts/soft/` — substitute the actual MathPipeProver location. Trust `lean_state.md` over literal paths when reality differs.

The pipeline conceptual guide is `${MATHPIPEPROVER}/docs/lean_pipeline.md`. Read it before invoking this skill.

## Steps

The audit runs in this fixed order, NEVER skipping ahead:

### 1. State precondition

Verify the Lemma Status table in `lean_state.md` shows every lemma as `proved=✓, reviewed=✓, merged=✓` *except* those whose row was explicitly marked `permanent_stub=✓` (INVENTORY.lean items the user accepted as un-proved).

### 2. AXLE verify_proof on full file

Concatenate `INVENTORY.lean` (stubs only) + `main.lean` (merged) → `/tmp/final.lean`. Extract the main theorem's signature into `/tmp/final_signature.lean`.

```bash
mpp axle verify-proof \
    --in /tmp/final.lean \
    --formal-statement /tmp/final_signature.lean \
    --permitted-sorries "<comma-separated permanent_stub slugs>" \
    --log-path {PROOF_REPO}/lean/axle_log.jsonl
```

Exit 0 = continues. Exit 2 = STOP, surface failure.

### 3. Per-lemma disprove sweep

For each proved lemma (not stubs), run `mpp axle disprove --names <slug> --terminal-tactics plausible,decide`. If ANY lemma is disproved by Plausible, the lemma's statement is wrong (typechecks but vacuous). Escalate immediately.

### 4. Global smuggling audit (`8b`)

Submit `${MATHPIPEPROVER}/prompts/soft/8b_lean_smuggling_check_soft.md` against the full merged file. Refresh project sources first via `cdp_refresh_sources.mjs` to avoid stale-cache reads.

The smuggling auditor returns a per-construct table covering ALL categories: SMUGGLED_SORRY, SMUGGLED_AXIOM, SMUGGLED_AXIOM_DRESSED_AS_DEPENDENCY, OPAQUE_TRAPDOOR, VACUOUS_FIELD, CONCLUSION_AS_FIELD / SMUGGLED_CERTIFICATE, SMUGGLED_UNIVERSAL_HELPER, HYPOTHESIS_AS_PAPER_DERIVATION (borderline — user-decision), CHOICE_ABUSE, TACTIC_SUPPRESSION.

- Verdict CLEAN: proceed.
- Verdict NOT CLEAN (any unpermitted finding): route the flagged constructs back to Phase 4 (brainstorm + reprove) and re-run final-check after.
- HYPOTHESIS_AS_PAPER_DERIVATION flags require user-decision: accept the v9-ledger pattern or require Lean derivation.

### 5. Per-theorem deep audit (`8d`, batched)

For each headline theorem, submit `${MATHPIPEPROVER}/prompts/soft/8d_lean_per_theorem_audit_soft.md` (translation + scope + smuggling bundled per theorem). Group headline theorems into thematic batches (typically 2–6 per batch; the paper's chapter structure suggests groupings). Dispatch with separate Extended Pro submits, or use `cdp_submit_batch.mjs` only after validating it against the current submit helper. Poll via the hardened `wait_chat_done.mjs` (chat-ID-pinned).

For each theorem, the auditor returns OVERALL: PASS / PASS-WITH-FLAG / FAIL.

- All PASS: proceed.
- PASS-WITH-FLAG (LEAN_MORE_EXPLICIT or HYPOTHESIS_AS_PAPER_DERIVATION): queue flag for paper-feedback step (7) and proceed.
- Any FAIL: route the affected theorems back to Phase 4 and re-run final-check after fix.

### 6. Global gold check (`8f`)

Submit `${MATHPIPEPROVER}/prompts/soft/8f_lean_gold_check_soft.md` against the full merged file vs the original paper sources. This is the asymmetric Lean ↔ English comparison:

- **Lean ⊆ English (Lean missing)** → FAIL. Route back to Phase 4.
- **Lean = English (mirror)** → PASS.
- **Lean ⊇ English (Lean more explicit)** → PASS-FLAG. Queue for step 7.

The gold check is the SINGLE GLOBAL VIEW the user wants: does the Lean file collectively prove the same theorem set as the paper, with matching hypotheses and conclusions?

### 7. Paper-feedback generation (`8e`)

If steps 5 and 6 produced PASS-WITH-FLAG findings, submit `${MATHPIPEPROVER}/prompts/soft/8e_lean_paper_feedback_soft.md` with the full file + flag list. Generates a punch-list of paper text edits to bring the English up to match Lean's explicit form. Save to `{PROOF_REPO}/lean/PAPER_FEEDBACK.md` for user review.

This is informational — does NOT block `done` declaration. The Lean formalization is complete; the paper feedback is a side-deliverable to improve the English.

### 8. Final meaning_check (`86`)

Submit `${MATHPIPEPROVER}/prompts/soft/86_lean_meaning_check_soft.md` with the full merged file + the original source proof. Final-line semantic audit on the main theorem: does the formalized version really say what the English claim said?

### 9. FINAL COMPILATION CHECK (last step — `lake build`)

The ONLY way to declare `done`. Run:

```bash
cd <path-to-project-with-V9Main.lean-or-equivalent>
lake build <target>
echo "Exit: $?"
```

Exit 0 required. The compilation check is the LAST gate even though the AXLE step (2) also typechecks — `lake build` is the authoritative end-to-end build against the project's full toolchain + Mathlib pin. Skip this and we're shipping a file that compiles via AXLE but may have linter / import / instance issues that bite downstream.

### 10. If ALL green:

- Write `{PROOF_REPO}/lean/FORMALIZATION_REPORT.md` with:
  - Main theorem signature (Lean) and statement (English).
  - Dependency table (Mathlib imports + INVENTORY entries with source citations).
  - Permanent stubs list with user-accepted reasons.
  - AXLE `verify_proof` info block (request_id, environment, timing).
  - Lake build status + version.
  - Audit ledger snapshot (per-theorem PASS / PASS-WITH-FLAG verdicts).
  - Per-lemma proof length / tactic usage summary (`mpp axle extract-decls`).
- Update `lean_state.md`: phase `→ done`, add `Completed: <timestamp>`, snapshot the audit ledger.
- Commit `main.lean`, `INVENTORY.lean`, `lemmas/`, `FORMALIZATION_REPORT.md`, `PAPER_FEEDBACK.md` (if generated) to the proof repo's git.

### 11. If any check fails:

Do NOT update phase to `done`. Surface the failure with full context. Route:
- Step 2 / 3 / 9 (build/AXLE/disprove) fails → fix is at lemma level. `/lean-prove-lemma <slug>`.
- Step 4 (global smuggling) fails → fix is structural. Route smuggled constructs through Phase 4 brainstorm + reprove cycle.
- Step 5 (per-theorem) FAIL → fix is per-theorem. Route specific theorem through Phase 4.
- Step 6 (gold check) FAIL-LEAN-SHORT → fix is per-theorem; Lean missing hypothesis or step.
- Step 8 (meaning_check) flags `weakened` or `strengthened` on main theorem → MATHEMATICAL_CONCERN; surface to user.

## Notes

- This skill is the GATE. `done` only after every step lands green.
- The global view is steps 4 + 6 (global smuggling + gold check). Per-theorem deep audit is step 5. Lake build is step 9. All four must pass.
- HYPOTHESIS_AS_PAPER_DERIVATION (borderline smuggling pattern) is a user-decision flag — orchestrator surfaces them and waits for user accept/reject before proceeding to step 10.
- Paper feedback (step 7) is a side-deliverable, NOT a blocker. The English-side improvements come from Lean's explicit form; user reviews on their own time.
- The `FORMALIZATION_REPORT.md` + `PAPER_FEEDBACK.md` are the durable records. Anyone reading them 6 months later should be able to reconstruct what was proved, what was assumed, and which Lean / Mathlib version.
