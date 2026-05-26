# Lean Formalization (Post-Processing Module) — Operating Guide

This is the **operating guide** for the Lean post-processing module — implementation details for AXLE, INVENTORY.lean conventions, state file format, sub-agent backends, and failure-mode recovery.

> **Read first**: `docs/lean_pipeline.md` — the conceptual pipeline guide. It describes the workflow shape (phases, per-lemma parallel branches, smuggling-deferral rules, asymmetric gold check, orchestrator routing). This file (`lean_formalization.md`) covers the lower-level implementation pieces.

> **Where this fits.** The proof loop (formalizer → … → consolidator) is the headline workflow; see `docs/soft_scaffolding.md` for that. This guide covers the *next* step: taking a finished `final_report.md` and producing a Lean file that compiles against Mathlib, with a per-paper INVENTORY.lean for results outside Mathlib.

> **Subagent boundary.** The sub-agent language in this file is Lean-only. It applies to Lean/Mathlib/AXLE proof engineering after the English proof has been consolidated. It must not be generalized to the upstream analytical proof pipeline, where formalizer/searcher/breakdown/prover/reviewer/consolidator/gatekeeper roles go through ChatGPT Extended Pro.

The headline pipeline shape has been updated (PIOTR v9 session, 2026-05-23):
- Per-lemma cycle now includes a brainstorm step (8c) before prove (87/88).
- Smuggling check (8b) deferred to AFTER prove+review+compile; not interleaved with proving.
- Per-theorem deep audit (8d) bundles translation + scope + smuggling.
- Final check expanded: global smuggling + per-theorem batched + gold check (8f) + paper feedback (8e) + final lake build.
- Dep audit (82) requires verbatim paper-source citations; reviewed by 83.

See `docs/lean_pipeline.md` for the full conceptual flow.

## When to Use This Module

Use it when:

- A proof has reached `final_report.md` and the orchestrator is satisfied with the English version.
- You want a machine-checked artifact for archival, sharing, or formal verification.
- The proof's external results either are (mostly) in Mathlib, or you're willing to maintain a per-paper INVENTORY.lean of stubs.

**Skip it when:**

- The proof is still in flight upstream.
- The proof relies heavily on results that no current Lean library has and that you don't want to stub.
- The mathematics is straightforward and the value of formalization doesn't justify the wall-clock cost (figure 5–20 hours of ChatGPT Extended Pro time + a few hundred AXLE calls for a typical paper-scale theorem).

## What AXLE Is and Is Not

AXLE (`https://axle.axiommath.ai`) is the compile-and-transform backend this module uses. It is **not** an autoformalizer and **not** a proof search engine.

- AXLE compiles Lean source against a pinned Mathlib (`mpp axle check`).
- AXLE verifies a Lean source matches a target signature with allowed sorries (`mpp axle verify-proof`).
- AXLE refactors `sorry` sites into top-level lemmas (`mpp axle sorry2lemma`).
- AXLE runs bounded repair strategies at sorry sites — default `grind`, no search (`mpp axle repair-proofs`).
- AXLE dedups and topo-orders multiple Lean strings (`mpp axle merge`).
- AXLE does Plausible-backed counterexample search (`mpp axle disprove`).

AXLE does **not** generate Lean from English, does **not** search for proofs, and does **not** accept multi-file Lean uploads. The intelligence (formalize, prove, audit) lives in Extended Pro role submissions; AXLE is the compile/refactor backend.

See `CLAUDE.md §Lean formalization (in development)` for the API-key setup and the URL split (POST tools at `/api/v1/`, GET environments at `/v1/`).

