# Lean Formalization Pipeline — Orchestrator Guide

This document describes the conceptual workflow the orchestrator (you, Claude) should follow when formalizing a math proof in Lean. It supersedes any ad-hoc patterns established in prior sessions. Read this end-to-end before starting a fresh Lean formalization or resuming one.

The pipeline is split into **phases**. Within each phase, work may be **sequential** or **parallel**; the document is explicit about which.

---

## Goal

Translate a refereed natural-language mathematical proof into a Lean 4 / Mathlib formalization that is:

1. **Build-passing**: `lake build` exits 0.
2. **Zero-sorry** in the target file (excluding pre-accepted Inventory stubs).
3. **Smuggling-free**: no axiom-tricks, certificate-verifier shortcuts, universal-helper bypasses, or paper-derivations-as-hypothesis-fields without user acceptance.
4. **Paper-faithful**: each Lean theorem mirrors a paper theorem in statement + hypothesis count + conclusion modulo notation.
5. **Reviewer-clean**: per-theorem and global audits return CLEAN ACCEPT.

Discovery is OK: if formalization surfaces clarifications the paper should add, flag them for paper update. Lean being **more explicit than English** is acceptable (and feeds back to improve the paper). Lean being **short of English** is a failure.

---

## Pipeline phases

```
Phase 0   init           — initialize state, mount paper, set toolchain
Phase 1   structure      — decompose paper proof into lemma DAG
Phase 2   dep-audit      — audit dependencies vs Mathlib; populate Inventory
Phase 3   formalize      — produce main.lean skeleton (signatures + sorries)
Phase 4   prove          — per-lemma brainstorm + prove + review + verify, parallel branches
Phase 5   merge          — merge proved lemmas into main.lean
Phase 6   final-check    — full-file translation, smuggling, gold check, paper feedback
```

Phases 0–3 and 5 are roughly as before. **Phases 4 and 6 are the architectural redesign** captured here.

---

## Phase 4 — per-lemma parallel proving

This is the core innovation. Each lemma goes through its own **branch** consisting of a sequential cycle:

```
brainstorm  →  prove  →  review  →  compile-check  →  per-theorem verify
   (8c)         (87)       (88)        (AXLE/lake)         (8d)
```

Multiple branches run **in parallel** (recommended 2–3 simultaneous), each handling a different lemma. The orchestrator manages dispatch, polling, and routing.

### 4.1 brainstorm (per-lemma, `8c`)

For each lemma scheduled for proving:

- Dispatch to **Extended Pro** via the project browser (it has long context + paper sources loaded).
- Prompt: `prompts/soft/8c_lean_design_brainstorm_soft.md`.
- Inputs: the lemma's signature from `decomposition.md`, the matching paper §-reference, any prior structural choices (e.g., already-defined hypothesis types).
- Output: proposed concrete-canonical-data design (no abstract `Prop` placeholders), proof skeleton, axiom asks (if any).
- **Why early**: brainstorming structural design BEFORE asking the prover saves entire refactor cycles. Phase 11 of the PIOTR-v9 session burned 6+ rounds reverting smuggled patterns that a brainstorm would have caught up front.

### 4.2 prove (per-lemma, `87 lean_prover_soft`)

- Dispatch to an **Opus subagent** with the brainstorm output + lemma signature + decomposition context.
- Subagent writes the proof body, edits `lemmas/<slug>.lean`.
- Subagent must verify `lake build` exits 0 before returning.

### 4.3 review (per-lemma, `88 lean_prover_reviewer_soft`)

- Submit the proof to Extended Pro for an adversarial review pass.
- PATCH_SMALL / PATCH_BIG: loop back to prove with feedback (max 5 retries).
- REDO with new-axioms or unsafe-tactics: escalate.

### 4.4 compile-check (per-lemma)

