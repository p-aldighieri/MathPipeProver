---
description: Create or update {PROOF_REPO}/referee_targets.yaml — the target-journal registry that the paper_referee role consults to judge whether the result clears the bar at one or more journals you might submit to.
argument-hint: --proof-repo PATH [--journals slug1,slug2,...] [--field economics|math|cs|...]
---

The paper-pipeline's referee role (`prompts/soft/92_paper_referee_soft.md`)
judges whether the finished result clears the bar at a list of target
journals you specify. That list lives in `{PROOF_REPO}/referee_targets.yaml`
— this skill creates or updates that file.

The file is **optional**. Without it, the referee falls back to a generic
"is this publishable in a top field journal?" check. With it, the referee
checks per-journal clearance and reports CLEARS_ANY / CLEARS_NONE.

Arguments: $ARGUMENTS
- `--proof-repo PATH` (required) — absolute path to the proof working folder
- `--journals slug1,slug2,...` (optional) — comma-separated journal slugs
  to seed. If known to the template (e.g. AER, ECMA, TheorEcon, JET,
  Annals, JAMS), the orchestrator fills bar criteria from the template
  examples. Unknown slugs get placeholder bar_criteria for the user to
  edit.
- `--field economics|math|cs|...` (optional) — filters the template
  examples to a single field when seeding.

## Steps

1. **Locate the template.** The starter template lives in
   `{MATHPIPEPROVER}/prompts/fragments/referee_targets_template.yaml`.
   Read it for the schema and the documented examples.

2. **Check for an existing registry** at `{PROOF_REPO}/referee_targets.yaml`.
   - If present: read it; ask the user whether to ADD entries, REPLACE the
     file, or leave it alone. Default behavior is preserve + add new entries.
   - If absent: create it from the template.

3. **Seed from `--journals` if provided.** For each slug:
   - If the template has a documented example, copy that entry verbatim
     (slug + full_name + field + bar_criteria).
   - Otherwise create a stub entry with the slug + a placeholder
     `bar_criteria: TODO — write a 2–6 sentence honest description of
     what clears this journal's bar.` The user MUST fill these in
     before the referee will give a useful verdict for that slug.

4. **Honesty discipline (mention to the user).** The bar should be what
   you honestly think the journal demands. Aspirational framings ("this
   should be an AER-level result") produce false-positive clearances.
   Conservative framings produce useful FAIL signals. If you don't know
   a journal's bar well, prefer a slightly tighter description than you
   think reflects reality.

5. **Write the file.** Save to `{PROOF_REPO}/referee_targets.yaml` with a
   header comment naming the date and the slugs included.

6. **Surface next steps.** Tell the user:
   - The file is now wired into the paper_referee role.
   - To edit, just edit the YAML directly — no skill round-trip needed.
   - The paper_referee verdict will be CLEARS_ANY / CLEARS_NONE based on
     this list; if CLEARS_NONE, the routing is back to paper_writer/editor
     (WRITING_GAP) or to the orchestrator to retarget/expand the result
     (BAR_GAP). It will NOT recheck proofs — that's the regular reviewer
     role's job.

## Recovery

- If the YAML is malformed (manual edits gone wrong), the referee will
  fall back to the generic check and emit a warning. Re-run this skill
  to regenerate from the template.
- The template lives in MathPipeProver; the actual file lives in the
  proof repo. Don't commit `referee_targets.yaml` to MathPipeProver
  itself.
