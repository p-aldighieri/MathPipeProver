---
description: Run the lean_structurer role + its reviewer until the decomposition passes review
argument-hint: --proof-repo PATH --project-url URL --port PORT
---

Run a structurer ↔ structurer-reviewer cycle on the source proof until the reviewer issues `PASS`. Produces the lemma + object DAG that all later phases depend on.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL` — ChatGPT project URL
- `--port PORT` — Chrome CDP debug port

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Prompt templates live in the MathPipeProver repo under `prompts/soft/` (path written below as `${MATHPIPEPROVER}/prompts/soft/...` — substitute the actual MathPipeProver location). Trust `lean_state.md` and your judgment over literal paths in the steps when reality differs.

## Steps

1. **Read state.** Read `{PROOF_REPO}/lean/lean_state.md`. Verify the state is consistent with running the structurer now (typically `Current phase: init`, or `structuring` if resuming after a failed pass). If anything else, stop and ask the user.

2. **Verify Extended Pro.** Run `/set-model-extended --port PORT`. The structurer is an expensive reasoning pass; the wrong model silently degrades output.

3. **Render the structurer prompt.** Read `${MATHPIPEPROVER}/prompts/soft/80_lean_structurer_soft.md` and substitute:
   - `{context_bundle}` → contents of `{PROOF_REPO}/lean/source_proof.md` (the English proof from the consolidator).
   Write the rendered prompt to `{PROOF_REPO}/lean/diagnostics/lean_structurer_request_<n>.md` (use the next available `<n>`).

4. **Submit.** `/submit-role --project-url URL --port PORT --prompt-file {PROOF_REPO}/lean/diagnostics/lean_structurer_request_<n>.md --response-file {PROOF_REPO}/lean/diagnostics/lean_structurer_response_<n>.md`

5. **Wait + harvest.** Use `/heartbeat` or wait manually. When the response is in, parse the leading `lean_structure` fenced block to extract `object_count`, `lemma_count`, etc. If the block is missing or malformed, treat as a failed submission and re-submit with a clarifying note (the model occasionally drops the parseable block; re-prompting fixes it).

6. **Save the structured artifact.** Write the response content to `{PROOF_REPO}/lean/decomposition.md`. Update `lean_state.md`: phase `→ structuring`, append history entry.

7. **Render and submit the reviewer prompt.** Read `${MATHPIPEPROVER}/prompts/soft/81_lean_structurer_reviewer_soft.md`, substitute `{context_bundle}` with the concatenation of:
   - the original source proof
   - the structurer's response (so the reviewer can compare)
   Submit via `/submit-role`. Save the request and response under `diagnostics/lean_structurer_reviewer_*_<n>.md`.

8. **Parse the reviewer verdict.** Read the leading `review_control` block.
   - `verdict: PASS` → proceed to step 9.
   - `verdict: PATCH_SMALL | PATCH_BIG` → resubmit step 3 *with the reviewer's feedback attached as an additional context file*. Loop back to step 3. Cap at 3 retries; if still not PASS, surface the latest verdict to the user and stop.
   - `verdict: REDO` → escalate to the user. The decomposition is fundamentally off; the orchestrator should not silently retry.

9. **On PASS:** update `lean_state.md`: phase `→ deps_proposing`, add a "Lemma Status" table populated from the structurer's `lean_structure` block. Report the next recommended skill (`/lean-dep-audit`).

## Notes

- This skill loops internally up to 3 times. Each iteration is one Extended Pro submission, so budget 1–2 hours wall-clock per iteration.
- The reviewer's `implicit_assumptions_absorbed` count is a flag — any non-zero value means the structurer baked in something the source didn't state. Even on `PASS` with a non-zero count, surface it to the user before proceeding.
- Object definitions matter as much as lemmas. Spot-check the "Objects and Definitions" section against the source proof before declaring the cycle done.
