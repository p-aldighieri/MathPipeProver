# MathPipeProver Workflow Graph

## Main Pipeline

![Main Pipeline](img/workflow_main.png)

<details><summary>Mermaid source</summary>

```mermaid
flowchart TD
    START([Claim Input]) --> F

    subgraph PRELUDE["Prelude — single branch"]
        F[Formalizer]
        L[Literature Search]
        S[Searcher / Route Planner]
        F -->|router| L
        L -->|router| S
        F -.->|lit disabled| S
    end

    S --> SPAWN{Spawn Strategy Branches}
    SPAWN -->|"route 1 (main)"| B1[Breakdown]
    SPAWN -->|"route 2"| B2[Breakdown]
    SPAWN -->|"route N"| BN[Breakdown]
    SPAWN -.->|pruned routes| PRUNE([Pruned])

    subgraph BRANCH["Branch Loop — per route"]
        direction TB
        BD[Breakdown] --> P[Prover]
        P -->|router| R[Reviewer]
        R --> SCOPE{Scope Gate}
        SCOPE -->|rejected| FAIL_SCOPE([Scope Fail])
        SCOPE -->|ok| VERDICT{Verdict?}

        VERDICT -->|PASS| C[Consolidator]
        VERDICT -->|PATCH_SMALL| P
        VERDICT -->|PATCH_BIG| BD
        VERDICT -->|REDO| REDO_R{Router}
        REDO_R -->|STOP_STALL| STALL([Stalled])
        REDO_R -->|PROVER| P

        P -->|max cycles| STALL

        C --> DONE([Branch Pass])
    end

    B1 --> BRANCH
    B2 --> BRANCH
    BN --> BRANCH

    subgraph FINISH["Run Completion"]
        WINNER{Any branch passed?}
        WINNER -->|yes| SELECT[Select Winner by Score]
        WINNER -->|no| RUN_FAIL([Run Failed])
        SELECT --> COMPLETE([Run Complete])
    end

    DONE --> WINNER
    STALL --> WINNER
    FAIL_SCOPE --> WINNER
```

</details>

## Mode / Policy Enforcement

![Mode Policy Enforcement](img/workflow_modes.png)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    subgraph STRICT["strict"]
        S1[No scope changes]
        S2[No new assumptions]
        S3[Scope gate required]
    end

    subgraph SEMI["semi_strict"]
        SS1["Fidelity-focused prompts"]
        SS2["Backstop: ≤5 each"]
        SS3[Scope gate active]
    end

    subgraph FLEX["flexible"]
        F1["Relevance-focused prompts"]
        F2["No effective limits"]
        F3["Scope gate bypassed"]
    end
```

</details>

Scope enforcement is two-layered:
1. **Prompt injection** — each role receives a scope-policy paragraph matching its mode and category (generative, evaluative, planning, consolidator). Models self-enforce.
2. **Mechanical backstop** — `_scope_decision()` counts `[SCOPE]`/`[ASSUMPTION+]` tags after each reviewer cycle and blocks the branch if limits are exceeded. In flexible mode (`require_scope_gate=False`) the gate always passes but still writes delta files for observability.

## Budget Gates

Budget checks run at the top of every phase iteration:
- **Global**: `max_total_tokens`, `max_total_calls`
- **Per-branch**: `max_tokens_per_branch`, `max_calls_per_branch`

If exceeded → branch gets `fail_budget` status. If global budget exceeded → all branches terminated.

## Role Data Flow

![Role Data Flow](img/workflow_dataflow.png)

<details><summary>Mermaid source</summary>

```mermaid
flowchart LR
    subgraph CONTEXT["Context Priority per Role"]
        direction TB
        PR_FULL["Prover sees FULL:\n- formalizer.md\n- breakdown.md\n- amendments"]
        PR_SUM["Prover sees SUMMARY:\n- strategy.md\n- reviewer_*.md"]

        RV_FULL["Reviewer sees FULL:\n- formalizer.md\n- breakdown.md\n- prover_*.md"]
        RV_SUM["Reviewer sees SUMMARY:\n- strategy.md\n- assumption_delta.md"]

        CO_FULL["Consolidator sees FULL:\n- formalizer.md\n- prover_*.md\n- reviewer_*.md"]
    end
```

</details>

All other files appear as **manifest only** (filename + character count).
