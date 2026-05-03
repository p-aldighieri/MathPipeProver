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
- **Ask for parseable output.** Submit role prompts that ask GPT Extended Pro for results in clearly-delimited blocks (the templates in `prompts/soft/` already do this). Without delimited output, dumps are slow and error-prone to parse. If you find yourself improvising a parse, the prompt template is what needs fixing.
- **Commit at meaningful checkpoints.** Commit in the proof repo (not MathPipeProver) at the end of each verified unit, scope shift, or major artifact production. The proof repo is the durable record of mathematical progress; MathPipeProver is the toolchain. Do not let unstaged proof work accumulate across multiple verified results.
- **Parallelize carefully.** You may run two subtasks in parallel when they are genuinely independent and the marginal context cost is justified (e.g., two unrelated reviewer verdicts in flight against different verification units). Keep an explicit log of which run owns which durable project source vs. which prompt-specific attachment, so concurrent runs do not collide on shared sources. When in doubt, sequence.

## Slash Commands

Available via `.claude/commands/`:

| Command | Description |
|---------|-------------|
| `/set-model-extended` | Set ChatGPT to **Extended Pro** (Pro model + Extended effort). MUST run before any submission. |
| `/submit-role` | Submit a proof role prompt to a ChatGPT project. Verifies Extended Pro, sends, reports chat URL. |
| `/set-sources` | Add/remove durable files in a ChatGPT project's Sources tab. |
| `/inspect-chat` | Read-only check of a live chat's generation status. |
| `/recover-chat` | Extract a completed response from a chat URL and save to file. |
| `/heartbeat` | Start a 30-min recurring smart-scaffolding orchestrator heartbeat loop. |

## CDP Browser Scripts

Located in `scripts/chatgpt_browser_agent/`:

| Script | Usage |
|--------|-------|
| `cdp_set_model_pro.mjs` | `node cdp_set_model_pro.mjs --port PORT` — Set Extended Pro (two-step: model + effort) |
| `cdp_submit.mjs` | `node cdp_submit.mjs --project-url URL --port PORT [--check-effort] prompt.md` |
| `cdp_add_source.mjs` | `node cdp_add_source.mjs --project-url URL --port PORT file1 file2 ...` |

All scripts require Chrome running with `--remote-debugging-port=PORT` and Playwright installed in `scripts/chatgpt_browser_agent/node_modules/`.

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

**Extended Pro** requires TWO settings (they are independent):
1. **Model**: Click "ChatGPT ˅" header dropdown → select **"Pro"** (NOT "Thinking")
2. **Effort**: Click the "Pro >" pill in the composer → select **"Extended"**

The composer pill must show **"Extended Pro"**. "Thinking + Heavy" is a DIFFERENT, weaker model. Always verify before submitting.

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

## Heartbeat file locations

Heartbeat JSON files are written next to the response file by the browser agent:
- `runs/<run>/branches/<branch>/external_agent/{role}_response_heartbeat.json`
- Response at: `runs/<run>/branches/<branch>/external_agent/{role}_response.md`

Use `mpp watch-heartbeat` (or the `chatgpt_heartbeat_watch.sh` wrapper) to poll a heartbeat from a shell when you want a blocking "wait for completion" helper instead of in-orchestrator polling.