## Workflow at a Glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-formalize-init        bootstrap {PROOF_REPO}/lean/ from a branch  │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-structure             Extended Pro: 80 lean_structurer            │
│                              ↳ then 81 lean_structurer_reviewer (loop)   │
│                              produces decomposition.md (lemma DAG +      │
│                              object/structure definitions)               │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-dep-audit             Extended Pro: 82 lean_dep_audit             │
│                              ↳ 83 lean_dep_audit_reviewer (loop)         │
│                              produces dep_audit_proposed.md              │
│                              (Mathlib candidate table, ranked,           │
│                              EACH WITH PAPER-SOURCE CITATION + verbatim  │
│                              source statement)                           │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-verify-deps           CODEX 5.5 thread (or Opus 4.7 fallback):    │
│                              iterate `mpp axle check` against each       │
│                              candidate. Bucket: confirmed / wrong /      │
│                              not_in_mathlib. Output: dep_audit.md.       │
│                              (THEN: submit 83 lean_dep_audit_reviewer    │
│                              via /submit-role for sign-off.)             │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-formalize             Extended Pro: 84 lean_formalizer            │
│                              ↳ 85 lean_formalizer_reviewer               │
│                              ↳ 86 lean_meaning_check                     │
│                              ↳ AXLE verify_proof (skeleton, permitted=*) │
│                              produces main.lean with sorry bodies        │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-prove-lemma <slug>    Per-lemma cycle (PIOTR v9 architecture):    │
│                              ↳ 8c lean_design_brainstorm (early)         │
│                              ↳ 87 lean_prover (one lemma)                │
│                              ↳ 88 lean_prover_reviewer                   │
│                              ↳ AXLE check + disprove sanity              │
│                              ↳ 8d per-theorem audit (translation +       │
│                                  scope + smuggling, bundled)             │
│                              loop until proved + verified or escalated;  │
│                              writes lemmas/<slug>.lean                   │
│                              Multiple lemmas can be in flight in         │
│                              parallel (brainstorm + review + verify      │
│                              parallel-safe; prove step sequential).      │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-merge                 AXLE merge: fan in lemmas/*.lean +          │
│                              INVENTORY.lean → main.lean (dedup, topo-    │
│                              order, prefer-sorry-free)                   │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  /lean-final-check           Gate. Runs IN ORDER:                        │
│                              1. AXLE verify_proof (full file)            │
│                              2. Per-lemma disprove sweep                 │
│                              3. Global smuggling (8b)                    │
│                              4. Per-theorem deep audit (8d batched)      │
│                              5. Gold check (8f) — Lean ↔ English         │
│                              6. Paper feedback (8e) if flags             │
│                              7. Final meaning_check (86)                 │
│                              8. lake build (authoritative compile)       │
│                              → FORMALIZATION_REPORT.md + PAPER_FEEDBACK  │
└──────────────────────────────────────────────────────────────────────────┘
```

`/lean-status` is read-only and safe to invoke at any point.

## The State File

`{PROOF_REPO}/lean/lean_state.md` is the durable handoff between sessions. Any new orchestrator session reads it to reconstruct where formalization stands. It has four sections:

- **Meta** — proof repo, branch, source run, phase, target toolchain.
- **Artifacts** — pointer table to the files that exist at each step.
- **Lemma Status** — one row per lemma, with declared / proved / reviewed / merged checkmarks.
- **Recent History** — chronological log of skill invocations, with timestamps and notes.

Phase values, in order:

1. `init` — directory bootstrapped, no decomposition yet.
2. `structuring` — structurer ↔ reviewer loop running.
3. `deps_proposing` — dep_audit role submitted, waiting on or processing response.
4. `deps_verifying` — verification sub-agent (Codex/Opus) iterating against AXLE.
5. `deps_done` — verified table accepted by reviewer.
6. `formalizing` — formalizer role + reviewer + meaning_check + AXLE skeleton verify.
7. `proving_lemmas` — closing sorrys, one lemma at a time.
8. `merging` — fan-in via AXLE merge.
9. `final_check` — running `/lean-final-check`.
10. `done` — `FORMALIZATION_REPORT.md` produced and committed.

Skills check the phase before acting. They will refuse to run out of order — fix the state file rather than forcing it.

## INVENTORY.lean — The Persistent Stub File

The single most important architectural choice this module makes: **AXLE cannot import non-Mathlib libraries**, so every result you need outside Mathlib must be inlined into the submitted source. We do this via `{PROOF_REPO}/lean/support/INVENTORY.lean` — a project-local file that accretes stubs (and, over time, proved statements) for those results.

**What goes in it:**

- Domain-specific results that aren't in Mathlib (e.g., specialist economics theorems like Berge's max theorem variants, Blackwell sufficiency, Bayesian incentive compatibility lemmas).
- Lemmas whose Mathlib analog exists but with a subtly different statement that doesn't fit the proof.
- Results that *should* be in Mathlib but at the pinned toolchain version aren't.

**Lifecycle:**

1. `/lean-dep-audit` flags candidates as `not_in_mathlib` → these become stub additions.
2. `/lean-formalize` appends `theorem <slug> : <type> := sorry` for each new entry to `INVENTORY.lean`.
3. The orchestrator may, over multiple papers, prove some of these stubs (using `/lean-prove-lemma` on the INVENTORY entry instead of a paper-specific lemma). Proved entries stay in `INVENTORY.lean` and become available to future projects.
4. In `/lean-final-check`, INVENTORY entries are passed as `permitted_sorries` to `mpp axle verify-proof`. The user must explicitly mark each as `permanent_stub=✓` in `lean_state.md` to acknowledge the dependency.

**Cross-project sharing.** The default is per-paper INVENTORY.lean. Once an INVENTORY accretes enough proved results that you want to reuse across papers, copy it to `~/.mathpipeprover/lean/INVENTORY-shared.lean` and prepend it to per-paper stubs. (This is not automated today; do it by hand when the time comes.)

## Sub-Agent Backend (`/lean-verify-deps`)

The dep-audit verification step iterates dozens to hundreds of AXLE checks. Doing this through Extended Pro round-trips is absurd: each ChatGPT submission costs 30–90 min wall-clock, but each AXLE check returns in <500 ms. So this step delegates to a local sub-agent with tool access.

This is a narrow Lean-formalization exception. Do not use this section as precedent for assigning natural-language analytical proof roles to subagents.

**Default backend: Codex CLI 5.5 with a persistent thread.**
```bash
codex --model gpt-5.5 --effort extra-high \
      --thread "lean-verify-deps-{BRANCH}" \
      --tool bash --tool web
```
The thread id is stable across re-invocations, so resuming a partial verification just rejoins. Codex 5.5 is strong at iterative tool-use and has the persistent-thread primitive built in.

**Fallback: Opus 4.7 sub-agent via the Agent tool.**
```
Agent(subagent_type="general-purpose", model="opus", prompt=<verification instructions>)
```
The harness's `agentId` provides the resumption handle equivalent to Codex's `--thread`. Use this when `codex` isn't on PATH, returns nonzero, or you pass `--force-opus` to `/lean-verify-deps`.

**Why not Sonnet/Haiku.** Verification involves judgment about Mathlib naming conventions (which often differ subtly from mathlib3) and reasoning about whether a candidate's signature really matches the English claim. Smaller models miss these and burn AXLE budget on bad candidates. Opus 4.7 / Codex 5.5 at high effort is the right cost/quality point.

## Reading the Artifacts

After a complete run, the proof repo has:

```
{PROOF_REPO}/lean/
├── lean_state.md             durable state (phase, lemma table, history)
├── source_proof.md           the English proof, copied from the branch
├── decomposition.md          structurer output: lemma DAG + objects
├── dep_audit_proposed.md     dep_audit role output (proposed candidates)
├── dep_audit.md              verified candidate table (after sub-agent)
├── main.lean                 the formalized proof (sorry bodies → proved)
├── support/
│   └── INVENTORY.lean        persistent stubs (some proved)
├── lemmas/
│   ├── <slug>.lean           one file per proved lemma
│   └── …
├── diagnostics/              raw role requests/responses, AXLE error traces
│   ├── lean_structurer_request_1.md
│   ├── lean_structurer_response_1.md
│   └── …
├── axle_log.jsonl            one line per AXLE call (tool, env, duration, okay, errors)
└── FORMALIZATION_REPORT.md   final summary, produced by /lean-final-check
```

The shippable artifacts are `main.lean`, `support/INVENTORY.lean`, `lemmas/*.lean`, and `FORMALIZATION_REPORT.md`. Everything else is diagnostic.

## Failure Modes and Recovery

### Decomposition is wrong (structurer-reviewer `REDO`)
- Cause: structurer misread the main theorem or absorbed implicit assumptions.
- Recovery: re-run `/lean-structure` after explicitly attaching the reviewer's verdict as context. If it `REDO`s twice, the source proof itself may be ambiguous — fix upstream.

### Dep audit's `not_in_mathlib` is wrong (auditor reviewer flags it)
- Cause: sub-agent searched poorly, or Mathlib has the result under a name nobody thought to try.
- Recovery: re-run `/lean-verify-deps` with a higher `--retries` (e.g. `--retries 8`) or `--force-opus` (Opus tends to be better at Mathlib name recall). Default is 5.

### AXLE skeleton verify fails after formalizer
- Cause: usually a wrong Mathlib import path (dep_audit hallucinated), occasionally a quantifier-scope mismatch.
- Recovery: look at `axle_log.jsonl` for the failed call, read the error trace in `diagnostics/`, feed it back to the formalizer with an explicit "fix THIS error" instruction.

### Prover returns `STUCK` on the same lemma 3 times
- Cause: the obstruction is upstream — either the decomposition split it wrong, or a needed Mathlib lemma was missed.
- Recovery: do NOT just throw more prover passes at it. Re-run `/lean-dep-audit` on a tighter scope, or re-decompose the affected sub-DAG with `/lean-structure`.

### Plausible finds a counterexample to a "proved" lemma
- Cause: the Lean *statement* is wrong (vacuous antecedent, swapped quantifier) and the proof closed a goal that doesn't entail the English claim.
- Recovery: this is severe. Surface immediately. The fix is usually in the formalizer (signature) or structurer (decomposition), not in the prover.

### `axle_log.jsonl` shows many 5xx or auth errors
- Cause: AXLE outage, expired key, or unset `AXLE_API_KEY`.
- Recovery: `mpp axle environments` should always return 9 toolchains. If it doesn't, fix the env before continuing. Stale partial state in `dep_audit.md` is recoverable — re-run `/lean-verify-deps`, which resumes in the same Codex thread.

## Wall-Clock Budgeting

Rough numbers for a paper-scale theorem with ~10 lemmas and ~30 external results:

| Phase | Wall-clock | Why |
|---|---|---|
| `/lean-structure` | 1–3 h | One structurer pass + one reviewer pass, with possible retry. Each pass is 30–90 min on Extended Pro. |
| `/lean-dep-audit` | 0.5–1.5 h | Single Extended Pro proposal. |
| `/lean-verify-deps` | 0.2–1 h | Sub-agent's AXLE loop, dominated by API latency, ~1 sec per candidate with parallel fan-out. |
| `/lean-formalize` | 1.5–4 h | Formalizer + reviewer + meaning-check + one AXLE skeleton verify. Possible retry loop on signature issues. |
| `/lean-prove-lemma × N` | 1–3 h per lemma | Each lemma is at least one Extended Pro pass. Hard lemmas can take multiple. |
| `/lean-merge` | <5 min | One AXLE call. |
| `/lean-final-check` | 0.5–2 h | AXLE verify + per-lemma disprove (fast) + final meaning-check (Extended Pro pass). |

Total: typically 10–30 hours wall-clock, of which the user is gated on Extended Pro maybe 60% of the time. Record the chat URLs and response/heartbeat paths, then use passive heartbeat polling, `/inspect-chat`, or `/recover-chat` when returning.

## Smart-Scaffolding Discipline, Applied Here

The orchestrator discipline from `CLAUDE.md §Orchestrator Discipline` still applies in this module:

- **Inspect base files before acting.** Read `decomposition.md` and `dep_audit.md` before submitting a formalizer pass.
- **Ask for parseable output.** All Lean role templates already do this via the leading fenced block convention.
- **Commit at meaningful checkpoints.** Commit in the proof repo after each major artifact lands: decomposition done, dep_audit verified, main.lean skeleton, each batch of proved lemmas, final.
- **Parallelize carefully.** Multiple `/lean-prove-lemma` invocations on *independent* lemmas can run in parallel (different ChatGPT chats), but their merges must be sequenced.

Add one Lean-specific rule:

- **Never accept a proof without a disprove sanity check.** Plausible is cheap; vacuous lemmas are expensive. Run `mpp axle disprove` on every proved lemma before moving on, not just in `/lean-final-check`.

## Proving-Phase Heuristics (the cheapest-first ladder)

Discovered the hard way during the `robust_trust_extension` wet run: the original `/lean-prove-lemma` flow burned Extended Pro time on lemmas that AXLE could close for free. The right cost-ordered ladder is:

1. **`axle repair-proofs` with a rich terminal-tactic stack — try first, always.**
   ```bash
   mpp axle repair-proofs --in main.lean \
     --terminal-tactics "grind,aesop,simp_all,exact?,decide,omega,polyrith,positivity" \
     --repairs "apply_terminal_tactics" --timeout 900
   ```
   On the v8 wet run, a single batched call closed **8 of 58 lemmas** at zero Pro cost — including the dust subtype lemmas, the payoff-decomposition unfolds, and the support-function pointwise equivalence. Do this **once early in the proving phase** to harvest the free closures, then again after each major in-thread/Pro round.

2. **In-thread proofs for structural unpacks.** Lemmas of the form "∃ X, P X" where X is constructible from existing structure fields are 1-3 line term-mode proofs (`⟨bridge.extendRestricted σ, bridge.extendRestricted_eq σ⟩`). Don't queue these for Pro.

3. **Extended Pro prover only for what AXLE + in-thread can't crack.** Genuine proof generation for substantive Lean theorem bodies (Tier 2 posterior identity, measurable-selection arguments, kernel restriction theorems, WTA cone intersection). Run Extended Pro chats **in parallel** when the lemmas are independent (no inter-lemma dependencies in their proofs).

4. **AXLE check before the prover-reviewer**, not after. There's no point asking Pro to audit a proof that doesn't even compile — flip the order from the original skill flow.

5. **Batch the prover-reviewer 2-3 lemmas at a time.** The reviewer is fast (5-15 min) but each round-trip has overhead. Batching related lemmas (same DAG layer, same external dependencies) cuts orchestrator total time roughly by 3×.

6. **Disprove as a final SWEEP, not per-lemma.** `axle disprove` accepts comma-separated names — one batched call over all freshly-proved lemmas is cheaper than per-lemma invocations and produces a cleaner audit log. Per-lemma disprove is still recommended for Lemma-7-style high-vacuous-risk theorems where the support hypothesis could silently be unsatisfiable.

The original lean-prove-lemma flow had `prover → reviewer → AXLE → disprove` as steps 4-8. The new order (per this section and the updated skill) is: **AXLE repair → in-thread → Pro prover (parallel) → AXLE check → batched reviewer → disprove sweep**. Same gates, dramatically lower wall-clock + Pro spend.

## Pointers

- **Skills:** `.claude/commands/lean-*.md` — full set of orchestrator-invokable skills.
- **Role templates:** `prompts/soft/80-88_lean_*_soft.md` — what gets submitted to Extended Pro.
- **Shared fragments:** `prompts/fragments/output_contract.md` (output discipline), `prompts/fragments/lean_translation_discipline.md` (no math changes, no axioms, no native_decide).
- **AXLE client + CLI:** `mathpipeprover/axle.py`, `mpp axle --help`.
- **API key:** `AXLE_API_KEY` in `.env` (get one at `https://axle.axiommath.ai/app/console`).
