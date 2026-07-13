# MathPipeProver

MathPipeProver's primary operating model is **smart scaffolding**: a Claude Code or Codex orchestrator stays mathematically engaged, curates the browser context, and decides what happens next. The repository supports two operating modes — smart scaffolding and the API pipeline — and the smart-scaffolding mode is the headline.

### Smart scaffolding (default)

A long-running Claude Code or Codex session acts as the proof operator. It reads proof state, synthesizes reviewer verdicts, narrows scope, refreshes durable sources, repairs browser state, and submits focused roles to ChatGPT Extended Pro through the browser tooling. Pair it with browser-backed configs, `prompts/soft/`, and orchestrator-reviewed stops (`orchestrator_controls_stop = true`) whenever you want the orchestrator to stay in charge.

### API pipeline (hands-off)

Fully automated, no browser, no human-visible orchestrator in the loop. All roles (formalizer, searcher, prover, reviewer, consolidator) run via API providers (OpenAI, Anthropic, Gemini). The pipeline uses built-in phase transitions and reviewer control hints instead of a separate router role. Use configs like `config/production.toml` or `config/default.toml`. Prompts come from `prompts/api/` (structured for API consumption). Run with `mpp run` / `mpp resume`.

In smart-scaffolding mode the orchestrator is expected to act intelligently, not mechanically: synthesize proof-state, reviewer verdicts, route obstructions, and current branch value before choosing the next role; do not merely relay model outputs or follow stale pipeline momentum when the mathematical frontier has already shifted. The API pipeline runs autonomously and uses the built-in phase transitions instead.

## Orchestrator Discipline

These apply in smart-scaffolding mode. They are the difference between a smart orchestrator and a relay.

