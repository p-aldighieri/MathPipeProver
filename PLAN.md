# MathPipeProver Plan

Status: Draft v0.1 (reviewed March 2, 2026)

Source scaffold reviewed:
- `/Users/p-aldighieri/Library/CloudStorage/OneDrive-Personal/Economia/RA Piotr/scaffolding_plan.txt`

This plan translates your scaffold into a buildable library/harness with clear interfaces, execution checkpoints, and risk controls.

## 1) My understanding of your scaffold

Your design is a multi-role proof pipeline with a central orchestrator:

1. Orchestrator controls step selection, branching, retries, and termination.
2. Goal formalization turns a natural-language claim into a precise target with assumptions and notation.
3. Literature scan proposes known results and candidate techniques.
4. Strategy search proposes several proof routes with expected failure modes.
5. Proof breakdown converts a route into lemmas + dependency graph.
6. Prover/reviewer loop incrementally proves steps and validates them.
7. Scope keeper ensures newly introduced restrictions do not silently change the theorem.
8. Final review + Lean-facing transformation + human-friendly consolidation produce outputs.

Your key concerns are also clear:
- control scope drift,
- avoid infinite prover/reviewer loops,
- support parallel branches,
- keep workflow modular (enable/disable steps),
- allow an agentic orchestrator that can optionally use browser workflows.

## 2) Proposed product shape

Build `MathPipeProver` as a Python package and CLI harness first (core logic + local artifacts), then add optional UI later.

Primary user interface:
- `mpp run --claim <file_or_text> --config config/default.toml`
- `mpp resume --run-id <id>`
- `mpp inspect --run-id <id>`

Primary output artifacts per run:
- structured run log,
- branch tree,
- accepted proof draft(s),
- rejected route diagnostics,
- scope amendment history,
- optional Lean-ready draft,
- final Markdown/LaTeX report.

## 3) Architecture blueprint

## 3.1 Core principles

1. Strong typed contracts between roles (no free-form glue).
2. Branch-first execution model (each strategy is an isolated branch with immutable parent context).
3. Deterministic replay mode for debugging (seed + stored prompts + stored responses).
4. Cost/time budget enforced centrally (tokens, API calls, wall time).
5. Every loop has explicit stop conditions and fallback transitions.

## 3.2 Package layout (initial)

```text
MathPipeProver/
  src/mathpipeprover/
    orchestrator/
      engine.py
      scheduler.py
      termination.py
    roles/
      formalizer.py
      literature.py
      searcher.py
      breakdown.py
      prover.py
      reviewer.py
      scope_keeper.py
      final_reviewer.py
      lean_formalizer.py
      consolidator.py
    contracts/
      schemas.py
      enums.py
    runtime/
      context_store.py
      branch_store.py
      logger.py
      retry.py
      budgets.py
    providers/
      openai_client.py
      anthropic_client.py
      gemini_client.py
      browser_agent_client.py
    prompts/
      *.md
    cli/
      main.py
    eval/
      benchmark_runner.py
      metrics.py
  docs/
    PLAN.md
    ADR-*.md
  tests/
  config/
    default.toml
  pyproject.toml
```

## 3.3 State machine (high level)

1. `INGEST_CLAIM`
2. `FORMALIZE_GOAL`
3. `LITERATURE_SCAN` (optional)
4. `GENERATE_STRATEGIES`
5. `SELECT_BRANCHES`
6. `BREAKDOWN_ROUTE`
7. `PROVER_REVIEW_LOOP`
8. `SCOPE_RECONCILIATION`
9. `FINAL_REVIEW`
10. `LEAN_TRANSLATION` (optional)
11. `CONSOLIDATE_OUTPUT`
12. `DONE` or `NO_PROOF_FOUND`

Each transition records: reason, evidence, token/cost delta, and next action.

## 4) Contracts (must be built early)

Define JSON/Pydantic contracts for each role input/output.

Required models:

1. `GoalSpec`
- `claim_text`
- `formal_claim`
- `assumptions_given`
- `assumptions_inferred` (must be empty unless explicitly permitted)
- `symbol_table`
- `scope_level`

2. `LiteratureNote`
- `candidate_result`
- `relevance_reason`
- `retrieval_source`
- `confidence`

