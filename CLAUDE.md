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

The old recurring `/heartbeat` watcher loop is deprecated for normal proof sessions. Use the browser agent's heartbeat JSON, `/inspect-chat`, and `/recover-chat` instead; create an explicit reminder or automation only when the user asks for one.

## CDP Browser Scripts

Prefer the wrapper `scripts/chatgpt_browser_agent.sh` for normal proof work:

- `prepare --project-url URL [--cdp-url URL] [--add-source PATH ...] [--remove-source NAME ...]`
- `submit --project-url URL --request-file PATH --response-file PATH [--cdp-url URL] [--attach-file PATH ...]`
- `recover --chat-url URL --response-file PATH [--cdp-url URL]`
- `inspect --chat-url URL [--cdp-url URL]`

Current `.mjs` helpers live in `scripts/chatgpt_browser_agent/`:

| Script | Purpose |
|--------|---------|
| `chatgpt_browser_agent.mjs` | Main prepare/submit/recover/inspect implementation used by the shell wrapper. |
| `cdp_set_model_pro.mjs` | Verify or set the composer to the current Pro/Extended Pro target before submissions. |
| `cdp_check_chat_model.mjs` | Inspect an existing chat for model/effort hints after submission. |
| `list_sources.mjs` | List visible durable project sources. |
| `cdp_add_source.mjs` | Add durable project sources. |
| `cdp_remove_source_v2.mjs` | Remove durable project sources with confirmation-dialog handling. |
| `cdp_refresh_sources.mjs` | Remove, pause, and re-add source files to avoid stale ChatGPT source caches. |
| `cdp_submit.mjs` | Lower-level single prompt submitter; Extended Pro enforcement is built in. |
| `cdp_submit_trustpill.mjs` | Project-specific diagnostic submitter that trusts a visible Pro pill. Not part of the standard workflow. |
| `cdp_submit_batch.mjs` | Legacy batch helper for parallel prompt dispatch; validate it against the current submit helper before relying on it. |
| `wait_chat_done.mjs` | Chat-ID-pinned poller/dumper for a known chat URL. |
| `cdp_inspect_chat.mjs` | Read-only live chat inspection. |
| `cdp_dump_chat.mjs` | Dump assistant text from a known chat when normal harvest fails. |
| `cg_create_project.mjs` | Project creation/provisioning helper, not part of the normal role loop. |
| `provision_inits.mjs` | Bulk INIT provisioning helper for prepared project folders, not part of the normal role loop. |

Treat `_*.mjs`, `cdp_inspect_actions_menu.mjs`, and one-off diagnostic files as diagnostics, not standard workflow commands.

All CDP helpers require Chrome running with `--remote-debugging-port=PORT` and Playwright installed in `scripts/chatgpt_browser_agent/node_modules/`.

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
  cp -r SOURCE_PROFILE/Default/Network/Cookies TARGET_PROFILE/Default/Network/
  cp -r SOURCE_PROFILE/Default/"Local Storage" TARGET_PROFILE/Default/
  cp -r SOURCE_PROFILE/Default/IndexedDB TARGET_PROFILE/Default/
  cp -r SOURCE_PROFILE/Default/"Session Storage" TARGET_PROFILE/Default/
  ```
  Then launch Chrome with the new profile. The ChatGPT session will be pre-authenticated.
- **Never kill other projects' Chrome processes** — always identify by port/PID before stopping.
- **Record port assignments** in the run's session info and in the memory system.

## Model Configuration — CRITICAL

The browser scripts enforce the current **Extended Pro target**:

1. **Reasoning:** `Pro`
2. **Model:** `5.5`

The composer pill may read simply **"Pro"** when this target is set. "Thinking + Heavy", `High`, `Medium`, or any non-Pro reasoning mode is a weaker lane. Always verify before submitting.

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

## Browser heartbeat files

Heartbeat JSON files are written next to the response file by the browser agent:
- `runs/<run>/branches/<branch>/external_agent/{role}_response_heartbeat.json`
- Response at: `runs/<run>/branches/<branch>/external_agent/{role}_response.md`

These files are passive telemetry for recovery and status checks. Do not start the deprecated recurring `/heartbeat` watcher loop as part of the standard workflow. If you want a blocking shell wait, `mpp watch-heartbeat` (or `chatgpt_heartbeat_watch.sh`) can poll one heartbeat without resuming or routing the proof automatically.

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
