# MathPipeProver

MathPipeProver is a markdown-first proof workflow harness for soft scaffolding under a smart Claude Code or Codex orchestrator.

The repository's primary operating model is not the hands-off API lane. It is the browser-backed loop where the orchestrator curates route, scope, context, durable sources, and recovery while ChatGPT Extended Pro handles focused proof roles.

## Requirements

Core: Python 3.11+ (for the `mpp` CLI), Node.js 20+ and Chrome (for the browser-backed `external_agent` transport in `scripts/chatgpt_browser_agent/`).

External CLIs for the `/search-council` re-attack skill (each council member is an independent CLI; **all are optional** — a missing one is dropped with `--skip-member <name>` and the council runs with the rest):

| Member | CLI | Install | Auth |
|--------|-----|---------|------|
| Codex | `codex` | OpenAI Codex CLI | per Codex CLI |
| Gemini | `gemini` | `npm install -g @google/gemini-cli` | run `gemini` once (Google OAuth) or set `GEMINI_API_KEY` |
| Opus | `claude` | Claude Code CLI | per Claude Code |
| Extended Pro | — | browser transport (`scripts/chatgpt_browser_agent.sh`) | logged-in ChatGPT session |

If you do not have the Gemini CLI installed/authenticated, the council still works — invoke it with `--skip-member gemini` and it falls back to 1 Codex + 1 Opus + 1 Extended Pro. Installing + authenticating Gemini restores the full four-architecture diversity that makes the council worth its cost.

Windows note: the council adapters are Bash scripts. If `bash` resolves to the WindowsApps/WSL launcher, council members may appear to hang before the CLI runs. Put `C:\Program Files\Git\bin` before `C:\Users\<you>\AppData\Local\Microsoft\WindowsApps` in PATH, or invoke Git Bash explicitly as `C:\Program Files\Git\bin\bash.exe`.

## Starting a new proof project

The fastest path to a fresh orchestrator session is `INIT.md` at the repo root. Copy it into a new Claude Code (or Codex) session, fill in the five mustache slugs (`{{PROOF_REPO}}`, `{{TARGET_FILE}}`, `{{CHATGPT_PROJECT_URL}}`, `{{CDP_PORT}}`, `{{TASK_BRIEF}}`), and the orchestrator will run an 8-step bootstrap before touching the pipeline. `INIT.md` is the per-session ignition; `CLAUDE.md` is the always-loaded reference.

## Operating modes

- **Smart scaffolding (default).** A long-running Claude Code or Codex session acts as the proof operator: it chooses the next role, narrows scope, curates context, refreshes durable sources, repairs browser state, and decides when a route is alive, blocked, or done. This is the headline mode and the one new users should reach for first.
- **API pipeline (hands-off).** All roles run through API providers with built-in phase transitions. No browser, no in-loop orchestrator. Useful when you want a fully automated batch run and are willing to give up the orchestrator's judgment on routing and scope.

## What it does now

