# Paper Pipeline

Once the theorem pipeline produces verified results (Prover PASS + Reviewer PASS), the paper pipeline takes over to produce a publishable manuscript.

## Flow

```
THEOREM PIPELINE (Searcher → Breakdown → Prover → Reviewer → PASS)
        ↓ (results verified)
PAPER PIPELINE:
        ↓
    WRITER (produces/revises LaTeX manuscript)
        ↓
    EDITOR (structural/clarity/notation review)
        ↓ loops until APPROVE
    PEER REVIEWER (rigorous mathematical review)
        ↓
    PASS → done (publish)
    CONDITIONAL (minor) → WRITER fixes → fresh PEER REVIEWER
    FAIL (writing gap) → WRITER rewrites → EDITOR → PEER REVIEWER
    FAIL (proof gap) → back to THEOREM PIPELINE
```

## Roles

| Role | Prompt | Purpose |
|------|--------|---------|
| Paper Writer | `prompts/paper_writer.md` | Produce/revise LaTeX manuscript |
| Paper Editor | `prompts/paper_editor.md` | Structure, notation, clarity review |
| Peer Reviewer | `prompts/paper_reviewer.md` | Rigorous mathematical verification |

## Routing Rules

| Reviewer Verdict | Issue Type | Next Step |
|-----------------|------------|-----------|
| PASS | — | Done. Commit, push, submit to journal. |
| CONDITIONAL | Notation/typos/clarity | Writer fixes → fresh Peer Reviewer |
| FAIL | Writing-level gap | Writer rewrites → Editor → Peer Reviewer |
| FAIL | Proof-level gap | Back to Theorem Pipeline (Prover) |

## Execution Rules

1. **Always use Extended Pro** for every submission
2. **Fresh session** for every peer reviewer pass (no context contamination)
3. **One role per session** — never mix writer/editor/reviewer
4. **Single paper file** — overwrite with latest version, git handles history
