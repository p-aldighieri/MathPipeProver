---
description: Fan in all proved lemmas into the main Lean file via AXLE merge
argument-hint: --proof-repo PATH
---

Combine `INVENTORY.lean`, `main.lean`, and every proved `lemmas/<slug>.lean` into a single dedup'd, topo-ordered file using AXLE's `merge` endpoint. This is the assembly step after the prover loop, before the final-check.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Trust `lean_state.md` over literal paths when reality differs.

## Steps

1. **Read state.** Verify the state is consistent with merging now (typically `Current phase: proving_lemmas`, with at least one proved lemma to merge).

2. **List inputs.** Collect, in this order:
   - `{PROOF_REPO}/lean/support/INVENTORY.lean`
   - `{PROOF_REPO}/lean/main.lean` (skeleton with sorrys)
   - every file in `{PROOF_REPO}/lean/lemmas/*.lean` (one proved lemma each)

3. **Build the merge command:**
   ```bash
   mpp axle merge \
       $(for f in INVENTORY.lean main.lean lemmas/*.lean; do echo "--in {PROOF_REPO}/lean/$f"; done) \
       --log-path {PROOF_REPO}/lean/axle_log.jsonl \
       > {PROOF_REPO}/lean/diagnostics/merge_response.json
   ```
   AXLE's `merge` will:
   - dedupe theorems with identical signatures (keeps the proved version over a stubbed one)
   - topo-order declarations so dependencies precede dependents
   - rename conflicting names if any (rare, but possible if the prover named a `have` the same as a top-level lemma)

4. **Extract the merged source** from the response's `content` field (or whatever key AXLE returns — check the merge_response.json structure). Write to `{PROOF_REPO}/lean/main.merged.lean`.

5. **Sanity-check the merge.** Run `mpp axle check --in {PROOF_REPO}/lean/main.merged.lean --log-path {PROOF_REPO}/lean/axle_log.jsonl`. Exit 0 = merge produced valid Lean. Exit 2 = merge broke something — diff against the unmerged components to find what.

6. **Atomic swap.** If the check passed, move `main.merged.lean` → `main.lean` (backing up the prior `main.lean` to `diagnostics/main_pre_merge_<timestamp>.lean` first). If it failed, leave `main.lean` untouched and surface the AXLE errors.

7. **Update state.** `lean_state.md`: append a history entry recording the merge. Mark merged lemmas `merged=✓` in the Lemma Status table.

8. **Report** the merged sorry count: ideally zero, but if any lemmas weren't proved yet they still appear as sorrys. Recommend next: `/lean-prove-lemma <next-unproved-slug>` until count is zero, then `/lean-final-check`.

## Notes

- AXLE's `merge` prefers sorry-free implementations when it dedupes. This means after merge, the `main.lean` skeleton's `theorem foo := sorry` is replaced by `lemmas/foo.lean`'s proved version automatically. You don't have to do the splice by hand.
- Merge is cheap (one AXLE call). Run it after every couple of lemmas, not just at the end — it surfaces conflicts early.
- The pre-merge backup in `diagnostics/` lets you roll back if the merged file has issues that only show up in `/lean-final-check`.