3. `StrategyProposal`
- `route_id`
- `route_name`
- `required_lemmas`
- `failure_modes`
- `preconditions`
- `estimated_complexity`

4. `ProofBreakdown`
- `lemma_nodes`
- `dependency_edges`
- `sketch`

5. `ProofStep`
- `step_id`
- `statement`
- `justification`
- `dependencies`
- `status`

6. `ReviewVerdict`
- `pass_fail`
- `critical_issues`
- `minor_issues`
- `scope_impact`
- `fix_instructions`

7. `ScopeDecision`
- `proposed_restriction`
- `impact_on_original_claim`
- `acceptable`
- `action` (`accept`, `reject`, `amend_claim`, `reroute`)

## 5) Detailed implementation roadmap

## Phase 0: Repo bootstrap (Day 1)

Deliverables:
- Python package skeleton.
- Lint, format, tests, type checks.
- Base config + environment variable loading.
- Run artifact directory convention.

Exit criteria:
- `mpp --help` works.
- `pytest` runs with at least smoke tests.

## Phase 1: Orchestrator + contracts (Days 1-3)

Deliverables:
- Finite state orchestrator engine.
- Run context persistence.
- Branch model + IDs.
- Retry policies and loop limits.

Exit criteria:
- Deterministic dry-run pipeline works with mocked role outputs.

## Phase 2: Formalizer + strategy stack (Days 3-6)

Deliverables:
- Goal formalizer role.
- Optional literature role.
- Strategy searcher role.
- Breakdown role.

Exit criteria:
- For a sample claim, pipeline emits at least 2 branch-ready strategies with structured lemma breakdowns.

## Phase 3: Prover/reviewer loop + scope keeper (Days 6-10)

Deliverables:
- Stepwise prover role.
- Reviewer role with issue taxonomy.
- Scope keeper with explicit policy gates.
- Loop controller with max-iterations and branch abandonment thresholds.

Exit criteria:
- Branch converges or exits with clear reason (`PASS`, `UNRESOLVED`, `SCOPE_REJECTED`, `BUDGET_EXCEEDED`).

## Phase 4: Finalization modules (Days 10-12)

Deliverables:
- Final reviewer role.
- Consolidator to Markdown and LaTeX.
- Optional Lean-friendly output transformer.

Exit criteria:
- End-to-end run generates a human-readable proof report + machine logs.

## Phase 5: Evaluation and hardening (Days 12-15)

Deliverables:
- Benchmark set of theorem prompts (easy -> medium).
- Metrics dashboard (success rate, avg iterations, scope amendments, cost).
- Regression tests for orchestration decisions.

Exit criteria:
- Stable behavior across benchmark set.

## 6) Role-by-role acceptance criteria

1. Formalizer
- No hidden assumptions unless policy allows it.
- Quantifiers explicit.
- Symbol table complete and non-contradictory.

2. Literature
- Each claim has source attribution or marked as heuristic.
- Distinguish known theorem vs analogy.

3. Searcher
- At least 2 distinct routes when possible.
- Failure modes tied to concrete missing preconditions.

4. Breakdown
- Dependency graph acyclic.
- Every lemma mapped to final claim.

5. Prover
- Every step includes dependency references.
- No unsupported leaps.

6. Reviewer
- Verdict machine-readable.
- Must categorize error type (logical gap, unsupported citation, scope drift, notation mismatch).

7. Scope keeper
- Can reject silent restrictions.
- Must log exact delta between original and amended claim.

8. Final reviewer/consolidator
- Produces coherent narrative proof and evidence trail.

## 7) Loop and branch governance (critical)

## 7.1 Loop break policy

Set hard limits (configurable):
- `max_review_cycles_per_lemma`
- `max_branch_tokens`
- `max_branch_walltime`
- `max_total_failed_fixes`

Terminate branch when any limit is exceeded and mark reason.

## 7.2 Branch selection policy

Score branches by:
- reviewer pass progression,
- unresolved critical issues,
- scope amendment severity,
- cost efficiency.

Scheduler rule:
- maintain top-K active branches,
- prune dominated branches,
- optionally revive a parked branch if all active branches stall.

## 8) Config design (`config/default.toml`)

Minimum keys:
- provider/model per role,
- temperature/top_p per role,
- token budgets,
- enabled roles,
- scope strictness,
- retry policy,
- branching factor,
- logging verbosity,
- artifact output paths.

