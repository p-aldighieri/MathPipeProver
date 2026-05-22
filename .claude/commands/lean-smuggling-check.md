---
description: Smuggling Auditor — catch sorrys, axiom-tricks, opaque-trapdoors, vacuous fields, Classical.choice abuse, tactic suppressions that should not be in the proof.
argument-hint: --proof-repo PATH --project-url URL --port PORT [--whitelist-file PATH]
---

The Smuggling audit. Final-pass adversarial check: is anything in the proof file other than legitimate proofs? Specifically catches:

1. `sorry` outside the permitted list.
2. `axiom` whose conclusion is proof-specific (not a standard external result).
3. `opaque` / `constant` trapdoors.
4. Structure fields of type `Prop` (no content) used as if proven.
5. Structure fields whose type is the conclusion of a theorem (`CONCLUSION_AS_FIELD` — certificate-verifier pattern; not a failure but must be explicit).
6. `Classical.choice` abuse.
7. `noncomputable` / `unsafe` / disabled-linter tactic suppressions.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL`, `--port PORT` — ChatGPT project URL + CDP port for the reviewer submission
- `--whitelist-file PATH` — optional file listing permitted sorrys / axioms / opaques (one per line, or the orchestrator extracts from `source_proof.md §Inventory axioms expected` + documented open follow-ups)

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout. The audit prompt lives at `${MATHPIPEPROVER}/prompts/soft/8b_lean_smuggling_check_soft.md`.

## Steps

1. **Build the whitelist.** Extract from `source_proof.md §Inventory axioms expected` the list of accepted Inventory axiom names. Add any open-follow-up sorrys from `lean_state.md` (e.g., `AlphaZeroSingletonData_exists`).

2. **Pre-flight: literal scan.** Before submitting to the reviewer, do a local scan of `main.lean`:
   ```bash
   grep -n "sorry\|^axiom\|^opaque\|^constant\|Classical.choice\|noncomputable section\|set_option linter" {PROOF_REPO}/lean/main.lean > /tmp/literal_findings.txt
   ```
   This gives the reviewer a starting line-list. Pass `/tmp/literal_findings.txt` along with the prompt.

3. **`#print axioms` audit.** For each headline theorem in `lean_state.md`, run `#print axioms <theorem-name>` to enumerate the transitively-consumed axioms. Save to `/tmp/print_axioms.txt`.

4. **Refresh project sources.** Upload `main.lean`, `source_proof.md`, `lean_state.md`, plus the two pre-flight files (`literal_findings.txt`, `print_axioms.txt`).

5. **Compose the prompt.** Use `prompts/soft/8b_lean_smuggling_check_soft.md`. Append the whitelist + the literal-findings + the print-axioms output.

6. **Submit to a fresh ChatGPT chat**, Pro / 5.5 model.

7. **Wait + dump** to `{PROOF_REPO}/03_runs/.../smuggling_check_response.md`.

8. **Parse the audit.** The `smuggling_check` block lists per-construct assessments. Surface any SMUGGLED_SORRY / SMUGGLED_AXIOM / OPAQUE_TRAPDOOR / CHOICE_ABUSE / VACUOUS_FIELD findings as critical. CONCLUSION_AS_FIELD and TACTIC_SUPPRESSION findings are advisory but must be documented.

9. **Update state.** Append `axle_log.jsonl` event `smuggling_check_received` with severity (NONE / LOW / MEDIUM / HIGH / CRITICAL).

## Output

A clean (no smuggling) report or a list of findings with severity. The user can then decide whether to patch or whitelist each finding.

## Notes

- Run this LAST in the final-audit sequence: `/lean-final-check` → `/lean-inventory-match` → `/lean-headline-translation` → `/lean-smuggling-check`. Earlier audits clarify what the legitimate Inventory + certificate-verifier patterns are; the smuggling audit then catches deviations.
- Adversarial: a SMUGGLED_AXIOM is an axiom whose conclusion type is essentially the theorem statement that should have been proved (not a named external result like Clarke–Danskin). It's the hardest form of smuggling because it superficially looks legitimate.
- A VACUOUS_FIELD is `field : Prop` used as if it were a proven proposition. Structure fields holding concrete propositions (`field : some-concrete-claim`) are CONCLUSION_AS_FIELD (advisory), not VACUOUS.
- `Classical.choice` / `Classical.arbitrary` in scope is fine; abuse is using it to pull a witness for a statement that should have been constructively proved.
- A `noncomputable section` is normal for proofs involving `Real`/`Measure`. A `noncomputable` on a specific definition that hides a `sorry` is the smuggling case.
