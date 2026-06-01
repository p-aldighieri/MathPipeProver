Fan out a 4-member council (1 Codex + 1 Gemini + 1 Opus + 1 Extended Pro) on a
stalled re-attack, write four independent memos, hand off to the regular
Strategy Searcher.

**Use only on attempt ≥2** — when first-attempt routes stalled or the
gatekeeper flagged `OBJECTIVE_NARROWED` / `OBJECTIVE_MISSED` and the dossier
is non-empty. Council costs ~3× a single Codex call plus one EP session;
do not invoke on attempt 1.

Arguments: $ARGUMENTS
- `--proof-repo PATH` (required) — absolute path to the proof working folder
- `--attempt N` (required) — re-attempt number, used in council output path
- `--branch NAME` (optional, default `main`) — branch within the proof repo
- `--project-url URL` (required) — ChatGPT project URL for the EP member
- `--cdp-url URL` or `--port N` (optional) — CDP for EP via existing Chrome
- `--skip-member NAME` (optional, repeatable) — skip codex / gemini / opus / extended_pro

## How council differs from the regular searcher

The regular Strategy Searcher (`03_searcher_soft.md`) runs alone on Extended
Pro — fast, single-prior, structured. The council runs four members in
parallel against the **same packet**, preserving four independent memos
(no merger), then hands them all to the regular searcher for pure selection
+ ranking. The diversity comes from running four distinct model architectures:

- One Codex (GPT-5.5 thinking-high) — ephemeral session, structured route
  generation.
- One Gemini (the latest Gemini Pro) — a different pretraining/RLHF lineage,
  broadening the architecture spread (replaces the former second Codex sample,
  whose same-model variance was bonus diversity, not load-bearing). The adapter
  passes no model flag, so it tracks the Gemini CLI's built-in latest-Pro
  default (currently gemini-3.1-pro-preview) rather than pinning a version.
- One Claude Opus — different RLHF priors, often surfaces creative
  cross-domain leaps.
- One Extended Pro — deep single-thread reasoning, structurally rigorous.

Each member is asked for 2-3 routes (not 2-4) to avoid overcrowding the
searcher with ~12+ routes. ~8-12 routes total is the sweet spot.

## Steps

1. **Locate packet sources** in the proof repo. Expected at
   `{proof_repo}/runs/<run>/branches/{branch}/`:
   - `objective.md` — the original objective (durable)
   - `paper-ref.md` or `paper.md` — paper excerpts (durable; orchestrator
     may need to extract from the full paper)
   - `dossier.md` or `attempt_dossier.md` — what's been tried
   - `prior-routes.md` — explicit refuted-route summary (orchestrator may
     synthesize from the dossier if not separately maintained)

   If any of these are missing, the orchestrator MUST construct them
   before invoking council. Council without a real dossier is a waste of
   tokens.

2. **Stage the packet directory.** Create
   `{proof_repo}/runs/<run>/branches/{branch}/council/attempt-{N}/packet/`
   and copy / link the four files into it. This is the immutable input the
   four members all see.

3. **Fan out the four members in parallel.** All four adapters honor
   the same `--packet-dir` / `--prompt` / `--out` contract; the EP adapter
   adds `--project-url` and the CDP/port arg.

   ```bash
   PACKET="{proof_repo}/runs/<run>/branches/{branch}/council/attempt-{N}/packet"
   OUT="{proof_repo}/runs/<run>/branches/{branch}/council/attempt-{N}"
   PROMPT="{MATHPIPEPROVER}/prompts/soft/03b_council_member_soft.md"

   # Codex — ephemeral GPT-5.5 thinking-high
   scripts/council/dispatch_codex.sh --packet-dir "$PACKET" --prompt "$PROMPT" \
     --out "$OUT/codex_memo.md" &
   CODEX_PID=$!

   # Gemini — latest Gemini Pro via the CLI default (different architecture)
   scripts/council/dispatch_gemini.sh --packet-dir "$PACKET" --prompt "$PROMPT" \
     --out "$OUT/gemini_memo.md" &
   GEMINI_PID=$!

   # Opus — fast (~1-3 min)
   scripts/council/dispatch_opus.sh --packet-dir "$PACKET" --prompt "$PROMPT" \
     --out "$OUT/opus_memo.md" &
   OPUS_PID=$!

   # Extended Pro — slowest (8-20 min); determines wall-clock
   scripts/council/dispatch_extended_pro.sh --packet-dir "$PACKET" --prompt "$PROMPT" \
     --out "$OUT/extended_pro_memo.md" \
     --project-url "$PROJECT_URL" --cdp-url "$CDP_URL" &
   EP_PID=$!
   ```

   Track each PID + start time. The orchestrator does NOT need to block
   waiting — fire all four, then poll their output files. Codex, Gemini, and
   Opus should finish well before EP.

