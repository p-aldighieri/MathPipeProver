# Soft Scaffolding Guide

This is the primary operating mode of MathPipeProver: smart soft scaffolding under a Claude Code or Codex orchestrator.

> **Bootstrapping a session:** copy `INIT.md` from the repo root into a fresh orchestrator session and fill in the slugs. This document is the operating guide the orchestrator should be familiar with after that bootstrap, not the bootstrap itself.

This document captures the browser-orchestrated proof workflow that sits between:

- the fully automated MathPipeProver pipeline
- and pure manual proof work in ChatGPT

In this repository, "soft" does not mean passive. The soft part is the scaffolding around external proof roles; the orchestrator itself is expected to stay smart, active, and mathematically engaged.

The point of this mode is not to make the orchestrator passive. In soft scaffolding mode, Codex acts as an active proof operator:

- choosing the next role
- narrowing scope
- curating context
- refreshing durable sources
- deciding when a route is alive, blocked, or needs repair

In the repository's soft prompt lane, this is literal control flow, not just philosophy: after every completed role, the run returns to `waiting_orchestrator`, and the smart orchestrator decides what to do next.

The orchestrator must not "play dumb" in browser mode.
It should not merely relay role outputs or mechanically follow pipeline tags when the mathematical state says otherwise.
It is expected to synthesize evidence across steps, notice when a branch is effectively dead or conditionally settled, narrow the next move, and choose the next theorem-producing route with judgment.

## How The Operating Modes Relate

- **Smart scaffolding** is this guide's subject: a long-running smart orchestrator owns the proof loop directly, choosing roles and managing browser state by hand.
- **API pipeline** is the more mechanical fully-automated variant. It stays supported and is documented in `README.md` and `CLAUDE.md`, but it is not the primary identity of the repository.

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

In the API-only mode, the orchestrator can be relatively mechanical.
In the primary browser-backed soft-scaffolding mode, the orchestrator has to do more:

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
- actively inspect and repair browser state when model/effort/source/chat state drifts
- keep stop authority at the orchestrator layer, not in automatic Python failure tags
- treat reviewer `recommended_next_phase` as informed advice, not as an automatic command

In soft mode, non-proof terminal conditions such as `FAIL_SCOPE`, `STALL`, or budget pressure should hand control back to the orchestrator for judgment. The run should not silently end just because the local pipeline hit one of those tags.

## Subagent Boundary

The browser-backed analytical proof loop is an Extended Pro workflow. Formalizer, literature, searcher, breakdown, prover, reviewer, consolidator, and gatekeeper work should be submitted through ChatGPT Extended Pro with the project sources and scoped attachments curated by the orchestrator.

Do not replace those roles with Claude/Codex/Opus subagents. Subagents are reserved for:

- a specifically requested coding or simulation task, where the deliverable is code, a computational experiment, or a simulation result
- Lean formalization work, where the deliverable is Lean/Mathlib/AXLE proof engineering rather than a natural-language analytical proof

When a task is an English mathematical argument, a proof repair, a reviewer audit, a route search, or a formal analytical derivation, use Extended Pro.

## Gatekeeper

The gatekeeper runs automatically after every consolidator pass. It is a SCOPE check, not a logic audit, and its job is to compare the original objective against the achieved result and — when the result is real but the question got narrower along the way — propose route-level strategies for re-attacking the original objective.

What the gatekeeper does:

- compares the original objective and the consolidator's achieved result side by side, in plain language
- classifies every added or changed assumption as `trivial regularity`, `meaningful narrowing`, or `scope-changing`
- if the verdict is `OBJECTIVE_NARROWED` or `OBJECTIVE_MISSED`, proposes strategic re-attacks (one per `meaningful narrowing` is a baseline, no fixed count; at least one strategy should question the formalization itself)
- emits a sources-hygiene note flagging clutter, stale route memos, or duplicates in durable sources
- emits a `gatekeeper_control` block carrying the verdict and the sources status

The gatekeeper does NOT pick the next pipeline step. It is not aware of pipeline phase tags and should not be asked to choose between them. Its output is the raw material — verdict, scope delta, strategies — and the smart orchestrator reads that and decides the routing itself.

The gatekeeper exists for two reasons:

1. to catch the case where the pipeline produced a real theorem but answered a strictly weaker question than the one originally asked
2. to break out of local minima by proposing route-level alternatives that the prover/reviewer/breakdown loop could not see from inside the route it had committed to

Verdicts:

- `OBJECTIVE_MET` — the result answers the original question with no meaningful loss of scope
- `OBJECTIVE_MET_WITH_TRIVIAL_REGULARITY` — added hypotheses are technical/cosmetic and preserve intent
- `OBJECTIVE_NARROWED` — the result is real but answers a strictly weaker question; strategic re-attack required
- `OBJECTIVE_MISSED` — the result does not answer the original question; strategic re-attack required and the formalization itself may need re-reading

