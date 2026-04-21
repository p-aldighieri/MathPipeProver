# Governance Policy Modes

This file captures the governance-policy design for `strict`, `semi_strict`, and `flexible` behavior without forcing rigid JSON contracts.

These are policy modes, not the repository's operating-mode taxonomy. The operating modes are the smart soft-scaffolding / supervisor-assisted / full-API split documented in `README.md`, `CLAUDE.md`, and `docs/soft_scaffolding.md`.

## Core design

1. Role outputs stay markdown-first.
2. Lightweight tags are optional but recommended for governance.
3. A cheap pass (small model or parser) can extract tags and update ledgers.
4. Scope/assumption checks happen during the loop, not only at the end.
5. Soft scaffolding keeps routing with the smart orchestrator; the API lane uses built-in phase transitions plus reviewer control hints.

## Lightweight tags

Use these tags in normal markdown lines:
- `[USER]` user-provided fact
- `[LIT]` literature-derived hint/evidence
- `[DERIVED]` inference from current branch state
- `[CONJECTURE]` unproven guess
- `[SCOPE]` scope modification
- `[ASSUMPTION+]` new assumption added
- `[ASSUMPTION-]` assumption removed
- `[BREAKDOWN_AMEND]` proposer wants to change lemma plan

No strict schema is required. If tags are missing, the workflow still runs.

## Policy behavior

## `strict`
- No scope narrowing accepted.
- No new assumptions accepted.
- Goal is full-general proof or failure/counterexample direction.
- Any detected scope change causes `FAIL_SCOPE`.

## `semi_strict`
- Small scope/assumption changes are allowed, capped by policy budgets.
- Good for realistic theorem development where minimal restriction is acceptable.

## `flexible`
- Allows broader scope changes and assumption exploration.
- Best for discovery phase and research ideation.

## Scope reconciliation flow

At each prover/reviewer cycle:
1. Aggregate tags from current branch markdown files.
2. Update `assumption_delta.md`.
3. Evaluate against policy limits.
4. Write `scope_decision.md`.
5. Continue or stop branch.

## Workflow glue

- In soft scaffolding, every completed role hands control back to the smart orchestrator.
- In the API lane, phase transitions are built into the runner, with reviewer control blocks able to suggest the next phase.
- In both cases, reviewer guidance is diagnostic input, not a substitute for mathematical judgment.

## Breakdown amendment flow

- Prover can emit `[BREAKDOWN_AMEND]` lines at any cycle.
- Orchestrator records accepted amendments in `breakdown_amendments.md` and appends accepted items to `breakdown.md`.
- This keeps branch plans adaptive instead of freezing the initial breakdown.

## Branch context pools

Each branch has its own markdown workspace:
- `branches/<branch>/context/*.md`

Role file access is controlled in config with read/write patterns.
This keeps branches separated and prevents accidental context bleed.
For traceability, each role execution writes an input packet at
`branches/<branch>/packets/<role>_input.md` listing the files it could read.

## Token accounting

Token usage is tracked per role call and aggregated per run:
- `runs/<run_id>/token_usage_summary.json`
- `runs/<run_id>/branches/<branch>/token_events.jsonl`

When provider APIs return usage metadata, those values are used.
If usage metadata is missing (or fallback paths are used), estimated token counts are recorded.

## Budget gates

The workflow can stop automatically if limits are exceeded:
- `max_total_tokens`
- `max_tokens_per_branch`
- `max_total_calls`
- `max_calls_per_branch`

Global budget overflow terminates the run.
Branch budget overflow terminates the affected branch (`fail_budget`).

## Branch fan-out

After `searcher`, strategy routes are parsed and branch contexts are spawned up to `max_branches`.
Extra routes are recorded as pruned routes in run state and report output.

## Browser-agent note

`browser_agent` is treated as a provider path (`external_agent`) rather than a fixed script.
That keeps the architecture agent-compatible while preserving the same markdown contract for artifacts.