- Run AXLE `verify_proof` on the lemma file with `permitted_sorries=*` (allows the lemma's own `sorry` placeholders for downstream merging).
- Exit 0 = lemma compiles; can proceed to verify.

### 4.5 per-theorem verify (per-lemma, `8d`)

The bundled translation + scope + smuggling check for ONE lemma.

- Dispatch to Extended Pro.
- Prompt: `prompts/soft/8d_lean_per_theorem_audit_soft.md`.
- Inputs: the Lean lemma statement + proof body, the matching paper §-statement + paper-side proof sketch.
- Output: per-axis verdicts (translation / scope / smuggling), each PASS / SCOPE_DRIFT / SMUGGLING_FLAG / etc.
- **Why bundled**: at the per-theorem level, translation and smuggling are both "is this theorem honestly what we want?" checks. Splitting them doubles audit cost without benefit.
- **Why deferred from inside prove-review loop**: Phase 11 history shows that smuggling-checking during proof iteration causes thrash (every flag forced a revert). The proof needs room to breathe — the audit runs AFTER prove + review + compile have stabilized the lemma.

### 4.6 orchestrator routing within Phase 4

- For each branch, if (4.5) returns a flag, the orchestrator routes that lemma BACK to (4.1) brainstorm with the audit feedback attached. Max 3 routing loops per lemma before escalation.
- Lemmas with no flags graduate to Phase 5 (merge).
- Track per-lemma audit state in `lean_state.md` per the audit ledger format (see "Audit ledger" below).

### 4.7 concurrency constraints

- **Brainstorm step (4.1)**: multiple in parallel — Extended Pro browser chats are isolated. Use `cdp_submit_batch.mjs` for N parallel dispatches.
- **Prove step (4.2)**: Opus subagents edit the same file (`main.lean` or per-lemma files). Two concurrent Opus subagents on the same file WILL clobber each other. Either: (a) one Opus at a time, parallel only at the brainstorm + review + verify levels; or (b) use per-lemma files in `lemmas/<slug>.lean` so concurrent Opus subagents don't conflict.
- **Review + verify steps**: parallel-safe (browser chats, no file edits).

The pragmatic pattern is: brainstorm + review + verify run in parallel batches; prove runs sequentially (one Opus subagent at a time per shared file).

---

## Phase 6 — final-check (expanded)

Once all lemmas merged and `main.lean` builds clean, run the four-axis final pass.

### 6.1 full-file translation (`8d` applied globally or batched)

- For each headline theorem in `main.lean`, run the per-theorem verifier (`8d`).
- Group into thematic batches (typically: T1 / T2 / Binary / FBNF / Hall / P-class / G-addendum, or whatever the paper's chapter structure suggests).
- Use `cdp_submit_batch.mjs` to dispatch N batches in parallel.

### 6.2 full-file smuggling (`8b`)

- Single global pass over `main.lean`.
- Catches the patterns the per-theorem audits might have missed at the cross-theorem level (universal helpers like `PsiNonpos_of_regPackage`, shared structural fields that smuggle across multiple theorems).
- Prompt: `prompts/soft/8b_lean_smuggling_check_soft.md`.

### 6.3 gold check (`8f`, NEW)

Asymmetric Lean ↔ English comparison.

- Prompt: `prompts/soft/8f_lean_gold_check_soft.md`.
- For each Lean theorem T_L, find the matching English theorem T_E in the paper.
- Verdict per theorem:
  - **PASS (mirror)**: structurally identical statement, hypotheses match, conclusion matches modulo notation.
  - **PASS+FLAG (Lean more explicit)**: Lean adds explicit structure / makes implicit assumptions explicit. Acceptable; FLAG so the paper can be updated to match.
  - **FAIL (Lean short)**: Lean is missing a hypothesis or step the paper has. Lean must be updated.
  - **FAIL (mismatch)**: different conclusion or fundamentally different hypothesis structure. One of paper or Lean is wrong; investigate.

### 6.4 paper feedback (`8e`, NEW)

For all PASS+FLAG findings from 6.3, generate a punch-list of paper clarifications: text edits the paper should add to match Lean's explicit form. The user reviews and accepts / rejects each.

### 6.5 orchestrator routing within Phase 6

- All PASS: declare formalization COMPLETE.
- Any FAIL: route back to Phase 4 for the affected lemma(s); after fix, re-run Phase 5 merge + Phase 6 final-check.
- PASS+FLAG only: COMPLETE for Lean; emit paper-feedback punch-list for user.

---

## Audit ledger (in `lean_state.md`)

The orchestrator maintains per-theorem audit state to track what's been verified vs what needs re-verification after file changes.

```yaml
per_theorem_audits:
  - name: «P3-polyhedral-cone-margin»
    line: 4631
    last_modified_commit: 35eb9cc
    audits:
      brainstorm:
        chat: 6a113f99
        run_at: 2026-05-23T01:30:00Z
        outcome: design-accepted
      prove:
        agent: opus-subagent-id
        run_at: 2026-05-23T02:00:00Z
        outcome: lake-build-PASS
      review:
        chat: 6a113fab
        run_at: 2026-05-23T02:15:00Z
        verdict: PASS
      verify:
        chat: 6a113fc3
        run_at: 2026-05-23T02:30:00Z
        translation: PASS
        scope: PASS
        smuggling: PASS
        flagged: []
      gold:
        chat: 6a115a02
        run_at: 2026-05-23T03:14:00Z
        verdict: PASS-MIRROR
    stale: false
```

After any commit that touches `main.lean` or `lemmas/<slug>.lean`, mark all `per_theorem_audits` entries whose `last_modified_commit` is older as `stale: true`. `/lean-status` surfaces stale entries.

---

## Tooling primitives

| Tool | Purpose |
|---|---|
| `cdp_submit_batch.mjs` | Parallel-submit N prompts, return N chat URLs |
| `cdp_refresh_sources.mjs` | Cache-bust + re-upload project sources before reviewer pass |
| `wait_chat_done.mjs` | Pin-to-chat-ID poller (hardened 2026-05-23) |
| `cdp_dump_chat.mjs` | Targeted chat content dump (use when poller drifts) |
| AXLE (`mpp axle verify-proof`) | Lemma/file-level Lean compile + axiom audit |
| `lake build MathlibStarter.V9Main` | Authoritative build check |

---

## Smuggling pattern taxonomy (consume `8b` for full audit)

- **SMUGGLED_SORRY** — sorry outside whitelist.
- **SMUGGLED_AXIOM** — axiom whose conclusion is the proof goal.
- **SMUGGLED_AXIOM_DRESSED_AS_DEPENDENCY** — axiom with real paper citation but bespoke proof-specific prop.
- **OPAQUE_TRAPDOOR** — `opaque` returning a `Prop` (always wrong) or arbitrary value type that lets user inject anything.
- **VACUOUS_FIELD** — `Prop`-typed structure field with no content.
- **CONCLUSION_AS_FIELD / SMUGGLED_CERTIFICATE** — structure field whose type IS the theorem's conclusion; theorem body projects it via `exact data.field`.
- **SMUGGLED_UNIVERSAL_HELPER** — universal lemma whose conclusion is so general it discharges per-class theorems trivially (e.g., `PsiNonpos_of_regPackage` in PIOTR v9 history).
- **HYPOTHESIS_AS_PAPER_DERIVATION** (borderline) — structure field asserting a paper-theorem result as standing input rather than deriving from elementary primitives. Flag for user awareness; user accepts (v9-ledger architectural pattern) or rejects (require Lean derivation).
- **CHOICE_ABUSE** — `Classical.choice` pulling a witness for a statement that should be proved.
- **TACTIC_SUPPRESSION** — `noncomputable section` / `unsafe` / disabled linter masking content.

---

## Phase 1 / Phase 2 / Phase 3 (lessons from PIOTR v9 session)

In rare situations (e.g., user has a deadline; mathematical content is decided but Lean engineering will take time), the orchestrator may invoke an **explicit Phase 1 / Phase 2 / Phase 3 workflow** as a meta-strategy spanning multiple of the standard pipeline phases:

- **Meta-Phase 1**: close all sorries by ANY MEANS — add Inventory axioms freely, accept structural-hypothesis fields. Get to zero sorries with build PASS, ignoring smuggling.
- **Meta-Phase 2**: audit (via `8b` + `8d` + `8f`) — classify each new addition.
- **Meta-Phase 3**: replace each smuggled addition with a Lean derivation (or accept it as a flagged HYPOTHESIS_AS_PAPER_DERIVATION).

This is NOT the default. The default is the standard Phase 0–6 pipeline above. The Phase 1/2/3 escape hatch exists for time-constrained scenarios where stopping at "zero sorries with documented smuggling for later cleanup" is more useful than "honest partial proof".

---

## Final state expectations

When formalization is declared COMPLETE:

- `lake build` exits 0.
- Zero `sorry` in `main.lean` (outside whitelisted Inventory stubs).
- All headline theorems in `lean_state.md` `per_theorem_audits` have `verify: translation=PASS, scope=PASS, smuggling=PASS` and `gold: PASS-MIRROR or PASS-FLAG`.
- Global `8b` smuggling audit returns CLEAN ACCEPT.
- All paper-feedback (`8e`) findings have been reviewed by the user.

---

## Common failure modes (PIOTR v9 history)

| Failure | Detection | Fix |
|---|---|---|
| Subagent edits V9Main.lean only, not v9_appendix.lean | Compare file sizes; check git status | Sync via `cat v8 v9_appendix > main; cp main V9Main` |
| Reviewer reads stale ChatGPT-cached upload | Re-run reviewer with `cdp_refresh_sources.mjs` + new chat | Cache-bust then fresh chat |
| Poller grabs wrong chat content | Hardened `wait_chat_done` pins chat ID | Re-poll with new pin-aware version |
| Smuggling shortcut moved from axiom → field → arg → lemma | Each pattern caught by 8b's expanded category taxonomy | Apply fix to whichever vector |
| Universal helper bypasses per-class theorems | New SMUGGLED_UNIVERSAL_HELPER category | Replace with per-class lemmas that consume class data |
| Per-theorem verifier accepts trivializing hypothesis | HYPOTHESIS_AS_PAPER_DERIVATION flag forces user-acceptance call | User decides: accept v9-ledger pattern or require derivation |

---

End of pipeline guide. The orchestrator should read this whenever starting or resuming a Lean formalization. The companion soft prompts are in `prompts/soft/` (numbered 80–8f).
