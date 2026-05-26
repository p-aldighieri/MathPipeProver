---
description: Inventory Match Auditor — verify Inventory contains exactly the declared external dependencies, properly stated; flag overstatement / understatement / trapdoors / unused / missing.
argument-hint: --proof-repo PATH --project-url URL --port PORT
---

The Inventory Match audit. Verifies that the `Inventory` namespace in `main.lean` (or `support/INVENTORY.lean`) matches the declared external dependencies in `source_proof.md` / `decomposition.md`, with no overstatement / understatement / trapdoor / unused / missing.

This is a final-pass audit, run after `/lean-final-check` confirms the file compiles cleanly. It produces a `inventory_match` machine-readable summary plus a per-axiom audit.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL`, `--port PORT` — ChatGPT project URL + CDP port for the reviewer submission

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. The audit prompt lives at `${MATHPIPEPROVER}/prompts/soft/89_lean_inventory_match_soft.md`.

## Steps

1. **Pre-flight.** Ensure `main.lean` compiles (re-run `lake build` if state is stale). The audit is meaningless if the file doesn't compile.

2. **Refresh project sources.** Upload the current `main.lean`, `source_proof.md`, `lean_state.md`, `decomposition.md`, and the relevant exposition/consolidated source memos to the ChatGPT project on `--port`.
   ```bash
   node "${MATHPIPEPROVER}/scripts/chatgpt_browser_agent/cdp_add_source.mjs" \
       --project-url "${PROJECT_URL}" --port "${PORT}" \
       "{PROOF_REPO}/lean/main.lean" \
       "{PROOF_REPO}/lean/source_proof.md" \
       "{PROOF_REPO}/lean/lean_state.md" \
       "{PROOF_REPO}/lean/decomposition.md"
   ```

3. **Compose the prompt.** Use `prompts/soft/89_lean_inventory_match_soft.md` as the role; append the user's whitelist (accepted Inventory axioms from `source_proof.md §Inventory axioms expected`).

4. **Submit to a fresh ChatGPT chat** on the project, via `scripts/chatgpt_browser_agent/cdp_submit.mjs` after verifying Extended Pro.

5. **Wait + dump.** `node wait_chat_done.mjs --chat-url ... --out {PROOF_REPO}/03_runs/.../inventory_match_response.md`.

6. **Parse the audit.** Read the `inventory_match` block. If any TRAPDOOR / OVERSTATED / UNDERSTATED / MISSING items are flagged, surface them to the orchestrator and recommend patches before merge / next phase. UNUSED items are advisory (acceptable in certificate-verifier pattern but should be documented).

7. **Update state.** Append an `axle_log.jsonl` entry with event type `inventory_match_received` and verdict counts.

## Output

A per-axiom assessment + overall verdict. Mergeable as "Inventory-matches-declared-dependencies" requires:
- 0 TRAPDOOR
- 0 MISSING
- OVERSTATED / UNDERSTATED items individually justified or patched

## Notes

- This audit is independent of `/lean-final-check` (which checks sorry/axiom counts and signature match) — it audits the *content* of the Inventory rather than its size.
- A trapdoor axiom can pass `/lean-final-check` if the user adds it to the permitted-sorries list, but `/lean-inventory-match` will flag it.
- Distinguish UNUSED-but-consumed-via-data-witness from genuinely UNUSED. The former is a certificate-verifier pattern choice; the latter is dead code.
- If the proof has separate Inventory sub-namespaces (e.g., `Inventory.V8`, `Inventory.V9`), audit each separately.
- The user's source-proof brief is the spec. If the proof imports an axiom not in the brief, that's MISSING in Inventory vs the brief OR the proof is consuming an undeclared dependency.
