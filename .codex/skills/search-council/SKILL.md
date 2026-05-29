---
name: search-council
description: Fan out a 4-member council (2 Codex thinking-high + 1 Claude Opus + 1 ChatGPT Extended Pro) on a stalled re-attack. Preserves all four independent memos; hands off to the regular Strategy Searcher for pure selection. Opt-in (attempt ≥2), ~3× the cost of a single search.
---

# search-council

**Canonical content:** `.claude/commands/search-council.md` in this repo.
Codex and Claude Code share the same procedure — edit the Claude command
file, not this stub.

## TL;DR for Codex sessions

Use only on attempt ≥2 when first-attempt routes stalled or the gatekeeper
flagged scope narrowing. Don't invoke on attempt 1 (the regular searcher is
sufficient when the dossier is empty).

Mechanics: the skill fans out four adapters in parallel from
`scripts/council/`:

- `dispatch_codex.sh` × 2 (ephemeral sessions; natural sampling variance,
  verified live 2026-05-27: meaningfully different proof routes across two
  calls)
- `dispatch_opus.sh` × 1 (different RLHF priors, surfaces cross-domain leaps)
- `dispatch_extended_pro.sh` × 1 (slowest member, 8-20 min — determines
  council wall-clock)

All four adapters honor the same `--packet-dir / --prompt / --out` contract.
Each member writes an immutable memo to
`{proof_repo}/runs/<run>/branches/<branch>/council/attempt-<N>/`. Memos are
NEVER merged — they hand off as-is to the regular `/submit-role` searcher,
which runs in selection mode (pick 2-4 routes across all four memos, rank,
recommend).

The council-member prompt is at
`prompts/soft/03b_council_member_soft.md`. Each member is asked for 2-3
routes to keep the searcher's total under ~12.

Read `.claude/commands/search-council.md` for the full step-by-step,
partial-completion handling, and cost-discipline guidance.
