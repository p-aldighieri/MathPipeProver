---
description: Headline Translation Auditor — verify the top-level theorems' Lean signatures match the mathematical theorems stated in the source paper/memo. Headlines only; not per-lemma.
argument-hint: --proof-repo PATH --project-url URL --port PORT --headlines "<comma-separated theorem slugs>"
---

The Headline Translation audit. Focused, top-level check: do the **headline theorems** in `main.lean` correctly translate the mathematical statements from the source paper / executive summary / source memo?

This is NOT a per-lemma sweep — use `/submit-role` with `86_lean_meaning_check_soft.md` for that. This is the smaller audit: ≤ 8 headlines, deep on each.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--project-url URL`, `--port PORT` — ChatGPT project URL + CDP port for the reviewer submission
- `--headlines "<slug1>,<slug2>,..."` — comma-separated list of headline theorem slugs/names to audit (e.g., `"T1-clarke-danskin-multiplier-bayes-cone,binary-L_B6-capstone,Hall-biconditional,FBNF-F4-capstone,T2-alpha-zero-singleton-prior-strategy"`)

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. The audit prompt lives at `${MATHPIPEPROVER}/prompts/soft/8a_lean_headline_translation_soft.md`.

## Steps

1. **Pre-flight.** Ensure `main.lean` compiles. Extract the type signatures of the headlines from `main.lean` using grep:
   ```bash
   for slug in $(echo "$HEADLINES" | tr ',' ' '); do
     grep -A 12 "theorem.*$slug\|theorem «$slug»" {PROOF_REPO}/lean/main.lean
   done
   ```
   Save to a temp file.

2. **Refresh project sources.** Upload `main.lean`, plus the source memos containing the mathematical statements of the headlines (e.g., `v9_consolidated.md`, `exposition_v9.tex`, executive summary).

3. **Compose the prompt.** Use `prompts/soft/8a_lean_headline_translation_soft.md`. Append the headline list and the extracted Lean signatures.

4. **Submit to a fresh ChatGPT chat** with Extended Pro. The reviewer will read the source memos + Lean signatures and produce a per-headline assessment.

5. **Wait + dump** to `{PROOF_REPO}/03_runs/.../headline_translation_response.md`.

6. **Parse the audit.** The `headline_translation` block lists categorical assessments. If any are MIS_HYPOTHESIZED / MIS_CONCLUDED / WRONG, surface as critical. CERTIFICATE_VERIFIER assessments are not failures but the user must explicitly acknowledge each.

7. **Update state.** Append `axle_log.jsonl` event `headline_translation_received` with counts.

## Output

Per-headline assessment + overall "headline translation faithfulness" verdict (FAITHFUL / PARTIAL / UNFAITHFUL).

## Notes

- Distinguish from `/lean-final-check` (signature-vs-target match for one theorem) and from per-lemma `86_lean_meaning_check` (every lemma audited).
- This audit's primary risk is detecting **CERTIFICATE_VERIFIER** patterns — Lean theorems that look right but whose hypothesis data-structure already contains the conclusion. Those are not failures per se, but the user MUST be informed about each.
- Recommend the user invoke this AFTER `/lean-inventory-match` (so the Inventory is settled) but BEFORE `/lean-smuggling-check` (so any flagged certificate-verifier patterns are known to the smuggling auditor).
- Limit ≤ 8 headlines. If the proof has more than 8 candidate headlines, the user should specify a subset.
