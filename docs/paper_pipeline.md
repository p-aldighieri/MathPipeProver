# Paper Pipeline

The repository contains paper-writing prompts, but the paper pipeline is not a first-class executable phase of MathPipeProver. The live runtime stops at theorem artifacts and soft-scaffolding handoff. Treat paper work as a follow-on soft-scaffolding workflow, not as a built-in runner phase.

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
- `gatekeeper`

Those roles produce the artifacts that matter for a later manuscript pass: `formalizer.md`, `strategy.md`, `breakdown.md`, `breakdown_amendments.md`, `prover_*.md`, `reviewer_*.md`, `knowledge_ledger.md`, `scope_decision.md`, and `final_report.md`.

## What Exists

- Prompt templates for `paper_writer`, `paper_editor`, and `paper_referee` under `prompts/soft/` (numbered 90/91/92, suffixed `_soft.md`) and `prompts/api/` (suffixed `_api.md`).
- An optional per-proof journal-targets registry at `{PROOF_REPO}/referee_targets.yaml`, seeded via the `/set-referee-targets` skill from the template at `prompts/fragments/referee_targets_template.yaml`. When present, the `paper_referee` role judges per-journal clearance against the bars listed there.
- A browser-backed smart-scaffolding operator can run those prompts manually after theorem work stabilizes.
- Theorem-run artifacts already provide the source packet a paper workflow needs.

## What Does Not Exist

- No paper roles are registered in `mathpipeprover/roles.py`
- No automatic theorem-to-paper transition exists in the workflow engine
- No paper-specific `mpp` command family exists
- No live config profile wires paper roles into `role_runtime`

## The three roles

- **`paper_writer`** — turns the theorem packet into a manuscript draft (or revises an existing one given editor/referee feedback). Standard sections: abstract / intro / setup / main result / proof or sketch / discussion / refs. Does not invent claims unsupported by the proof packet.
- **`paper_editor`** — copy-editor + journal-editor pass. Structure, notation, exposition, section ordering, abstract quality, related-work coverage. Does **not** verify proofs (the upstream `reviewer` does that). Batches feedback into one concrete revision pass.
- **`paper_referee`** — plays the journal-referee role. Does **two** things only: (1) writing check (is the manuscript ready to be sent out?) and (2) bar check (does the result-as-stated clear the bar at any of the journals listed in `referee_targets.yaml`?). The referee does **NOT** recheck proofs — that's the upstream `reviewer`/`prover` job. The referee is the **final goal-loop bar**: if it returns CLEARS_ANY, you have a paper; if CLEARS_NONE, the gap type tells you whether to route back to writer/editor or to expand the result.

## Recommended Use

1. Finish the theorem run until the winning branch and `final_report.md` are trustworthy.
2. Freeze the proof-state packet you want to cite: formal statement, current breakdown, accepted lemmas, reviewer verdicts, and ledger notes.
3. **(Optional but recommended)** Run `/set-referee-targets --proof-repo PATH --journals SLUG1,SLUG2` to populate `{PROOF_REPO}/referee_targets.yaml`. Without this the referee falls back to a generic publishability check; with it, you get per-journal clearance.
4. Run `paper_writer` in a fresh browser-backed session to draft or revise the manuscript.
5. Run `paper_editor` as a separate pass for structure, exposition, notation, and section ordering.
6. Run `paper_referee` as the final goal-loop bar. Read the per-journal clearance + the Gap Type; route accordingly.

## Routing Guidance

The referee's `Gap Type` field is the routing signal:

| Gap Type | Meaning | Next step |
|---|---|---|
| `NONE` (CLEARS_ANY overall) | Manuscript clears the bar at at least one target journal. | Submit to the strongest-clear journal. Archive the proof + manuscript packet used to justify submission. |
| `WRITING_GAP` (CLEARS_NONE) | Substance is at-bar but the writing isn't ready. | Back to `paper_writer` / `paper_editor` with the referee's specific fix list. |
| `BAR_GAP` (CLEARS_NONE) | Writing is fine, but the result-as-stated doesn't clear any target journal's bar — the contribution is too small / narrow / off-audience. Better writing won't fix this. | Orchestrator decides: retarget at lower-bar journals (update `referee_targets.yaml` and re-run referee), or go back upstream to expand / reposition the result. |
| `MIXED` (CLEARS_NONE) | Both writing and bar problems. | Address whichever dominates first; the referee names which. |

## What the referee is NOT

- **Not a proof checker.** Proof correctness is the upstream `reviewer` and `prover`'s job. If the referee spots a manuscript-level mathematical contradiction it'll flag and route back, but it will not attempt to verify or repair proofs itself.
- **Not a writer.** It judges, it doesn't rewrite. WRITING_GAP routes back to `paper_writer` / `paper_editor`, not to the referee.

## Practical Rules

- Keep theorem proving and paper polishing in separate sessions so verdicts stay legible.
- Use fresh referee turns; do not inherit a writer-heavy context.
- Prefer citing existing theorem artifacts over re-summarizing from memory.
- Be honest in `referee_targets.yaml`. Aspirational bar criteria produce false-positive clearances; conservative criteria produce useful FAIL signals. See the template (`prompts/fragments/referee_targets_template.yaml`) for the honesty discipline note.
- Treat this page as a manual soft-scaffolding playbook, not as a promise of built-in automation.
