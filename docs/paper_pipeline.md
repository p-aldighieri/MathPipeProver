# Paper Pipeline

The repository still contains paper-writing prompts, but the paper pipeline is not a first-class executable phase of MathPipeProver as of April 21, 2026. The live runtime stops at theorem artifacts and soft-scaffolding handoff.

## Live Runtime Boundary

The executable theorem roles in `mathpipeprover/roles.py` are:

- `formalizer`
- `literature`
- `searcher`
- `breakdown`
- `prover`
- `reviewer`
- `scope_keeper`
- `consolidator`

Those roles produce the artifacts that matter for a later manuscript pass: `formalizer.md`, `strategy.md`, `breakdown.md`, `breakdown_amendments.md`, `prover_*.md`, `reviewer_*.md`, `knowledge_ledger.md`, `scope_decision.md`, and `final_report.md`.

## What Exists

- Prompt templates for `paper_writer`, `paper_editor`, and `paper_reviewer` under `prompts/soft/` (numbered 90/91/92, suffixed `_soft.md`) and `prompts/api/` (suffixed `_api.md`)
- A browser-backed Mode A or Mode B operator can still run those prompts manually after theorem work stabilizes
- Theorem-run artifacts already provide the source packet a paper workflow needs

## What Does Not Exist

- No paper roles are registered in `mathpipeprover/roles.py`
- No automatic theorem-to-paper transition exists in the workflow engine
- No paper-specific `mpp` command family exists
- No live config profile wires paper roles into `role_runtime`

## Recommended Use

Treat paper work as a follow-on soft-scaffolding workflow, not as a built-in runner phase.

1. Finish the theorem run until the winning branch and `final_report.md` are trustworthy.
2. Freeze the proof-state packet you want to cite: formal statement, current breakdown, accepted lemmas, reviewer verdicts, and ledger notes.
3. Run `paper_writer` in a fresh browser-backed session to draft or revise the manuscript.
4. Run `paper_editor` as a separate pass for structure, exposition, notation, and section ordering.
5. Run `paper_reviewer` in a fresh pass that can still send the work back to theorem roles if it finds a proof-level gap.

## Routing Guidance

| Verdict | Meaning | Next step |
| --- | --- | --- |
| PASS | The paper is mathematically and editorially ready at current scope. | Commit the manuscript changes and archive the packet used to justify them. |
| CONDITIONAL | The proof is fine, but exposition or notation needs revision. | Return to `paper_writer`, then rerun `paper_reviewer`. |
| FAIL (writing gap) | The argument is sound, but the manuscript structure is not ready. | Rewrite with `paper_writer`, then pass through `paper_editor` and `paper_reviewer` again. |
| FAIL (proof gap) | A theorem-level issue remains. | Go back to theorem roles such as `breakdown`, `prover`, and `reviewer` before more paper polishing. |

## Practical Rules

- Keep theorem proving and paper polishing in separate sessions so verdicts stay legible.
- Use fresh reviewer turns for paper review; do not inherit a writer-heavy context.
- Prefer citing existing theorem artifacts over re-summarizing from memory.
- Treat this page as a manual soft-scaffolding playbook, not as a promise of built-in automation.
