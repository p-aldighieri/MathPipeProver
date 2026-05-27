---
name: set-referee-targets
description: Create or update {PROOF_REPO}/referee_targets.yaml — the target-journal registry the paper_referee role consults to judge whether the result clears the bar at the journals you might submit to. Optional; without it the referee falls back to a generic publishability check.
---

# set-referee-targets

**Canonical content:** `.claude/commands/set-referee-targets.md` in this
repo. Codex and Claude Code share the same procedure — edit the Claude
command file, not this stub.

## TL;DR for Codex sessions

The paper pipeline's referee role consults a YAML registry of target
journals + each journal's clearance bar. The registry lives in the PROOF
repo (not in MathPipeProver), typically at
`{PROOF_REPO}/referee_targets.yaml`.

Template + schema: `prompts/fragments/referee_targets_template.yaml` in
this repo. Has a few documented econ examples (AER, ECMA, TheorEcon, JET)
and a few math examples (Annals, JAMS) you can copy.

Usage:
```bash
/set-referee-targets --proof-repo PATH [--journals AER,JET,TheorEcon] [--field economics]
```

The skill copies the template into the proof repo, seeds known slugs with
their bar criteria from the template, and stubs unknown slugs for the user
to fill in.

Honesty discipline: write the bars you actually think the journal demands,
not aspirational framings. Conservative bars produce useful FAIL signals;
aspirational bars produce false-positive clearances.

Read `.claude/commands/set-referee-targets.md` for the full step-by-step.