4. **Heartbeat / partial-completion handling.** EP can fail (network, model
   refusal, etc.). If 3/4 members complete and EP is still running after 30 min, the orchestrator may proceed with the 3 memos rather than block
   indefinitely; record the partial completion in `council_log.json`.

5. **Write `council_log.json`** when all members have returned (or been
   declared partial):

   ```json
   {
     "attempt": 2,
     "started_at": "ISO8601",
     "completed_at": "ISO8601",
     "members": {
       "codex":   { "memo": "codex_memo.md",  "exit": 0, "duration_s": 240 },
       "gemini":  { "memo": "gemini_memo.md", "exit": 0, "duration_s": 180 },
       "opus":    { "memo": "opus_memo.md",   "exit": 0, "duration_s": 95  },
       "extended_pro": { "memo": "extended_pro_memo.md", "exit": 0, "duration_s": 3600 }
     },
     "skipped": [],
     "partial": false
   }
   ```

6. **Hand off to the regular Strategy Searcher** via `/submit-role`. The
   searcher prompt (`03_searcher_soft.md`) has been updated to accept
   council memos as inputs. Pass them all as the context bundle —
   searcher will rank and select, not merge.

   ```bash
   /submit-role \
     --project-url "$PROJECT_URL" \
     --prompt-file "{MATHPIPEPROVER}/prompts/soft/03_searcher_soft.md" \
     --context "$OUT/codex_memo.md,$OUT/gemini_memo.md,$OUT/opus_memo.md,$OUT/extended_pro_memo.md" \
     --response-file "{proof_repo}/runs/<run>/branches/{branch}/searcher_response_council.md"
   ```

## Cost discipline

- Council is opt-in. Do NOT invoke on attempt 1 unless the user explicitly
  asks. The regular searcher is sufficient when the dossier is empty.
- If Extended Pro is unavailable (network, account state, no project URL),
  fall back to a 3-member council (skip via `--skip-member extended_pro`).
  Document the skip in council_log.json.
- The four members degrade independently — any member whose CLI is missing or
  failing can be dropped with `--skip-member <name>` and the council proceeds
  with the rest. In particular, **if the Gemini CLI is not installed**
  (`gemini` not on PATH) or not yet authenticated, skip it with
  `--skip-member gemini`; the council then runs as 1 Codex + 1 Opus + 1
  Extended Pro. Installing + authenticating the Gemini CLI restores the full
  four-architecture spread — see the dependency note in
  `docs/soft_scaffolding.md`. Record any skip in council_log.json.

## What council does NOT do

- **No synthesis pass.** Memos are immutable; the regular searcher reads
  them and picks routes. There is no "merge memos into one combined memo"
  step — that defeats the diversity-preservation purpose.
- **No member sees the others' work.** Adapters fire in parallel against
  the same packet, never sharing intermediates.
- **No router role.** This is a single fan-out + handoff, not a loop.
  Routing decisions stay with the orchestrator.

## When NOT to use this

- Attempt 1 (use the regular searcher; the council adds no value without a
  dossier).
- When the dossier shows the next move is obviously technical (e.g., "we
  need to compute a specific integral") rather than strategic. Council is
  for strategy diversity, not technical horsepower.
- When the gatekeeper verdict was `OBJECTIVE_MET` — there's nothing to
  re-attack.
