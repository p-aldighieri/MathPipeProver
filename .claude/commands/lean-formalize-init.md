---
description: Bootstrap a Lean post-processing working directory in the proof repo
argument-hint: --proof-repo PATH [--source-proof PATH] [--provenance LABEL]
---

Bootstrap `{PROOF_REPO}/lean/` from the terminal English proof so the rest of the Lean skills have a clean working tree and a durable state file.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--source-proof PATH` — optional; absolute path to the terminal proof file (English). If omitted, the orchestrator discovers it.
- `--provenance LABEL` — optional human-readable label for where the proof came from (e.g., `consolidator/branches/menu_engine`, `hand-consolidated v8`, `exposition.tex §3`). Goes into `lean_state.md`.

## Orchestrator latitude

This skill establishes the canonical `{PROOF_REPO}/lean/` layout that all downstream skills read from. Inside `lean/`, file names (`source_proof.md`, `main.lean`, `support/INVENTORY.lean`, `lemmas/`, `diagnostics/`, `lean_state.md`, `axle_log.jsonl`) are fixed by convention — downstream skills depend on them. Outside `lean/`, the orchestrator chooses what to point at: this skill does NOT assume a specific upstream proof-repo layout.

## Steps

1. **Pre-flight.** Verify `{PROOF_REPO}/lean/` either does not exist or is empty. If it has content, stop and ask the user to confirm overwrite — never silently clobber prior work.

2. **Locate the source proof.** Use `--source-proof PATH` if given. Otherwise discover it from the proof repo's layout — common locations include:
   - **Consolidator-produced:** `{PROOF_REPO}/runs/<run-id>/branches/<branch>/context/final_report.md` (the MathPipeProver smart-scaffolding default).
   - **Versioned theorem drafts:** `{PROOF_REPO}/02_proof_history/theorem_versions/<latest>.md` (older hand-curated repos).
   - **Polished exposition:** `{PROOF_REPO}/01_deliverables/exposition/exposition.tex` (when the consolidator output was inlined into a paper draft).
   - **Closure-memo target:** the file named in `{PROOF_REPO}/01_deliverables/closure/*.md` or the repo's `README.md` as the current terminal artifact.

   Inspect the repo, pick the *most recent fully-consolidated artifact*, and confirm with the user before proceeding if there's any ambiguity. Record the absolute path and a one-line justification in `lean_state.md`'s `Meta` section.

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

6. **Copy the source proof** into `{PROOF_REPO}/lean/source_proof.md` so the Lean side has a stable reference even if the upstream artifact evolves. If the source is `.tex` or another non-markdown format, copy verbatim with the original extension preserved alongside, but write the canonical `source_proof.md` (markdown wrapping if needed — but do not paraphrase content).

7. **Initialize `lean_state.md`** at `{PROOF_REPO}/lean/lean_state.md`. Template:
   ```markdown
   # Lean Formalization State

   ## Meta
   - Proof repo: {PROOF_REPO}
   - Source proof (absolute): {ABS PATH chosen in step 2}
   - Source provenance: {PROVENANCE LABEL or one-sentence justification of step 2 choice}
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
   - {ISO8601 UTC}  /lean-formalize-init  bootstrapped from {SOURCE provenance}
   ```

8. **Touch the audit log:** `touch {PROOF_REPO}/lean/axle_log.jsonl` (empty file so subsequent `mpp axle … --log-path` appends rather than failing).

9. **Report** the new tree, the source proof path chosen, and the next recommended skill (`/lean-structure`).

## Notes

- The Lean working tree lives in the *proof repo*, not in MathPipeProver. This matches the existing soft-scaffolding split: MathPipeProver holds tools, proof repos hold artifacts.
- `lean_state.md` is the durable handoff between sessions. Any future orchestrator session reads it to reconstruct where the formalization stands — including which source proof was chosen and why. Keep it current.
- This skill is idempotent only against an empty `lean/` directory. Do not re-run on an in-flight formalization.
- The canonical layout inside `lean/` (file names, subdirs) is a contract with the downstream lean-* skills. Don't rename within `lean/`.
