---
description: Bootstrap a Lean post-processing working directory in the proof repo
argument-hint: --proof-repo PATH --branch BRANCH [--run-id RUN_ID]
---

Bootstrap `{PROOF_REPO}/lean/` from the consolidator's English proof so the rest of the Lean skills have a clean working tree and a durable state file.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--branch BRANCH` — branch whose `final_report.md` is the source proof
- `--run-id RUN_ID` — optional; if omitted, auto-detect the latest run under `{PROOF_REPO}/runs/`

## Steps

1. **Pre-flight.** Verify `{PROOF_REPO}/lean/` either does not exist or is empty. If it has content, stop and ask the user to confirm overwrite — never silently clobber prior work.

2. **Locate the source proof.** Path is `{PROOF_REPO}/runs/<run-id>/branches/<branch>/context/final_report.md`. If that file doesn't exist, the branch hasn't been consolidated yet — stop and tell the user to run the consolidator first.

3. **Create the directory tree:**
   ```bash
   mkdir -p {PROOF_REPO}/lean/{support,lemmas,diagnostics}
   ```

4. **Seed `main.lean`** with a minimal stub:
   ```lean
   /-
   Lean formalization scaffold.
   This file is rewritten by the lean_formalizer role (see /lean-formalize).
   -/
   import Mathlib

   namespace Formalization

   end Formalization
   ```

5. **Seed `support/INVENTORY.lean`** with a header comment. Leave it empty otherwise — entries are appended by the formalizer when the dep audit flags `not_in_mathlib` results:
   ```lean
   /-
   INVENTORY.lean — persistent stub file for results invoked by the proof
   but not available in Mathlib at the pinned toolchain. Stubs may be
   refined into proved statements over time. Inlined into every AXLE
   submission since AXLE cannot import non-Mathlib libraries.
   -/
   namespace Inventory

   end Inventory
   ```

6. **Copy the source proof** into `{PROOF_REPO}/lean/source_proof.md` so the Lean side has a stable reference even if the upstream branch evolves.

7. **Initialize `lean_state.md`** at `{PROOF_REPO}/lean/lean_state.md`. Template:
   ```markdown
   # Lean Formalization State

   ## Meta
   - Proof repo: {PROOF_REPO}
   - Branch: {BRANCH}
   - Source run: {RUN_ID}
   - Initialized: {ISO8601 UTC}
   - Current phase: init
   - Target Lean toolchain: lean-4.29.0
   - AXLE log: lean/axle_log.jsonl

   ## Artifacts
   - Source proof: lean/source_proof.md
   - Main Lean file: lean/main.lean (skeleton)
   - INVENTORY.lean: lean/support/INVENTORY.lean (empty)
   - Diagnostics: lean/diagnostics/
   - Per-lemma proofs: lean/lemmas/ (empty)

   ## Lemma Status
   _(populated by /lean-structure)_

   ## Recent History
   - {ISO8601 UTC}  /lean-formalize-init  bootstrapped from branch {BRANCH}
   ```

8. **Touch the audit log:** `touch {PROOF_REPO}/lean/axle_log.jsonl` (empty file so subsequent `mpp axle … --log-path` appends rather than failing).

9. **Report** the new tree and the next recommended skill (`/lean-structure`).

## Notes

- The Lean working tree lives in the *proof repo*, not in MathPipeProver. This matches the existing soft-scaffolding split: MathPipeProver holds tools, proof repos hold artifacts.
- `lean_state.md` is the durable handoff between sessions. Any future orchestrator session reads it to reconstruct where the formalization stands. Keep it current.
- This skill is idempotent only against an empty `lean/` directory. Do not re-run on an in-flight formalization.
