---
description: Read-only summary of the current Lean formalization state
argument-hint: --proof-repo PATH
---

Print a one-screen summary of where the Lean formalization stands. Read-only; safe to invoke at any time.

**Arguments:** `$ARGUMENTS`
- `--proof-repo PATH` — absolute path to the proof working folder

## Orchestrator latitude

Paths inside `{PROOF_REPO}/lean/` follow the canonical layout from `/lean-formalize-init`. Trust `lean_state.md` over literal paths when reality differs.

## Steps

1. **Read `lean_state.md`.** Extract: phase, branch, source run, target toolchain, lemma table, `per_theorem_audits` ledger section (if present).

2. **Tally on-disk artifacts:**
   - lines / sorry-count of `main.lean`
   - lines / theorem-count of `INVENTORY.lean`
   - count of `lemmas/*.lean`
   - count of `diagnostics/*` (broken down by role)
   - size + entry count of `axle_log.jsonl`

3. **Recent AXLE activity.** Tail the last 10 entries of `axle_log.jsonl`. Summarize: total AXLE calls, total compile-failures, slowest call, last error if any.

4. **Audit ledger summary.** From the `per_theorem_audits` block in `lean_state.md` (format documented in `docs/lean_pipeline.md` §Audit ledger), summarize:
   - Total headline theorems registered: N
   - Brainstorm done: X / N
   - Proved (compile + review): Y / N
   - Per-theorem verify (8d): translation PASS, scope PASS, smuggling PASS counts
   - Gold check (8f): PASS-MIRROR + PASS-LEAN-MORE-EXPLICIT + FAIL-LEAN-SHORT + FAIL-MISMATCH counts
   - Stale entries: any whose `last_modified_commit` is older than HEAD's `main.lean` mtime — these need re-audit.

5. **Print a compact report:**
   ```
   Lean formalization for {BRANCH} (run {RUN_ID})
     Phase: {phase}                                    Initialized: {ts}
     Toolchain: {lean-4.X.Y}                           AXLE calls: {n} ({m_errors} errors)

     Decomposition: {lemma_count} lemmas, {object_count} objects
     Dep audit:     {confirmed}/{total} confirmed, {not_in_mathlib} INVENTORY stubs
     Formalization: main.lean = {n_lines} lines, {sorry_count} sorrys
     Proving:       {proved}/{lemmas} proved, {reviewed}/{lemmas} reviewed, {merged}/{lemmas} merged

     Per-theorem audit ledger:
       Brainstorm:   {bX}/{bN}    Verify (8d):  T={tP}, S={sP}, M={mP}
       Gold check:   mirror={gM}, flag={gF}, short={gS}, mismatch={gMM}
       Stale:        {stale_count} entries (re-audit needed after file changes)

     Most recent: {timestamp}  {skill}  {note}

     Next recommended skill: {suggested next based on phase}
   ```

6. **Surface any anomalies:**
   - Recent AXLE 5xx or auth errors
   - Lemma rows with `proved=✓` but `reviewed=–` (forgot the reviewer pass)
   - Stale state: phase says `proving_lemmas` but no `axle_log.jsonl` activity in >24h
   - INVENTORY.lean entries that are stubs but were never confirmed `permanent_stub` in the table
   - **Stale audit entries**: any `per_theorem_audits` entry whose `last_modified_commit` is older than the current `main.lean` git mtime — re-run the relevant audit step.
   - **Open paper-feedback flags** in `PAPER_FEEDBACK.md` (if file exists) that the user hasn't reviewed yet.

## Notes

- This skill never writes anything. Safe to alias / re-run / put in a cron.
- The "next recommended skill" hint is convenience, not authority. The orchestrator should always sanity-check against the actual state.
