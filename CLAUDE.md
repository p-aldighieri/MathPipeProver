# MathPipeProver

MathPipeProver's primary operating model is smart soft scaffolding: a Claude Code or Codex orchestrator stays mathematically engaged, curates the browser context, and decides what happens next. Other modes are specific variants of that baseline, not the other way around.

### Mode A — Smart soft scaffolding (default)

A long-running Claude or Codex session acts as the proof operator. It reads proof state, synthesizes reviewer verdicts, narrows scope, refreshes durable sources, repairs browser state, and submits focused roles to ChatGPT Extended Pro through the browser tooling. This is the repository's main mode. Pair it with browser-backed configs, `prompts_soft/`, and orchestrator-reviewed stops (`orchestrator_controls_stop = true`) whenever you want the orchestrator to stay in charge.

### Mode B — Supervisor-assisted soft scaffolding

This keeps the same smart soft-scaffolding philosophy, but a **supervisor daemon** owns the submit/watch/resume loop. Roles are submitted to ChatGPT Extended Pro via browser agent scripts, and the supervisor keeps auto-resuming until the run either finishes or returns a `waiting_orchestrator` handoff for a human-visible Claude or Codex session to judge. Use `config/browser_chatgpt_soft.toml` with `orchestrator_controls_stop = true`. Prompts come from `prompts_soft/` (browser-optimized), and every completed soft role hands control back to the orchestrator.

### Mode C — Full API pipeline (hands-off)

Fully automated, no browser, no human-visible orchestrator in the loop. All roles (formalizer, searcher, prover, reviewer, consolidator) run via API providers (OpenAI, Anthropic, Gemini). The pipeline uses built-in phase transitions and reviewer control hints instead of a separate router role. Use configs like `config/production.toml` or `config/default.toml`. Prompts come from `prompts/` (structured for API consumption). Run with `mpp run` / `mpp resume`.

**In every mode**, the orchestrator is expected to act intelligently, not mechanically. It should synthesize proof-state, reviewer verdicts, route obstructions, and current branch value before choosing the next role. Do not merely relay model outputs or follow stale pipeline momentum when the mathematical frontier has already shifted.

## Orchestrator Discipline

These apply in every mode. They are the difference between a smart orchestrator and a relay.

- **Inspect base files before acting.** Before executing any user task brief, read the target source file (manuscript, conjecture statement, draft .tex / .pdf) end to end and extract every embedded comment, RED note, TODO, FIXME, "tasks for AI" block, and in-prose question. Treat each as a task item even when it does not appear in the user's brief — these author requests are easy to miss because they live in the source, not the prompt.
- **Ask for parseable output.** Submit role prompts that ask GPT Extended Pro for results in clearly-delimited blocks (the templates in `prompts_soft/` already do this). Without delimited output, dumps are slow and error-prone to parse. If you find yourself improvising a parse, the prompt template is what needs fixing.
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
| `/heartbeat` | Start a 30-min recurring Mode A orchestrator heartbeat loop. |

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

- `docs/soft_scaffolding.md` — primary Mode A operating guide
- `docs/browser_chatgpt.md` — browser transport and recovery for Mode A/B

## Supervisor Automation (Mode B only — Supervisor-assisted Variant)

The supervisor-assisted soft-scaffolding flow uses a **supervisor daemon** that owns the
browser submit/watch/resume loop. The human-visible Claude or Codex orchestrator is not
kept alive as a blocked worker; the supervisor runs until the pipeline either finishes or
hands control back at `waiting_orchestrator`. This is a specialized execution pattern of
Mode A, not the primary identity of the repo.

**This section applies only to Mode B.** In Mode A, the Claude or Codex session is
long-running and handles submission and monitoring directly. In Mode C, the workflow is
API-only and does not use the browser transport at all.

### How it works

1. The **supervisor** (a background Python process) detects a pending external-agent task.
2. The supervisor launches the **browser agent** to submit to ChatGPT and poll heartbeats.
3. The supervisor **waits** for the heartbeat to reach completion (this can take 30–60+ min for Extended Pro).
4. On completion, the supervisor runs `mpp resume` itself.
5. If the resumed run returns to `waiting_external_agent`, the supervisor loops back to step 1.
6. If the resumed run reaches `waiting_orchestrator`, the supervisor stops and hands control back to a human-visible orchestrator session.

### When Control Returns To The Orchestrator

When the supervisor exits at `waiting_orchestrator`:

- **Do NOT rebuild stale browser assumptions.** First inspect the latest run state, reviewer files, and source-update needs.
- **Act as orchestrator, not relay.** When the run reaches `waiting_orchestrator`, read the latest reviewer/scope files and make a real judgment call: continue, pivot, or stop. Do not mechanically continue if the route is dead.
- **Resume the supervisor only after your decision.** If you continue the run and it returns to `waiting_external_agent`, you can start the supervisor again to own the next submit/watch/resume cycle.
- **Manage durable source files.** Before exiting, assess whether the ChatGPT project's durable sources need updating for the next role. See the source housekeeping section below.

### Durable Source Housekeeping

The orchestrator is responsible for keeping the ChatGPT project's **Sources** tab clean and current. This is not optional — stale or bloated project sources degrade every subsequent role's output.

**What belongs in durable sources** (4–6 files max):
- The paper PDF/md or conjecture statement
- A current proof-state file (updated after accepted results)
- The active route memo (only one — remove stale route memos before adding a new one)
- The objective/claim file

**What does NOT belong in durable sources:**
- Per-step packets, logs, or prover drafts (these go as composer attachments, managed by the browser agent)
- Files from completed or pruned branches
- Multiple versions of the same document

**When to act:**
- After a branch completes or is pruned: remove its route memo from sources
- After a route pivot: swap the old route memo for the new one
- After a consolidator pass produces a new proof-state: refresh the proof-state source
- After scope changes: update the objective/claim if it has narrowed

**How to act:**
Use the browser agent's `--add-source` and `--remove-source` flags. When the orchestrator
determines that sources need updating, it should write a source-update manifest at
`runs/<run>/source_update_pending.json` with the changes needed. The supervisor will
pick this up on the next submission cycle.

### Heartbeat file locations

Heartbeat files are written next to the response file:
- `runs/<run>/branches/<branch>/external_agent/{role}_response_heartbeat.json`
- Response at: `runs/<run>/branches/<branch>/external_agent/{role}_response.md`
