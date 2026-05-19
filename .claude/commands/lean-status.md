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

1. **Read `lean_state.md`.** Extract: phase, branch, source run, target toolchain, lemma table.

2. **Tally on-disk artifacts:**
   - lines / sorry-count of `main.lean`
   - lines / theorem-count of `INVENTORY.lean`
   - count of `lemmas/*.lean`
   - count of `diagnostics/*` (broken down by role)
   - size + entry count of `axle_log.jsonl`

3. **Recent AXLE activity.** Tail the last 10 entries of `axle_log.jsonl`. Summarize: total AXLE calls, total compile-failures, slowest call, last error if any.

4. **Print a compact report:**
   ```
   Lean formalization for {BRANCH} (run {RUN_ID})
     Phase: {phase}                                    Initialized: {ts}
     Toolchain: {lean-4.X.Y}                           AXLE calls: {n} ({m_errors} errors)

     Decomposition: {lemma_count} lemmas, {object_count} objects
     Dep audit:     {confirmed}/{total} confirmed, {not_in_mathlib} INVENTORY stubs
     Formalization: main.lean = {n_lines} lines, {sorry_count} sorrys
     Proving:       {proved}/{lemmas} proved, {reviewed}/{lemmas} reviewed, {merged}/{lemmas} merged

     Most recent: {timestamp}  {skill}  {note}

     Next recommended skill: {suggested next based on phase}
   ```

5. **Surface any anomalies:**
   - Recent AXLE 5xx or auth errors
   - Lemma rows with `proved=✓` but `reviewed=–` (forgot the reviewer pass)
   - Stale state: phase says `proving_lemmas` but no `axle_log.jsonl` activity in >24h
   - INVENTORY.lean entries that are stubs but were never confirmed `permanent_stub` in the table

## Notes

- This skill never writes anything. Safe to alias / re-run / put in a cron.
- The "next recommended skill" hint is convenience, not authority. The orchestrator should always sanity-check against the actual state.
