# MathPipeProver Workflow Graphs

These diagrams describe the current repo reality: a smart orchestrator runs the proof, while the browser lane and Python supervisor automate submission, waiting, and recovery.

## Soft-Scaffolding Loop

![Soft-Scaffolding Loop](img/workflow_main.svg)

- Mode A is the primary operating model: the orchestrator chooses the next narrow task, curates context, and decides whether a route should continue.
- Mode B keeps the same philosophy but lets the Python supervisor own the submit, heartbeat, and resume loop until the run finishes or returns `waiting_orchestrator`.
- Branch-local context grows through repeated `breakdown -> prover -> reviewer` cycles until a branch passes, stalls, or is pruned.
- `waiting_orchestrator` is an intentional handoff for judgment, not an error state.

## Governance Policy Modes

![Governance Policy Modes](img/workflow_governance_policy.svg)

Governance policy (`strict`, `semi_strict`, `flexible`) is separate from the repository's operating taxonomy (Mode A / Mode B / Mode C). Policy modes govern scope and assumption tolerance inside the proof loop.

## Budget Gates

Budget checks run at the top of each phase iteration:

- Global: `max_total_tokens`, `max_total_calls`
- Per-branch: `max_tokens_per_branch`, `max_calls_per_branch`

If a branch exceeds its budget, it moves to `fail_budget`. If the run exceeds global budget, all remaining branches stop.

## Role Data Flow

![Role Data Flow](img/workflow_role_dataflow.svg)

- Durable browser project sources hold stable reference material that should survive across many role turns.
- Branch-local markdown files are the live working set for the current route.
- Each role packet loads priority files in full, loads secondary files in a separate section, and lists everything else as manifest-only.
- Soft scaffolding stays sane by narrowing the task and packet on purpose rather than truncating important files.
