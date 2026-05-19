---
description: Run the lean_dep_audit role to propose Mathlib candidates for each external result
argument-hint: --proof-repo PATH --project-url URL --port PORT
---

Submit the dep-audit role to Extended Pro. Produces a *proposed* candidate table — verification of each candidate against AXLE happens in `/lean-verify-deps` next.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL` — ChatGPT project URL
- `--port PORT` — Chrome CDP debug port

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Prompt templates live under `${MATHPIPEPROVER}/prompts/soft/` — substitute the actual MathPipeProver location. Trust `lean_state.md` over literal paths when reality differs.

## Steps

1. **Read state.** Read `{PROOF_REPO}/lean/lean_state.md`. Verify the state is consistent with running the dep audit now (typically `Current phase: deps_proposing`). If still `structuring`, run `/lean-structure` first.

2. **Verify Extended Pro.** `/set-model-extended --port PORT`.

3. **Render the prompt.** Read `${MATHPIPEPROVER}/prompts/soft/82_lean_dep_audit_soft.md` and substitute:
   - `{context_bundle}` → concatenation of `{PROOF_REPO}/lean/decomposition.md` (structurer output) and `{PROOF_REPO}/lean/source_proof.md` (so the model can disambiguate when needed).
   Write to `{PROOF_REPO}/lean/diagnostics/lean_dep_audit_request.md`.

4. **Submit.** `/submit-role --project-url URL --port PORT --prompt-file {PROOF_REPO}/lean/diagnostics/lean_dep_audit_request.md --response-file {PROOF_REPO}/lean/diagnostics/lean_dep_audit_response.md`

5. **Wait + harvest.** Heartbeat or manual poll. Extended Pro will take 30–90 minutes.

6. **Parse the response.** Extract the leading `dep_audit` fenced block (`total_external`, `total_candidates`, `needs_inventory_lean_stub`). Save the full response to `{PROOF_REPO}/lean/dep_audit_proposed.md`.

7. **Update state.** `lean_state.md`: phase `→ deps_verifying`. Append history with candidate counts. Report next skill: `/lean-verify-deps`.

## Notes

- This skill is *not* the verification step. It only produces the proposal. The expensive iterative checking against AXLE is `/lean-verify-deps`, which runs in a sub-agent loop without further Extended Pro round-trips.
- If the structurer flagged many `NON_MATHLIB` results, expect the dep-audit's `econ_lean_stub` plan section to be long. That's normal; INVENTORY.lean grows over time.
- If `total_candidates` is small (<20) or zero, sanity-check the decomposition — usually it means the structurer under-counted external results.
