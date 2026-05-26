---
description: Spawn a Codex CLI 5.5 thread (or Opus 4.7 sub-agent fallback) to verify each dep-audit candidate against AXLE
argument-hint: --proof-repo PATH [--retries 5] [--force-opus]
---

Take the dep-audit's *proposed* candidate table and verify each candidate against the live AXLE API. The verification is iterative — wrong-name candidates get re-proposed and re-checked up to N times — and runs in a **persistent sub-agent session** so the iteration loop doesn't consume the orchestrator's context.

This is a Lean-formalization exception to the normal MathPipeProver rule. Subagents may be used here because the work is Lean/Mathlib/AXLE code checking. Do not use this command as precedent for natural-language analytical proof roles; those go through Extended Pro.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder
- `--retries N` — max retries per wrong-name candidate (default 5)
- `--force-opus` — skip Codex; go straight to the Opus 4.7 Agent fallback

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. The `--thread` slug below uses the source provenance label recorded in `lean_state.md` (e.g., `lean-verify-deps-robust-trust` or `lean-verify-deps-{BRANCH}` for consolidator-produced runs) — keep it stable across re-invocations.

## Steps

1. **Read state.** Read `{PROOF_REPO}/lean/lean_state.md`. Verify the state is consistent with running dep verification now (typically `Current phase: deps_verifying`). Read `{PROOF_REPO}/lean/dep_audit_proposed.md` to confirm the proposal exists.

2. **Pre-flight AXLE.** `mpp axle environments --log-path {PROOF_REPO}/lean/axle_log.jsonl` to confirm auth + connectivity. If this fails, fix the AXLE_API_KEY in `.env` before continuing — no point spawning a sub-agent that will only hit auth errors.

3. **Choose the sub-agent backend.**
   - Default: **Codex CLI 5.5 with a persistent thread**.
     ```bash
     codex --model gpt-5.5 --effort extra-high \
           --thread "lean-verify-deps-<provenance-slug>" \
           --tool bash --tool web \
           --working-dir {PROOF_REPO}/lean
     ```
     The `<provenance-slug>` comes from `lean_state.md` (consolidator-produced runs use the branch name; hand-consolidated repos use a short repo-derived slug). It must be stable across re-invocations so resuming a partially-completed verification rejoins the same thread.
   - Fallback (if `codex` is not on PATH, returns nonzero, or `--force-opus` was passed): **Opus 4.7 sub-agent via the Agent tool**:
     ```
     Agent(subagent_type="general-purpose", model="opus", prompt="<see below>")
     ```

4. **The sub-agent's instructions** (same prompt for either backend):
   > Verify the candidates listed in `{PROOF_REPO}/lean/dep_audit_proposed.md` against AXLE.
   >
   > For each candidate, build a 3-line probe:
   > ```lean
   > import {import_path}
   > #check @{name}
   > ```
   > Save to a temp file, then run:
   > ```bash
   > mpp axle check --in <tmp> --log-path {PROOF_REPO}/lean/axle_log.jsonl
   > ```
   > Exit code 0 = candidate confirmed. Exit code 2 = compile failed (probably wrong name or path). Exit code 1 = transport error (retry once, then abort).
   >
   > For wrong-name candidates, search Mathlib docs (`https://leanprover-community.github.io/mathlib4_docs/`) for a correction, then re-probe. Up to **{RETRIES}** retries per candidate (default 5).
   >
   > Final bucketing — write a markdown table to `{PROOF_REPO}/lean/dep_audit.md` with columns: `external_slug | english_statement | final_name | final_import | bucket | confidence | retries_used | notes`. Buckets are: `confirmed`, `wrong_name_retry_exhausted`, `not_in_mathlib`, `axiom_dependent`.
   >
   > Return a one-paragraph summary to the orchestrator: how many confirmed, how many exhausted, how many not-in-mathlib, and any candidates that surprised you (especially deprecated names or moved-since-mathlib3).

5. **Run AXLE checks in parallel** where the sub-agent supports it. AXLE concurrency cap is 20 (keyed); fan-out 5–10 simultaneously is safe.

6. **On sub-agent return:** read `{PROOF_REPO}/lean/dep_audit.md`, parse the table, update `lean_state.md`:
   - phase `→ deps_done`
   - append history entry with bucket counts
   - record the sub-agent backend used + the thread/agent id for traceability

7. **Report.** Print the bucket summary. Recommend `/lean-dep-audit-review` next (which is *not* a separate skill — fire `lean_dep_audit_reviewer` via `/submit-role` directly per the existing pattern, or invoke `/lean-formalize` if you're confident in the table).

## Notes

- This is the only skill that uses a non-LLM-role sub-agent. The reason: each AXLE check is fast (50–500 ms), so a 60-candidate verification with 1–2 retries on half of them is hundreds of API calls. Round-tripping that through Extended Pro is ~50× slower than letting Codex/Opus iterate locally.
- **Codex thread persistence matters.** If the sub-agent runs out of context mid-verification, `codex --thread lean-verify-deps-<provenance-slug>` resumes from where it left off. The Opus Agent fallback uses the harness's `SendMessage` with the returned `agentId` for the same purpose.
- AXLE has no rate-limit on a per-call basis but enforces concurrency caps. If you see `429`-equivalent errors in the audit log, lower the fan-out.
- `axiom_dependent` is a sub-bucket of `confirmed`: the candidate compiles, but its proof in Mathlib uses `Classical.choice` or similar. Not a blocker; just documentation.
