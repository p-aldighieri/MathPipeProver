# MathPipeProver

MathPipeProver is a markdown-first proof workflow harness.

It is designed for fast experimentation with role-based proving pipelines while preserving branch-level context, scope controls, and resumable runs.

## What it does now

- CLI commands: `run`, `resume`, `inspect`, `report`, `smoke-providers`
- Policy modes: `strict`, `semi_strict`, `flexible`
- Cheap-model workflow router (`workflow_router`) emits structured decisions (`{"next":"TAG"}`)
- Multi-branch strategy execution with branch pruning to `max_branches`
- Branch-specific markdown context pools
- Scope reconciliation via lightweight tags (`[SCOPE]`, `[ASSUMPTION+]`, `[ASSUMPTION-]`)
- Assumption delta and knowledge ledger files per branch
- Prover can amend breakdown using `[BREAKDOWN_AMEND]`
- Resumable run state (`run_state.json`)
- Real provider adapters for OpenAI, Anthropic, and Gemini
- Optional `external_agent` provider path (request/response files for browser-agent workflows)
- Browser ChatGPT runner for the `external_agent` path via `scripts/chatgpt_browser_agent.sh`
- Heartbeat watcher and auto-resume supervisor for long-running browser roles
- Prompt templates in `prompts/`
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

See `config/default.toml`:
- workflow mode
- router enable/disable and prompt root
- token/call budget limits
- max prover/reviewer cycles
- max branch fan-out
- per-role provider/model/temperature config
- per-role file read/write patterns
- smoke-test model selection
- provider options (`stub`, `openai`, `anthropic`, `gemini`, `external_agent`)

CLI behavior:
- If a local `.env` exists in the project root, it is loaded automatically (overriding current shell values).

## Browser ChatGPT mode

This repo now includes a first browser-backed implementation for the existing `external_agent` seam.

Key pieces:

- config profile: `config/browser_chatgpt.toml`
- browser runner: `scripts/chatgpt_browser_agent.sh`
- heartbeat watcher: `scripts/chatgpt_heartbeat_watch.sh`
- auto-resume supervisor: `scripts/chatgpt_browser_supervisor.sh`
- detailed usage: `docs/browser_chatgpt.md`

The intended loop is:

1. Run `mpp run` or `mpp resume` with `config/browser_chatgpt.toml`.
2. MathPipeProver pauses with status `waiting_external_agent` when a role response is missing.
3. Either fulfill the pending request manually with `scripts/chatgpt_browser_agent.sh submit ...` or let `scripts/chatgpt_browser_supervisor.sh` own the submit/watch/resume loop.
4. If you use the supervisor, it watches the heartbeat JSON, relaunches after stale/error states, and resumes the run as soon as the response file is ready.

This first pass hard-codes the browser model policy to `ChatGPT 5.4 Pro` and the browser effort policy to `Extended Pro`.
If ChatGPT or Cloudflare blocks the Playwright-owned profile, use `scripts/chatgpt_browser_cdp.sh` and attach the runner with `--cdp-url http://127.0.0.1:9222`.
Browser submits now default to a 90-minute wait budget and maintain a heartbeat JSON beside each response file while waiting.

Operational rules for proof work:

- Role context is never truncated. If a request is too large, narrow the role scope or attach the full working files in the browser workflow.
- Maintain a durable proof-state source that records the active route, current skeleton, lemma status, and trustworthy reviewer verdicts.
- Do not restart from `formalizer` when a late-stage branch already exists. Re-review the latest full prover artifact first if an earlier reviewer packet may have been tainted by missing context.
- Prefer lemma-scoped prover cycles and delta-scoped reviewer cycles over one-shot full-proof requests.
- Keep routing decisions and breakdown approval under orchestrator review even if the browser loop is automated.

## Planning docs

- Main roadmap: `PLAN.md`
- Execution checklist: `TODO.md`
- Scaffold review: `docs/scaffolding_review.md`
- Mode and governance details: `docs/modes_and_governance.md`
- Browser ChatGPT workflow: `docs/browser_chatgpt.md`