## 9) Testing plan

1. Unit tests
- contracts validation,
- transition guards,
- scope decision logic,
- termination conditions.

2. Integration tests
- mocked provider end-to-end run,
- multi-branch pruning behavior,
- resume from persisted state.

3. Golden tests
- expected artifacts for fixed seed prompts.

4. Stress tests
- forced reviewer failures,
- budget exhaustion,
- malformed model outputs.

## 10) Observability and debugging

Must log per step:
- run_id, branch_id, role, prompt_hash, response_hash,
- token in/out, latency, cost estimate,
- transition decision + rationale.

Provide CLI diagnostics:
- `mpp inspect --run-id ... --tree`
- `mpp inspect --run-id ... --scope-deltas`
- `mpp inspect --run-id ... --failures`

## 11) Suggested changes to your current scaffold

1. Merge duplicate "I" labels.
- Current scaffold uses `I` twice (Final reviewer and Lean formalizer). Rename to avoid ambiguity.

2. Move scope governance earlier and make it continuous.
- Scope checks should run not only after prover/reviewer loops; they should run after formalization, strategy generation, and each reviewer verdict.

3. Separate "facts" from "generated reasoning".
- Add a `Knowledge Ledger` that marks each statement as: user-provided, literature-backed, derived, or conjectural.

4. Treat literature search as evidence retrieval, not proof authority.
- Literature should influence strategy ranking but never auto-validate a proof step.

5. Use structured outputs only where orchestration-critical.
- Router emits strict structured decisions (`{\"next\":\"TAG\"}`); proof roles remain markdown-first.

6. Add "Assumption Delta" as a first-class artifact.
- Every branch must track how assumptions changed from original claim.

7. Define explicit status taxonomy.
- Recommended statuses: `PASS`, `FAIL_LOGIC`, `FAIL_SCOPE`, `FAIL_BUDGET`, `STALL`, `ABANDONED`, `NEEDS_USER_DECISION`.

8. Add deterministic mode from day one.
- You will need replayability to debug orchestration logic.

9. Keep Lean step optional and late.
- Do not couple Lean formalization to proving loop at first; it can block early progress.

10. Add benchmark corpus before optimization.
- Early metric discipline will prevent tuning blindly around anecdotal examples.

## 12) Immediate next implementation tasks

1. Initialize package with `pyproject.toml`, `src/`, `tests/`, `config/`.
2. Implement contracts in `contracts/schemas.py`.
3. Build orchestration state machine with mocked roles.
4. Add artifact persistence (`runs/<run_id>/...`).
5. Add one end-to-end smoke benchmark.

## 13) Open decisions to resolve soon

1. Proof granularity: statement-level vs lemma-level iteration defaults.
2. When user confirmation is required for scope amendments.
3. Which provider(s) are mandatory in v0.
4. How browser-agent mode is sandboxed and audited.
5. Whether to support external theorem prover integration in v0 or v1.


## 14) Implementation update (March 2, 2026)

The current v0 implementation now follows a markdown-first approach:

1. Replaced strict everywhere-JSON expectation with optional lightweight tags in markdown.
2. Added mode policies (`strict`, `semi_strict`, `flexible`) as first-class config.
3. Added role-level file access controls in `config/default.toml`.
4. Added branch-local context pools under `branches/<branch>/context`.
5. Added assumption delta + scope decision artifacts per branch.
6. Added breakdown amendment path (`[BREAKDOWN_AMEND]`) so prover can modify branch plan mid-run.
7. Added resumable run state and CLI inspect command.
8. Added a cheap-model workflow router (`workflow_router`) that emits structured decisions (`{\"next\":\"TAG\"}`) with deterministic fallback.
9. Added provider adapters for OpenAI, Anthropic, and Gemini plus `smoke-providers` CLI diagnostics.
10. Added prompt templates under `prompts/` to externalize role instructions.
11. Added token accounting per role call with run-level summary artifacts.
12. Added multi-branch strategy fan-out with pruning to configured `max_branches`.
13. Added global/per-branch budget gates for tokens and calls.
14. Added `mpp report` command with branch outcomes and role usage summary.
15. Added production profile config and external-agent request/response workflow.

This keeps the workflow fast and flexible while preserving minimal governance where it matters.