After the gatekeeper, the smart orchestrator reads the verdict + scope delta + strategies and decides the next move. When the result falls short of the original objective (`OBJECTIVE_NARROWED`/`OBJECTIVE_MISSED`), the default is to **re-attack, not to stop** — see *Attempts and the Default Re-Attack Loop* below. Typical follow-ups, in rough order of preference: re-rank routes via the searcher with the attempt dossier in hand; decompose a proposed strategy into lemmas via breakdown; check prior art via the literature role; re-read the formalization via the formalizer if the original question itself was misframed; run one more prover-reviewer cycle only if the residual gap is genuinely small. Stopping to record/publish is appropriate only when the objective is met, disproved, or genuinely distinct strategies are exhausted. The gatekeeper does not loop back automatically.

## Attempts and the Default Re-Attack Loop

An **attempt** is one full push of the pipeline — `searcher → breakdown → prover → reviewer → consolidator → gatekeeper` — together with the route-branches that push fans out into. This is a larger unit than an engine route-*branch*: one attempt usually contains several branches, one per candidate route.

The failure mode this guards against is the orchestrator quietly calling it a day after a single attempt comes up short. That moment — many paths tried, nothing closed, energy low — is exactly when the pipeline should keep going, not stop.

**Default behavior when an attempt ends short of the objective** — whether the gatekeeper returns `OBJECTIVE_NARROWED`/`OBJECTIVE_MISSED`, or every route stalled, exhausted its budget, or hit diminishing returns:

1. **Document the attempt.** Commit the proof repo at the checkpoint and write (or append to) an **attempt dossier**: the routes tried, what closed vs. what stalled, the central obstruction each route hit, which routes are now refuted, and the gatekeeper's strategic re-attack proposals. This is the durable lessons-learned record. Preserve it; never overwrite a prior attempt's dossier — append a new section.
2. **Re-attack from the searcher.** Loop back to the searcher and pass the dossier as an *explicit* input (same handling as `literature.md` — a file the searcher must read, not merely have available in the background). The searcher proposes a fresh route set that avoids the refuted routes and targets the recorded obstruction.

**What carries across a re-attack (the invariants):**

- the **original objective / claim** — fixed. We re-attack the *same* target, never a narrowed one; a moving objective would defeat the gatekeeper's reason for existing.
- the **paper / source statement** and the **durable proof-state** (banked results stay banked).
- the **formalizer and literature findings**, unless the gatekeeper specifically flags the formalization for re-reading.

**What changes:** the dossier is added/refreshed (kept in durable sources, or attached to the searcher pass), and the spent attempt's route memo is removed per *Durable Source Housekeeping*. Durable sources must not accumulate dead-branch route memos across attempts.

**When to loop all the way back to the formalizer.** `OBJECTIVE_MISSED` often means the formalization itself, not just the proof technique, was off. In that case it is legitimate to restart the attempt at the formalizer — re-reading the source statement with the dossier in hand — rather than only re-opening strategy. Going back to the first step is a valid move, not a failure.

**When to actually stop.** Stopping is the exception, and the reason goes in the run record: the objective is met (`OBJECTIVE_MET` / `OBJECTIVE_MET_WITH_TRIVIAL_REGULARITY`), the claim is disproved, genuinely distinct strategies are exhausted, or a human calls it. "We tried a lot of paths" and "diminishing returns" are triggers to re-attack, not reasons to stop.

