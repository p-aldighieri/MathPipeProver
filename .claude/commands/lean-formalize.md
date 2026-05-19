---
description: Run the lean_formalizer + reviewer + meaning_check + AXLE skeleton verify cycle
argument-hint: --proof-repo PATH --project-url URL --port PORT
---

Produce the Lean 4 file with signatures + skeleton + `sorry` bodies, audit it three ways (formalizer reviewer, meaning checker, AXLE `verify_proof` with `permitted_sorries=*`), and only declare the skeleton verified when all three agree.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL` — ChatGPT project URL
- `--port PORT` — Chrome CDP debug port

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Prompt templates live under `${MATHPIPEPROVER}/prompts/soft/` — substitute the actual MathPipeProver location. Trust `lean_state.md` over literal paths when reality differs.

## Steps

1. **Read state.** Verify the state is consistent with formalizing now (typically `Current phase: deps_done`). Read `{PROOF_REPO}/lean/decomposition.md` and `{PROOF_REPO}/lean/dep_audit.md`.

2. **Update INVENTORY.lean.** For every `not_in_mathlib` row in `dep_audit.md`, append a stub `theorem <slug> ... := sorry` to `{PROOF_REPO}/lean/support/INVENTORY.lean` (idempotent — skip names already present). The current file content goes into the formalizer's context as a temporary attachment.

3. **Render the formalizer prompt.** Read `${MATHPIPEPROVER}/prompts/soft/84_lean_formalizer_soft.md`, substitute `{context_bundle}` with: decomposition + dep_audit table + current INVENTORY.lean content. Save to `diagnostics/lean_formalizer_request_<n>.md`.

4. **Submit + harvest** via `/submit-role`. Save response to `diagnostics/lean_formalizer_response_<n>.md`.

5. **Extract the Lean file.** The response's second fenced `lean` block is the formalized source. Write it to `{PROOF_REPO}/lean/main.lean`. The metadata block (`lean_formalization`) tells you `lemma_count`, `sorry_count`, etc.

6. **Run formalizer-reviewer pass.** Submit `85_lean_formalizer_reviewer_soft.md` with the formalizer response + decomposition as context. On `PATCH_SMALL`/`PATCH_BIG`, loop back to step 3 with feedback attached (max 3 retries). On `REDO` — especially if `axiom_declarations_introduced` or `unsafe_tactics_used` is non-empty — escalate to the user.

7. **Run meaning_check.** Submit `${MATHPIPEPROVER}/prompts/soft/86_lean_meaning_check_soft.md` with the formalized file + decomposition. Parse the leading `meaning_check` block: if `wrong > 0` or `vacuous_risk > 0`, surface to the user. `weakened`/`strengthened` items get flagged but not auto-rejected.

8. **AXLE skeleton verification.** Build the full source for AXLE: `cat INVENTORY.lean main.lean > /tmp/skeleton.lean`. Extract the *signature only* of the main theorem from `main.lean` into `/tmp/main_signature.lean` (replace its body with `:= sorry`). Run:
   ```bash
   mpp axle verify-proof \
       --in /tmp/skeleton.lean \
       --formal-statement /tmp/main_signature.lean \
       --permitted-sorries "<comma-separated lemma slugs from decomposition>,<main slug>" \
       --log-path {PROOF_REPO}/lean/axle_log.jsonl
   ```
   Exit 0 means the skeleton type-checks and matches the target signature. Exit 2 means a real compile error — feed it back to the formalizer (loop to step 3 with AXLE errors as context).

9. **On all three passes green:** update `lean_state.md`: phase `→ proving_lemmas`, populate the Lemma Status table with `declared=✓, proved=–, reviewed=–, merged=–` for each lemma. Report next: `/lean-prove-lemma <slug>` for whichever lemma the orchestrator picks first.

## Notes

- The three checks catch different failure modes:
  - **Formalizer-reviewer** = does the Lean structurally match the decomposition + dep-audit?
  - **Meaning-check** = does each lemma's *type* actually say the same thing as the English statement?
  - **AXLE verify_proof** = does the Lean compile against Mathlib with the right signature?
- All three are cheap relative to the prover loop that follows. Spend the time here.
- If AXLE returns errors that reference a Mathlib import (e.g., "unknown identifier"), the dep_audit was wrong — go back to `/lean-verify-deps` for that specific candidate rather than asking the formalizer to paper over it.
- `weakened` lemmas from the meaning-check are often fine (the proof established more than the formalized claim). `strengthened` lemmas almost always mean the prover loop will fail. Don't proceed past `strengthened` without resolution.
