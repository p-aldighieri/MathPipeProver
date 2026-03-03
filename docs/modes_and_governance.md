# Modes And Governance

This file captures the mode design you requested: strict, semi-strict, and flexible behavior without forcing rigid JSON contracts.

## Core design

1. Role outputs stay markdown-first.
2. Lightweight tags are optional but recommended for governance.
3. A cheap pass (small model or parser) can extract tags and update ledgers.
4. Scope/assumption checks happen during the loop, not only at the end.
5. A cheap `workflow_router` role can emit mechanical JSON decisions (`{"next":"TAG"}`) to move the workflow.

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

## Mode behavior

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
3. Evaluate against mode limits.
4. Write `scope_decision.md`.
5. Continue or stop branch.

## Workflow glue (router)

The glue between roles is the `workflow_router` role:
1. It reads workflow state and branch context.
2. It receives an allowed tag set (for example: `PROVER`, `CONSOLIDATOR`).
3. It returns exactly one JSON decision (`{"next":"TAG"}`).
4. Orchestrator validates the tag and applies deterministic fallback if invalid.
5. Decisions are logged under `branches/<branch>/router/router_log.md`.

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

`browser_agent` is treated as a provider mode (`external_agent`) rather than a fixed script.
That keeps the architecture agent-compatible while preserving the same markdown contract for artifacts.
