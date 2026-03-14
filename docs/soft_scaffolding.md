# Soft Scaffolding Guide

This document captures the browser-orchestrated proof workflow that sits between:

- the fully automated MathPipeProver pipeline
- and pure manual proof work in ChatGPT

The point of this mode is not to make the orchestrator passive. In soft scaffolding mode, Codex acts as an active proof operator:

- choosing the next role
- narrowing scope
- curating context
- refreshing durable sources
- deciding when a route is alive, blocked, or needs repair

The orchestrator must not "play dumb" in browser mode.
It should not merely relay role outputs or mechanically follow pipeline tags when the mathematical state says otherwise.
It is expected to synthesize evidence across steps, notice when a branch is effectively dead or conditionally settled, narrow the next move, and choose the next theorem-producing route with judgment.

## What Belongs In MathPipeProver

MathPipeProver should contain the reusable infrastructure for browser-backed orchestration:

- ChatGPT browser automation
- source refresh helpers
- polling and recovery utilities
- prompt templates for roles
- operational rules for the orchestrator

MathPipeProver should not be the long-term home for proof-specific state for one theorem project.

Project-specific items should stay in the target proof repo:

- proof-state notes
- route memos
- packets
- logs
- recovered browser answers
- theorem-specific context management files

## Role Of The Orchestrator In Soft Scaffolding

In API mode, the orchestrator can be relatively mechanical.
In browser soft-scaffolding mode, the orchestrator has to do more:

1. inspect the current proof status, not just pipeline status
2. decide whether a result is trustworthy, tainted, partial, or blocked
3. keep the route narrow enough that ChatGPT is not asked to do too much at once
4. choose which context is durable and which is temporary
5. interpret reviewer outputs as local proof diagnostics, not as automatic branch-death commands
6. recover from browser/UI failures without losing mathematical state

This means the orchestrator is part workflow engine and part proof manager.
In practice, good soft scaffolding looks like a strong human research assistant:

- read the proof state before launching the next role
- reinterpret reviewer output as local mathematical diagnostics
- override stale or low-signal pipeline momentum when the proof frontier has changed
- prefer one sharp lemma over one more generic "try proving the theorem" pass

## Durable Sources vs Temporary Attachments

Use the ChatGPT project `Sources` tab only for durable context that should persist across chats.

Typical durable sources:

- objective statement
- paper PDF
- durable proof-state file
- current stable route memo

Use composer attachments only for step-specific working files.

Typical temporary attachments:

- one scoped packet
- one fresh breakdown result
- one scoped prover draft
- one local obstruction note that matters only for the current step

Rules:

- do not duplicate durable files as temporary attachments unless the browser UI forces a recovery workaround
- refresh durable project sources explicitly when the local file changes
- remove stale branch-specific durable sources before adding the new branch memo

## Model And Effort Policy

For the Robust Trust browser workflow, the live policy is:

- base model: `ChatGPT 5.4 Pro`
- effort mode: `Extended Pro`

Operationally:

- the top model picker and the composer effort pill are separate controls
- the effort pill beside `+` must be checked before important prompts
- do not assume the browser preserved the intended setting

## Context Policy

The browser workflow is much more sensitive to context bloat than the local pipeline.

Core rules:

- never truncate proof artifacts
- if the packet is too large, narrow the role instead of clipping files
- prefer lemma-scoped prover prompts
- prefer delta-scoped reviewer prompts
- keep route-comparison/planning separate from proving

Recommended pattern:

1. durable `proof_state.md`
2. one stable route memo
3. one scoped packet
4. only the minimal temporary files needed for that step

## Prompting Differences From The API Pipeline

The browser workflow needs slightly different prompts from the API path.

Useful adjustments:

- make the role scope explicit at the top
- explicitly list excluded context
- explicitly tell the model not to re-prove settled results
- explicitly tell the model when a prior route has already been refuted
- require a short next-step signal at the end

The reviewer prompt should stay local.
It should evaluate the current proof block, not decide global route termination.

## Polling And Recovery Policy

Browser execution is not reliable enough to trust a single monitoring mechanism.

Preferred approach:

1. submit through the browser runner
2. keep an independent direct inspect loop on the live chat URL
3. recover the response from the chat explicitly before accepting completion
4. treat wrapper-text recovery as a failed capture, not as a proof result

If a long ChatGPT run stops with no usable reply:

- preserve the failed chat URL in the logs
- do not overwrite a clean response target with wrapper text
- resubmit in a fresh chat if the recovered content is not mathematical output

## Recommended Storage Split

There are two storage layers:

1. generic engine runs
2. proof-project artifacts

Recommended long-term policy:

- MathPipeProver `runs/` should hold engine-level run state only, or move to a non-repo path through `run_root`
- theorem-specific logs, packets, notes, and context management should live in the proof repo

For browser-driven theorem work, the proof repo should be considered the source of truth for:

- what was proved
- what failed
- what the next step is

## Current Lessons From Robust Trust

1. Truncation breaks reviewer validity.
2. Route repair matters more than raw prover volume.
3. The orchestrator must actively curate scope.
4. Durable proof-state files are essential.
5. Browser recovery needs both automation and human-grade judgment.

## Recommended Next Engineering Follow-Ups

1. Add a dedicated non-repo `run_root` option for browser workflows by default.
2. Separate engine run state from proof-project artifacts more cleanly.
3. Add a first-class `soft_scaffolding` docs section in the main README.
4. Add a lightweight checklist for project source refresh before each role.