- **Inspect base files before acting.** Before executing any user task brief, read the target source file (manuscript, conjecture statement, draft .tex / .pdf) end to end and extract every embedded comment, RED note, TODO, FIXME, "tasks for AI" block, and in-prose question. Treat each as a task item even when it does not appear in the user's brief — these author requests are easy to miss because they live in the source, not the prompt.
- **Run the gatekeeper before declaring done.** Every consolidator PASS is followed automatically by a gatekeeper pass. The gatekeeper checks scope (not logic): did the proof answer the original question, or was the question quietly narrowed? On `OBJECTIVE_NARROWED` or `OBJECTIVE_MISSED`, the gatekeeper proposes route-level re-attacks. Read its verdict before committing to "done" — it is the structural counterweight to local-minima tunnel vision inside the prover-reviewer loop.
- **Falling short is not done — re-attack by default.** An *attempt* is one full push of the pipeline (`searcher → breakdown → prover → reviewer → consolidator → gatekeeper`, including its fan-out of route-branches). When an attempt ends short of the original objective — gatekeeper `OBJECTIVE_NARROWED`/`OBJECTIVE_MISSED`, or every route stalled, hit budget, or reached diminishing returns — the default is **not** to stop. First **document the attempt**: commit the proof repo and write (or append to) an **attempt dossier** (routes tried, what closed vs. stalled, the central obstruction each hit, refuted routes, and the gatekeeper's re-attack strategies). Then **loop back to the searcher**, passing the dossier as an explicit input, to open a fresh attempt. Stopping is the exception and needs a recorded reason: the objective is met, it is disproved, genuinely distinct strategies are exhausted, or a human calls it. "We tried hard" and "diminishing returns" are re-attack *triggers*, not stop reasons. On re-attack, keep the objective, paper, and durable proof-state **untouched** (the objective is the fixed target); only add/refresh the dossier and swap out the spent route memo. If the gatekeeper flags the *formalization itself* (typical of `OBJECTIVE_MISSED`), it is legitimate to loop all the way back to the formalizer — re-reading the source statement with the dossier in hand — not just to the searcher. See `docs/soft_scaffolding.md` §Attempts and the Default Re-Attack Loop.
- **Simplify only after the objective is met (optional).** Once a result is locked (gatekeeper `OBJECTIVE_MET`, consolidated and reviewed), an optional post-gatekeeper simplification pipeline can look for a cleaner proof of the *same* theorem — "as simple as possible, but not simpler". It mirrors the main pipeline (`simplify-breakdown → per-block {simplify-search → simplifier → reviewer → simplify-compare} → consolidator → gatekeeper`) with `prove` swapped for `simplify, theorem preserved`: it reuses `06_reviewer`/`07_consolidator`/`08_gatekeeper` and adds templates `prompts/soft/09_simplify_breakdown`, `0a_simplify_search`, `0b_simplifier`, `0c_simplify_compare`. The breakdown emits a dependency DAG so independent blocks (and routes within a block) simplify in parallel; a block's simpler proof is adopted only if it is correct AND strictly-simpler-at-same-strength with its interface preserved. Never simplify a moving target, and never trade strength for brevity. See `docs/soft_scaffolding.md` §Optional Post-Gatekeeper Simplification Pipeline.
- **Ask for parseable output.** Submit role prompts that ask GPT Extended Pro for results in clearly-delimited blocks (the templates in `prompts/soft/` already do this). Without delimited output, dumps are slow and error-prone to parse. If you find yourself improvising a parse, the prompt template is what needs fixing.
- **Commit at meaningful checkpoints.** Commit in the proof repo (not MathPipeProver) at the end of each verified unit, scope shift, or major artifact production. The proof repo is the durable record of mathematical progress; MathPipeProver is the toolchain. Do not let unstaged proof work accumulate across multiple verified results.
- **Parallelize carefully.** You may run two subtasks in parallel when they are genuinely independent and the marginal context cost is justified (e.g., two unrelated reviewer verdicts in flight against different verification units). Keep an explicit log of which run owns which durable project source vs. which prompt-specific attachment, so concurrent runs do not collide on shared sources. When in doubt, sequence.
- **Keep subagents out of analytical proof work.** In the main natural-language proof pipeline, formalizer/searcher/breakdown/prover/reviewer/consolidator/gatekeeper roles go through ChatGPT Extended Pro via the browser-backed `external_agent` workflow. Subagents are only for a specifically requested coding/simulation task, or for Lean formalization work where the task is Lean/Mathlib/AXLE code checking or proof engineering.

## Slash Commands

Available via `.claude/commands/`:

| Command | Description |
|---------|-------------|
| `/set-model-extended` | Set/verify ChatGPT's **Extended Pro target**. MUST run before any submission. |
| `/submit-role` | Submit a proof role prompt to a ChatGPT project. Verifies Extended Pro, sends, reports chat URL. |
| `/set-sources` | Add/remove durable files in a ChatGPT project's Sources tab. |
| `/inspect-chat` | Read-only check of a live chat's generation status. |
| `/recover-chat` | Extract a completed response from a chat URL and save to file. |
| `/search-council` | **Re-attack only** (attempt ≥2). Fan out 1 Codex + 1 Gemini + 1 Opus + 1 Extended Pro on the same packet, preserve all four memos, hand off to the regular Strategy Searcher for pure selection. Opt-in, ~3× the cost of a single search. Adapters at `scripts/council/dispatch_{codex,gemini,opus,extended_pro}.sh`. The Gemini member needs the `gemini` CLI (`npm i -g @google/gemini-cli`, then authenticate once); without it, drop that member via `--skip-member gemini`. |
| `/set-referee-targets` | Create or update `{PROOF_REPO}/referee_targets.yaml` — the per-proof registry of target journals + clearance bars that the `paper_referee` role consults. Optional (referee falls back to a generic publishability check without it). Template at `prompts/fragments/referee_targets_template.yaml`. |
| `/heartbeat` | Start an orchestrator-pace loop (`/loop <interval>`) that wakes the orchestrator periodically and advances the pipeline. Useful for unattended runs. |

For long-running submissions, use `/inspect-chat` for one-shot status checks and `/recover-chat` to harvest a completed chat. For unattended runs, `/heartbeat <interval>` starts an orchestrator-pace loop that wakes up periodically and advances the pipeline on its own.

## CDP Browser Scripts

Prefer the wrapper `scripts/chatgpt_browser_agent.sh` for normal proof work:

- `prepare --project-url URL [--cdp-url URL] [--add-source PATH ...] [--remove-source NAME ...]`
- `submit --project-url URL --request-file PATH --response-file PATH [--cdp-url URL] [--attach-file PATH ...] [--deep-research]`
- `recover --chat-url URL --response-file PATH [--cdp-url URL]`
- `inspect --chat-url URL [--cdp-url URL]`

**Pass `--deep-research` only when submitting the literature role** (`prompts/soft/02_literature_soft.md`). Every other role runs in Extended Pro. See "Model modes" below.

### Library / entry-point split (post 2026-05-26 lib unification)

DOM logic lives in `scripts/chatgpt_browser_agent/lib/`:

| Module | Purpose |
|--------|---------|
| `lib/model_pill.mjs` | Composer pill reading + Extended Pro / Deep Research enforcement. Single source of truth for model state. |
| `lib/composer.mjs` | Composer textarea detection (multi-candidate), send-button fallback chain, isGenerating. |
| `lib/browser.mjs` | CDP attach (`attachCDP`) and persistent Chrome launch (`launchPersistent`). |
| `lib/auth.mjs` | Login readiness wait + single-account chooser auto-pick. |
| `lib/sources.mjs` | Durable Sources tab: list / add / remove with confirmation-dialog handling. |
| `lib/attachments.mjs` | Per-prompt composer attachments. |
| `lib/poll.mjs` | Assistant-text reading, stability polling, clipboard-based clean extraction. |

Entry-point `.mjs` scripts are thin shims over lib:

| Script | Purpose |
|--------|---------|
| `chatgpt_browser_agent.mjs` | Main prepare/submit/recover/inspect CLI used by the shell wrapper. Supports `--deep-research` on submit. |
| `cdp_set_model_pro.mjs` | Verify or set the composer to Extended Pro/Pro before submissions. |
| `cdp_check_chat_model.mjs` | Inspect an existing chat for model/effort hints after submission. |
| `list_sources.mjs` | List visible durable project sources. |
| `cdp_add_source.mjs` | Add durable project sources (with optional `--on-duplicate replace`). |
| `cdp_remove_source_v2.mjs` | Remove durable project sources (lib handles confirmation dialogs). |
| `cdp_refresh_sources.mjs` | Remove → sleep → re-add cycle to bust ChatGPT's per-chat source cache. |
| `cdp_submit.mjs` | Lower-level single prompt submitter; supports `--deep-research`. |
| `cdp_submit_batch.mjs` | Sequential parallel-prompt dispatcher (post-refactor: now actually works; the pre-refactor version spawned a nonexistent target). |
| `wait_chat_done.mjs` | Chat-ID-pinned poller/dumper for a known chat URL (uses lib's hardened poll). `--deep-research` keeps it waiting through DR's stop-button-less research phase. |
| `harvest_deep_research.mjs` | Harvest a **Deep Research** chat whose report is in a canvas/artifact. `--repost-now` (after research is confirmed done) reposts the packet inline, then captures it. See "Model modes" → DR harvest. |
| `cdp_inspect_chat.mjs` | Read-only live chat inspection. |
| `cdp_dump_chat.mjs` | Dump every message (user + assistant) of a chat. |
| `cg_create_project.mjs` | Project creation/provisioning helper, not part of the normal role loop. |
| `provision_inits.mjs` | Bulk INIT provisioning helper for prepared project folders, not part of the normal role loop. |

Treat `_*.mjs` and one-off diagnostic files as diagnostics, not standard workflow commands; do not commit them unless they are promoted into the documented workflow.

**Maintenance rule:** when ChatGPT's DOM changes again, fix it in the relevant `lib/*.mjs` file only. Do not duplicate DOM logic in entry-point scripts.

## Model modes

Two model modes are wired through the browser scripts:

| Mode | Used for | Wall-clock | How to invoke |
|---|---|---|---|
| **Sol Pro** (legacy name "Extended Pro") | All analytical roles (formalizer, searcher, breakdown, prover, reviewer, consolidator, gatekeeper) and the Lean roles. The pipeline default. | 8–20 min | Default. No flag. |
| **Deep Research** | Literature role only (`02_literature_soft.md`). Web-browsing + multi-source synthesis with citations. | 5–30 min (occasionally 45) | Pass `--deep-research` to `chatgpt_browser_agent.sh submit` or `cdp_submit.mjs`. |

The `/submit-role` skill picks the right flag based on the prompt file. If you invoke the browser scripts manually, the rule is: literature ⇒ DR; everything else ⇒ Extended Pro.

DR jobs do **not** use the same pill enforcement as Extended Pro. The `ensureDeepResearch` function in `lib/model_pill.mjs` handles the DR-specific composer toggle, verified live against `chatgpt.com` on 2026-05-26:

- DR is toggled via `[role="menuitemradio"]` (text "Deep research") inside the composer "+" button menu.
- Active state is detected via the composer chip with `aria-label="Deep research, click to remove"` (the menuitemradio's `aria-checked` lies — don't trust it).
- The pill reads "Pro" (not "Extended Pro") while DR is active. `ensureExtendedPro` therefore explicitly toggles DR off via the chip before its pill-based fast path; otherwise a DR-active session would silently pass for "Extended Pro" and submit on the wrong mode.

DR DOM is more stable than the model-picker DOM has been historically, but if ChatGPT changes it again, update `lib/model_pill.mjs` only.

**Harvesting a DR chat is different from Extended Pro** (investigated + solved live
2026-05-27; heavy DR reports need the canvas → inline-repost flow described below):

- DR's research phase shows a plan/activity UI and **no stop button**, so
  `isGenerating` reads `false` the whole time it works. `cdp_submit.mjs` therefore
  prints `Generating: NO` right after a DR submit — that is expected, not a failure.
  `isDeepResearchWorking` (lib/model_pill.mjs) is the substitute "still working"
  signal, and `wait_chat_done.mjs --deep-research` ORs it into the generating check
  so the poller does not declare "done" during research.
- **A heavy DR job delivers its report as a canvas / artifact "document"** (collapsed card
  titled by the report's first heading, with download + expand icons, e.g.
  *"Research completed in 19m · 12 citations · 131 searches"*), **not** as chat text. While
  collapsed the report markdown is **not in the chat DOM**, so `latestAssistantText`
  (assistant-role attr / `article` scan / body scrape) returns empty and
  `wait_chat_done.mjs --deep-research` will WAIT then TIME OUT even though the report is
  finished. Only a trivial DR query (which skips the canvas flow) answers inline.
- The copy button does **not** write to the OS clipboard under CDP (even with
  `clipboard-read`/`clipboard-write` granted), so clipboard extraction is a dead end on
  this transport — this is why `extractAssistantResponse`'s clipboard path is macOS-only.
  A Windows `Get-Clipboard` path was tried 2026-05-27 and abandoned: the JS-clicked copy is
  a no-op under CDP, so the OS clipboard returns STALE content. Non-darwin falls back to innerText.
- DR chat DOM is genuinely **flaky across reloads** (the canvas card appears/vanishes;
  content lazy-renders only when the document is opened) — the "open it twice / refresh the
  URL" behavior operators have hit.
- **HARVEST THE CANVAS with `harvest_deep_research.mjs --repost-now`.** It turns DR off and
  asks the model to reproduce the finished packet INLINE as a plain-markdown message, which
  renders as a normal assistant turn that `latestAssistantText` captures cleanly (validated
  8.4 KB packet, all sections + citations + final marker). **Run it only once you have
  confirmed research finished** (look at the chat — the canvas card / "Research completed"
  line is shown); reposting mid-research would toggle DR off and disrupt the running job.
  This operator-confirmed flow is intentional — blind DR-completion detection is unreliable
  because the canvas UI is virtualized (`--auto-wait` exists but is best-effort/experimental).
- Caveat: the repost is a faithful model reproduction, not the byte-identical canvas. For
  citation-critical packets, spot-check against the open canvas document.

All CDP helpers require Chrome running with `--remote-debugging-port=PORT` and Playwright installed in `scripts/chatgpt_browser_agent/node_modules/`.

**Tab hygiene (2026-06-12):** entry scripts close the tabs they create. `cdp_submit.mjs` closes its tab right after the chat URL is captured (generation continues server-side; pass `--keep-tab` to watch it live). `wait_chat_done.mjs` closes its page on done/timeout (`--keep-tab` to opt out); a page it merely *found* already on the chat is left alone. `cdp_inspect_chat.mjs` / `cdp_dump_chat.mjs` open a dedicated page and close it on exit — they must never navigate an existing tab, which could be a poller's pinned chat tab. Steady state per project Chrome: one project tab plus one tab per *currently-polled* chat.

## Chrome CDP Port Management

Each proof project must run in its **own Chrome instance** on a **unique port** to avoid interfering with other sessions. Never attach to or reuse a Chrome window belonging to another project.

**Launching a new session:**
```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --remote-debugging-port=PORT \
  --user-data-dir="$HOME/.mathpipeprover/chrome-PROJECT-profile" \
  --no-first-run --no-default-browser-check \
  "https://chatgpt.com/" &
```

**Rules:**
- **Check existing ports first** — `netstat -ano | grep LISTEN | grep 922` to see what's in use.
- **One port per project** — never share ports across proof projects.
- **Separate profile directories** — each project gets its own `--user-data-dir` under `~/.mathpipeprover/`.
- **Inherit authentication** — to avoid re-login, copy cookies from an existing authenticated profile:
  ```bash
  # Copy auth files from an existing profile
  cp SOURCE_PROFILE/"Local State" TARGET_PROFILE/   # cookie-encryption key — REQUIRED
  cp -r SOURCE_PROFILE/Default/Network/Cookies TARGET_PROFILE/Default/Network/
  cp -r SOURCE_PROFILE/Default/"Local Storage" TARGET_PROFILE/Default/
  cp -r SOURCE_PROFILE/Default/IndexedDB TARGET_PROFILE/Default/
  cp -r SOURCE_PROFILE/Default/"Session Storage" TARGET_PROFILE/Default/
  ```
  Then launch Chrome with the new profile. The ChatGPT session will be pre-authenticated.
  **The profile-root `Local State` file is load-bearing** (verified 2026-06-12): Chrome
  encrypts `Cookies` with the `os_crypt` key stored there. Copying `Default/` alone yields
  a logged-out session because the new profile generates a fresh key and cannot decrypt
  the copied cookies. Copy `Local State` BEFORE the first launch of the new profile (or
  kill Chrome, copy both `Local State` + `Cookies`, relaunch).
- **Never kill other projects' Chrome processes** — always identify by port/PID before stopping.
- **Record port assignments** in the run's session info and in the memory system.

## Model Configuration — CRITICAL

The browser scripts enforce the current **Sol Pro target** (a.k.a. **GPT 5.6 Sol Pro**; UI verified live 2026-07-13):

1. **Reasoning / Intelligence:** `Pro` (the top lane of the "Intelligence" picker)
2. **Model:** `GPT-5.6 Sol` (shown on the picker's bottom model-submenu row; read-only — never probe/hover the submenu, it hangs)

The composer pill reads **"Pro"** when this target is set. `Extra High`, `High`, `Medium`, `Instant`, or any other lane is weaker (`Instant` additionally runs the older GPT-5.5). Always verify before submitting.

**Terminology note:** "Extended Pro" was the pre-2026-07 name of this target (`Pro Extended` lane on GPT-5.5) and no longer exists in the ChatGPT UI. Docs, prompt templates, function names (`ensureExtendedPro`), and slash commands (`/set-model-extended`) keep the legacy name — wherever you see "Extended Pro", read "the Sol Pro target" (Pro lane on GPT-5.6 Sol). `lib/model_pill.mjs` warns if the picker's base-model row stops reading GPT-5.6 Sol (set `MPP_STRICT_BASE_MODEL=1` to make that fatal).

## Key Documentation

- `docs/soft_scaffolding.md` — primary smart-scaffolding operating guide
- `docs/browser_chatgpt.md` — browser transport and recovery (used by smart scaffolding)

## Durable Source Housekeeping

The orchestrator is responsible for keeping the ChatGPT project's **Sources** tab clean and current. This is not optional — stale or bloated project sources degrade every subsequent role's output.

**What belongs in durable sources** (4–6 files max):
- The paper PDF/md or conjecture statement
- A current proof-state file (updated after accepted results)
- The active route memo (only one — remove stale route memos before adding a new one)
- The objective/claim file

**What does NOT belong in durable sources:**
- Per-step packets, logs, or prover drafts (these go as composer attachments)
- Files from completed or pruned branches
- Multiple versions of the same document

**When to act:**
- After a branch completes or is pruned: remove its route memo from sources
- After a route pivot: swap the old route memo for the new one
- After a consolidator pass produces a new proof-state: refresh the proof-state source
- After scope changes: update the objective/claim if it has narrowed

**How to act:**
Use the browser agent's `--add-source` and `--remove-source` flags directly, or invoke the `/set-sources` slash command from the orchestrator session.

## Lean formalization

A Lean 4 / Mathlib post-processing module sits on top of the smart-scaffolding pipeline. It runs **after** a branch has been consolidated and produces a checked Lean artifact for the proved result.

- **Conceptual pipeline guide**: `docs/lean_pipeline.md` — READ THIS FIRST. Describes phases, per-lemma parallel branches (brainstorm → prove → review → compile → verify), gold-check asymmetry (Lean ⊆ English = FAIL; Lean ⊇ English = PASS-FLAG), orchestrator routing, audit ledger, smuggling taxonomy. Captures the PIOTR v9 (2026-05-23) session lessons.
- **Operating guide**: `docs/lean_formalization.md` — implementation details for AXLE, INVENTORY.lean conventions, state file format.
- **AXLE client.** `mathpipeprover/axle.py` wraps the AXLE Lean verification API (`https://axle.axiommath.ai/v1/docs/`). Shell surface: `mpp axle {environments,smoke,check,verify-proof,sorry2lemma,repair-proofs,merge,disprove,extract-decls}` — see `mpp axle --help`.
- **Role templates** in `prompts/soft/80-8f_lean_*_soft.md` — generators + reviewers for structurer, dep_audit, formalizer, meaning_check, prover (80–88), plus auditors: inventory_match (89), headline_translation (8a), smuggling_check (8b), design_brainstorm (8c), per-theorem audit (8d), paper feedback (8e), gold check (8f). All translation-discipline prompts include `prompts/fragments/lean_translation_discipline.md`.
- **Orchestrator skills** in `.claude/commands/lean-*.md`: `/lean-formalize-init`, `/lean-structure`, `/lean-dep-audit`, `/lean-verify-deps`, `/lean-formalize`, `/lean-prove-lemma`, `/lean-merge`, `/lean-final-check`, `/lean-status`, `/lean-inventory-match`, `/lean-headline-translation`, `/lean-smuggling-check`. The verification step (`/lean-verify-deps`) spawns a Codex CLI 5.5 thread (or Opus 4.7 sub-agent fallback) to iterate AXLE checks without round-tripping through Extended Pro.
- **Browser tooling** in `scripts/chatgpt_browser_agent/`: `cdp_refresh_sources.mjs` (cache-bust + re-upload), `wait_chat_done.mjs` (chat-ID-pinned poller, hardened 2026-05-23), and `cdp_submit_batch.mjs` only after validating it against the current submit helper.

Lean formalization is the main exception to the no-subagents rule: subagents may be used for Lean/Mathlib search, AXLE iteration, and Lean proof-file engineering. That exception does not apply backward to formal analytical proof roles; those stay on Extended Pro.

**Setup the orchestrator should verify before invoking Lean tooling:**

- `AXLE_API_KEY` must be in `.env` (auto-loaded by the CLI). Get a key at `https://axle.axiommath.ai/app/console`.
- Default Lean toolchain is `lean-4.29.0`. Override per-call with `--environment` or globally via `AXLE_DEFAULT_ENV`.
- Per-paper Lean state lives in `{PROOF_REPO}/lean/` (NOT inside MathPipeProver). Audit trail at `{PROOF_REPO}/lean/axle_log.jsonl` — pass `--log-path` to `mpp axle …` to populate it.

**What AXLE does *not* do.** AXLE does not translate English to Lean and does not search for proofs (`repair_proofs` is single-tactic-shot, default `grind`). All formalization and proof-search intelligence lives in LLM roles (Extended Pro via `external_agent`) — AXLE is the compile/verify backend only. AXLE also cannot import non-Mathlib libraries: support lemmas must be inlined into the submitted source, and load-bearing non-Mathlib results live in `{PROOF_REPO}/lean/support/INVENTORY.lean` and are prepended/merged at submit time.

**Exit codes for `mpp axle check` and `mpp axle verify-proof`:** 0 = compile succeeded; 2 = HTTP succeeded but Lean compile failed (`okay: false`); 1 = transport/auth/network error. Skills can branch on these.
