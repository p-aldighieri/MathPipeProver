# MathPipeProver

Automated proof orchestration pipeline with browser-backed soft scaffolding.

The soft-scaffolding orchestrator is expected to act intelligently, not mechanically.
It should synthesize proof-state, reviewer verdicts, route obstructions, and current branch value before choosing the next role.
Do not merely relay model outputs or follow stale pipeline momentum when the mathematical frontier has already shifted.

## Slash Commands

Available via `.claude/commands/`:

| Command | Description |
|---------|-------------|
| `/set-model-extended` | Set ChatGPT to **Extended Pro** (Pro model + Extended effort). MUST run before any submission. |
| `/submit-role` | Submit a proof role prompt to a ChatGPT project. Verifies Extended Pro, sends, reports chat URL. |
| `/set-sources` | Add/remove durable files in a ChatGPT project's Sources tab. |
| `/inspect-chat` | Read-only check of a live chat's generation status. |
| `/recover-chat` | Extract a completed response from a chat URL and save to file. |
| `/heartbeat` | Start a 30-min recurring orchestrator heartbeat loop. |

## CDP Browser Scripts

Located in `scripts/chatgpt_browser_agent/`:

| Script | Usage |
|--------|-------|
| `cdp_set_model_pro.mjs` | `node cdp_set_model_pro.mjs --port PORT` — Set Extended Pro (two-step: model + effort) |
| `cdp_submit.mjs` | `node cdp_submit.mjs --project-url URL --port PORT [--check-effort] prompt.md` |
| `cdp_add_source.mjs` | `node cdp_add_source.mjs --project-url URL --port PORT file1 file2 ...` |

All scripts require Chrome running with `--remote-debugging-port=PORT` and Playwright installed in `scripts/chatgpt_browser_agent/node_modules/`.

## Model Configuration — CRITICAL

**Extended Pro** requires TWO settings (they are independent):
1. **Model**: Click "ChatGPT ˅" header dropdown → select **"Pro"** (NOT "Thinking")
2. **Effort**: Click the "Pro >" pill in the composer → select **"Extended"**

The composer pill must show **"Extended Pro"**. "Thinking + Heavy" is a DIFFERENT, weaker model. Always verify before submitting.

## Key Documentation

- `docs/soft_scaffolding.md` — browser-orchestrated proof workflow guide
- `docs/browser_chatgpt.md` — ChatGPT browser agent operations

## Session-Bridge Architecture (Supervisor Flow)

The production soft-scaffolding flow uses a **supervisor daemon** that owns the full
automation loop. Claude sessions are short-lived workers, not long-running orchestrators.

### How it works

1. The **supervisor** (a background Python process) detects a pending external-agent task.
2. The supervisor launches the **browser agent** to submit to ChatGPT and poll heartbeats.
3. The supervisor **waits** for the heartbeat to reach completion (this can take 30–60+ min for Extended Pro).
4. On completion, the supervisor **wakes a Claude CLI session** with a resume prompt.
5. The Claude session runs `mpp resume`, inspects the result, makes any orchestrator decision, and **exits immediately**.
6. The supervisor picks up the next pending task and loops back to step 1.

### Rules for the resumed Claude session

When you are woken up by the supervisor:

- **Do NOT watch heartbeats.** The supervisor owns heartbeat polling. Never call `wait_for_completion` or block on heartbeat files.
- **Do NOT submit to the browser.** The supervisor owns browser submission. Never launch the browser agent or interact with ChatGPT directly.
- **Do NOT linger.** Run the resume command, make your orchestrator decision, and exit. The supervisor will wake you again when the next response is ready.
- **Keep context clean.** Each wake-up is a fresh prompt. Read only the files you need for the current decision. Do not accumulate stale proof state across resumes.
- **Act as orchestrator, not relay.** When the run reaches `waiting_orchestrator`, read the latest reviewer/scope files and make a real judgment call: continue, pivot, or stop. Do not mechanically continue if the route is dead.
- **Manage durable source files.** Before exiting, assess whether the ChatGPT project's durable sources need updating for the next role. See the source housekeeping section below.

### Durable Source Housekeeping

The orchestrator is responsible for keeping the ChatGPT project's **Sources** tab clean and current. This is not optional — stale or bloated project sources degrade every subsequent role's output.

**What belongs in durable sources** (4–6 files max):
- The paper PDF or conjecture statement
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