In the API pipeline this same loop is automated and bounded by the `max_attempt_rounds` workflow config key (default `1` = no re-attack, i.e. today's behavior); see `config/default.toml`.

## Durable Sources vs Temporary Attachments

Use the ChatGPT project `Sources` tab only for durable context that should persist across chats.

Typical durable sources:

- objective statement
- paper PDF
- durable proof-state file
- current stable route memo
- stable literature memo when a search pass has already identified prior art or likely status

Use composer attachments only for step-specific working files.

Typical temporary attachments:

- one scoped packet
- one fresh breakdown result
- one scoped prover draft
- one local obstruction note that matters only for the current step
- the current `literature.md` note when the next role must reason directly from it, especially `searcher`

Rules:

- do not duplicate durable files as temporary attachments unless the browser UI forces a recovery workaround
- refresh durable project sources explicitly when the local file changes
- remove stale branch-specific durable sources before adding the new branch memo
- if `literature.md` exists and the next step is `searcher`, pass it explicitly as part of the branch context; do not leave it as background knowledge only

## Model And Effort Policy

For the browser workflow, the live policy is the Extended Pro target:

- reasoning `Pro`
- model `5.5`

Operationally:

- the UI may expose these as one composer pill or as separate model/effort controls
- the composer pill beside `+` must be checked before important prompts
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

## Source File Strategy

There are two distinct layers of context in the browser workflow. Mixing them leads to bloated project sources and missing per-step context.

### Layer 1: Durable Project Sources (background state)

These live in the ChatGPT project `Sources` tab and persist across all chats. They provide background state that every role might need.

Typical durable sources:

- paper PDF
- alternative proof / theorem sketch PDF
- objective statement
- proof-state file (updated after each accepted result)
- current stable route memo (if one exists)
- stable literature memo when the search pass produced reusable source triage or a claim-status assessment

Rules:

- keep this set small (4-6 files max)
- refresh explicitly when the local file changes (remove old version, re-upload new)
- never add per-step artifacts here (packets, logs, prover drafts)
- remove stale route memos before adding the new one
- if a literature pass produced a durable summary, prefer keeping that summary here instead of scattering the same findings across ad hoc attachments

### Layer 2: Temporary Composer Attachments (per-step context)

These are attached via the `+` button in the composer for a single chat. They provide the specific working context for the current role.

Typical temporary attachments:

- the role packet itself (if not pasted inline)
- the prior role's response that this step builds on (e.g., formalizer response for a prover pass)
- a specific gap register or obstruction note
- a scoped breakdown or route memo relevant only to the current step

Rules:

- attach files that the model needs to READ, not just reference
- do not duplicate durable sources as attachments
- prefer attaching 1-3 focused files over pasting long content inline
- if a prior response is critical input (e.g., formalizer gap register feeds the prover), attach it as a file rather than summarizing it in the prompt
- if `searcher` is running after a literature pass, make sure `literature.md` is explicitly present in the local packet or attachment set so route ranking can cite it directly

### What NOT to put in either layer

- full conversation logs (too large, redundant with the chat itself)
- multiple prior prover drafts (pick the latest trustworthy one)
- files from unrelated branches or projects

## Prompt Scoping Policy

Extended Pro thinking time scales with prompt complexity. A prompt that asks for 6 CRITICAL gaps to be filled at once will produce a 30+ minute thinking phase and may lose coherence across sections.

### Preferred scope per submission

- **1-2 focused proof tasks** per prover submission
- **1 lemma block** per reviewer submission
- **1 route** per breakdown submission

### When broader scope is acceptable

- formalizer passes (reading + cataloguing is naturally broad)
- consolidator passes (synthesis of already-verified blocks)
- final glue steps when all local lemmas are banked

### When to split

Split the submission if:

- the task involves both a derivation AND its verification (split into prover → reviewer)
- multiple gaps are logically independent (submit in parallel or sequence)
- the total prompt + context exceeds ~4000 words (narrow the scope, attach files instead)

### Anti-patterns

- "prove Blocks C through F in one pass" — too broad, thinking phase explodes
- pasting a full prior response as inline text instead of attaching it as a file — wastes prompt space
- asking the model to both derive AND translate to a different framework in one step

## Prompting Differences From The API Pipeline

The browser workflow needs slightly different prompts from the API path precisely because the smart orchestrator is expected to be more selective and more context-aware.

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

## Autonomous Browser Repair

In soft scaffolding mode, the orchestrator should not stop at the first browser inconsistency.

If something looks off, it should actively check and repair the state with the available tools:

- re-open the project page and verify the correct project URL
- re-check the Extended Pro target (current UI: reasoning `Pro` + model `5.5`)
- open the `Sources` tab and confirm the requested durable files are actually present
- if source sync looks incomplete, retry one file at a time and verify the post-sync list
- inspect a live chat URL before deciding a worker is dead
- recover from an existing chat when the answer is present but harvesting failed

Only ask for human help after:

- the browser state has been re-checked
- source sync has been retried and still cannot be confirmed
- or authentication / infrastructure truly blocks progress

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
6. Asking for too many gaps to be filled in one prover pass produces long thinking times and risks incoherent output. Scope to 1-2 focused tasks per submission.
7. Prior role responses (e.g., formalizer gap register) should be attached as temporary files for the next role, not embedded inline in the prompt text. The model reads attached files more reliably than long inline content.
8. Durable project sources are for background state; per-step working files go as composer attachments. Never mix the two layers.

## Recommended Next Engineering Follow-Ups

1. Add a dedicated non-repo `run_root` option for browser workflows by default.
2. Separate engine run state from proof-project artifacts more cleanly.
3. Keep the main README centered on smart soft scaffolding as the primary operating model.
4. Add a lightweight checklist for project source refresh before each role.