- Primary soft-scaffolding workflow for ChatGPT project-based proof work
- Soft prompts are orchestrator-gated: after each completed role, control returns to the smart orchestrator for the next routing decision
- Gatekeeper role runs automatically after each consolidator pass: scope check (not logic audit) comparing original objective against achieved result, with route-level re-attack proposals when the question was narrowed
- CLI commands: `run`, `resume`, `inspect`, `report`, `smoke-providers`
- Governance policy modes: `strict`, `semi_strict`, `flexible`
- Multi-branch strategy execution with branch pruning to `max_branches`
- Branch-specific markdown context pools
- Scope reconciliation via lightweight tags (`[SCOPE]`, `[ASSUMPTION+]`, `[ASSUMPTION-]`)
- Assumption delta and knowledge ledger files per branch
- Prover can amend breakdown using `[BREAKDOWN_AMEND]`
- Resumable run state (`run_state.json`)
- Real provider adapters for OpenAI, Anthropic, and Gemini
- Optional `external_agent` provider path (request/response files for browser-agent workflows)
- Browser ChatGPT runner for the `external_agent` path via `scripts/chatgpt_browser_agent.sh`; all composer DOM logic lives in `scripts/chatgpt_browser_agent/lib/` (single source of truth — when ChatGPT's UI changes, fix the lib once)
- Two model modes wired through the browser: **Extended Pro** for all analytical roles (default, 8–20 min); **Deep Research** for the literature role only (`--deep-research` flag, 5–30 min, web-browsing + multi-source synthesis with citations)
- `/search-council` skill for stalled re-attacks: fans out 1 Codex + 1 Gemini + 1 Opus + 1 Extended Pro (four distinct model architectures) on the same packet, preserves four independent memos, hands off to the regular Strategy Searcher for selection. Opt-in (re-attempt ≥2), ~3× the cost of a single search. The Gemini member needs the Gemini CLI installed + authenticated (see Requirements); skip it with `--skip-member gemini` if unavailable
- Prompt roots in `prompts/soft/` (smart scaffolding) and `prompts/api/` (API pipeline); shared snippets in `prompts/fragments/`
- Token accounting artifacts (`token_usage_summary.json`, `token_events.jsonl`)
- Budget controls (`max_total_tokens`, `max_tokens_per_branch`, `max_total_calls`, `max_calls_per_branch`)

## Why markdown-first

This project intentionally avoids heavy structured output requirements.
Roles produce normal markdown with optional lightweight tags for cheap governance.

## CLI

```bash
mpp run --claim-text "Your theorem here" --config config/default.toml
mpp resume --run-id <run_id> --config config/default.toml
mpp inspect --run-id <run_id> --config config/default.toml
mpp report --run-id <run_id> --config config/default.toml
mpp smoke-providers --config config/default.toml --providers openai anthropic gemini
```

`mpp inspect` includes total token counters for the run.
`mpp report` includes branch outcomes and per-role usage breakdown.

## Configuration highlights

Key profiles:

- `config/browser_chatgpt_soft.toml` for smart soft scaffolding with `prompts/soft/` and `orchestrator_controls_stop = true`
- `config/browser_chatgpt.toml` for the lower-level browser `external_agent` transport loop
- `config/default.toml` and `config/production.toml` for the API-only pipeline

Common configuration controls include:

- workflow policy mode
- prompt root and orchestrator stop controls
- token/call budget limits
- max prover/reviewer cycles
- max branch fan-out
- per-role provider/model/temperature config
- per-role file read/write patterns
- smoke-test model selection
- provider options (`stub`, `openai`, `anthropic`, `gemini`, `external_agent`)

CLI behavior:
- If a local `.env` exists in the project root, it is loaded automatically (overriding current shell values).

## Browser-backed tooling

These scripts are the transport and recovery machinery used by the smart-scaffolding mode. They are not the operating mode themselves.

Key pieces:

- lower-level browser transport profile: `config/browser_chatgpt.toml`
- smart-scaffolding profile: `config/browser_chatgpt_soft.toml`
- browser runner: `scripts/chatgpt_browser_agent.sh`
- detailed usage: `docs/browser_chatgpt.md`

The transport loop is:

1. Run `mpp run` or `mpp resume` with `config/browser_chatgpt.toml`.
2. MathPipeProver pauses with status `waiting_external_agent` when a role response is missing.
3. Fulfill the pending request via `scripts/chatgpt_browser_agent.sh submit ...` (or via the orchestrator's `/submit-role` slash command), then resume.

The smart-orchestrator rules:

- After every completed soft role, control returns to the orchestrator. The orchestrator, not a router prompt, chooses the next pass.
- Role context is never truncated. If a request is too large, narrow the role scope or attach the full working files in the browser workflow.
- Maintain a durable proof-state source that records the active route, current skeleton, lemma status, and trustworthy reviewer verdicts.
- Do not restart from `formalizer` when a late-stage branch already exists. Re-review the latest full prover artifact first if an earlier reviewer packet may have been tainted by missing context.
- Prefer lemma-scoped prover cycles and delta-scoped reviewer cycles over one-shot full-proof requests.
- Keep routing decisions and breakdown approval under orchestrator review even if the browser loop is automated.
- Do not use subagents for analytical proof roles. Formal mathematical arguments, proof repair, route search, and reviewer audits go through ChatGPT Extended Pro; subagents are only for explicit coding/simulation tasks and Lean formalization proof-engineering.

The current browser lane enforces the Extended Pro target: reasoning `Pro` plus model `5.5`.
If ChatGPT or Cloudflare blocks the Playwright-owned profile, use `scripts/chatgpt_browser_cdp.sh` and attach the runner with `--cdp-url http://127.0.0.1:9222`.
Browser submits default to a 90-minute wait budget.
They also accept repeated `--attach-file` arguments so branch-local proof artifacts can travel with a request without becoming durable project sources.

## Key docs

- Per-session bootstrap (copy-paste at session start): `INIT.md`
- Always-loaded orchestrator reference: `CLAUDE.md`
- Smart soft scaffolding guide: `docs/soft_scaffolding.md`
- Browser transport and recovery: `docs/browser_chatgpt.md`
- Governance policy details: `docs/modes_and_governance.md`
- Workflow graphs: `docs/workflow_graph.md`
- Paper workflow status: `docs/paper_pipeline.md`
