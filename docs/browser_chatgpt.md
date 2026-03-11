# Browser ChatGPT Flow

This document describes the first browser-backed implementation for the existing `external_agent` request/response path.

## Why this exists

MathPipeProver already knows how to emit request files and wait for response files when a role uses `provider = "external_agent"`.

The browser runner in `scripts/chatgpt_browser_agent.sh` turns that contract into a ChatGPT-project workflow:

1. Open a ChatGPT project in a persistent browser profile.
2. Ensure the top model picker is `ChatGPT 5.4 Pro`.
3. Ensure the composer pill is set to `Extended Pro`.
4. Optionally add or remove durable project sources.
5. Submit the request markdown from `branches/<branch>/external_agent/<role>_request.md`.
6. Wait for the reply to stabilize.
7. Write the reply to `branches/<branch>/external_agent/<role>_response.md`.
8. Optionally write a JSON session log beside the response file.

For proof projects, keep a durable proof-state markdown file attached as a project source and update it after each accepted reviewer pass or major proof amendment.

## First-run setup

The runner uses a persistent Playwright profile. On the first run:

1. The script opens a browser window.
2. Log into [chatgpt.com](https://chatgpt.com) in that window.
3. The profile is reused automatically for future runs.

Default profile dir:

- `~/.mathpipeprover/chatgpt-profile`

Override with:

- `MPP_CHATGPT_PROFILE_DIR`
- or `--profile-dir`

## Recommended bootstrap when ChatGPT or Cloudflare blocks automation

If the Playwright-managed profile gets stuck on a human-verification step, use a normal Chrome session and let the runner attach to it over CDP instead.

1. Launch a human-controlled Chrome instance with remote debugging:

```bash
scripts/chatgpt_browser_cdp.sh
```

2. In that Chrome window, complete ChatGPT login and any Cloudflare challenge.
3. Leave that Chrome window open.
4. Run the browser agent with `--cdp-url "http://127.0.0.1:9222"`.

This avoids the separate Playwright-owned browser profile entirely.

## Commands

### Prepare the project

Use this to open the project, pin `ChatGPT 5.4 Pro`, switch the composer pill to `Extended Pro`, and sync durable project sources.

```bash
scripts/chatgpt_browser_agent.sh prepare \
  --cdp-url "http://127.0.0.1:9222" \
  --project-url "https://chatgpt.com/g/g-p-6992190183fc8191aec8b0c2fad5c017-robust-trust-proof/project" \
  --add-source "/absolute/path/to/objective_statement.md" \
  --add-source "/absolute/path/to/proof_state.md" \
  --add-source "/absolute/path/to/Robust_trust_Dworczak_Smolin.pdf" \
  --remove-source "old_note.md"
```

### Fulfill one external-agent request

```bash
scripts/chatgpt_browser_agent.sh submit \
  --cdp-url "http://127.0.0.1:9222" \
  --project-url "https://chatgpt.com/g/g-p-6992190183fc8191aec8b0c2fad5c017-robust-trust-proof/project" \
  --request-file "runs/<run_id>/branches/main/external_agent/formalizer_request.md" \
  --response-file "runs/<run_id>/branches/main/external_agent/formalizer_response.md"
```

The script writes a JSON session log next to the response file by default:

- `formalizer_response_session.json`

The script also writes a heartbeat JSON next to the response file by default while it is waiting:

- `formalizer_response_heartbeat.json`

The heartbeat is updated on each polling cycle with the current status, chat URL, latest response length, and deadline. This makes it easy to distinguish an alive long-running role from a dead worker.

### Watch one heartbeat

Use this when you want notification and terminal status detection without resuming the run automatically:

```bash
scripts/chatgpt_heartbeat_watch.sh \
  --heartbeat-json "runs/<run_id>/branches/main/external_agent/formalizer_response_heartbeat.json" \
  --response-file "runs/<run_id>/branches/main/external_agent/formalizer_response.md" \
  --notify-command 'printf %s "$MPP_HEARTBEAT_STATUS" > /tmp/mpp-heartbeat-status.txt'
```

The watcher exits with:

- `0` on `completed`
- `1` on `error`
- `2` on `stale`
- `3` on `timeout`

### Supervise the full external-agent loop

Use this when you want one process to launch the browser submitter, watch the heartbeat, and call `mpp resume` automatically as soon as the response is ready.

```bash
scripts/chatgpt_browser_supervisor.sh \
  --run-id "<run_id>" \
  --config config/browser_chatgpt.toml \
  --project-url "https://chatgpt.com/g/g-p-6992190183fc8191aec8b0c2fad5c017-robust-trust-proof/project" \
  --cdp-url "http://127.0.0.1:9222"
```

The supervisor writes an event log to:

- `runs/<run_id>/external_agent_supervisor.jsonl`

It resets stale heartbeat files before relaunching a role so a dead prior worker does not poison the next attempt.

## Context policy for long proofs

- Never truncate branch-local proof artifacts. If a prover draft or review is long, attach the full file or split the role into a smaller step.
- Treat the proof-state note as a durable project source, not as an ephemeral chat attachment.
- If a branch already has a late-stage prover artifact, restart from that artifact rather than from `formalizer`.
- If a prior reviewer request was assembled with incomplete context, treat the verdict as tainted and rerun review on the full prover file.
- Scope prover requests to one lemma block or one reviewer delta at a time instead of passing the full branch by default.
- Keep route selection, branch pruning, and breakdown approval under manual orchestrator inspection even when submission, polling, and logging are scripted.

## Config profile

`config/browser_chatgpt.toml` is the first browser-only workflow profile.

It does two things:

1. Routes the proof roles through `external_agent`.
2. Disables the router so the run pauses role-by-role instead of requiring a browser call for routing decisions.

## End-to-end loop

Example:

```bash
# 1. Start the run.
mpp run --claim-file /path/to/objective_statement.md --config config/browser_chatgpt.toml

# 2. Inspect the run and find the pending response file.
mpp inspect --run-id <run_id> --config config/browser_chatgpt.toml

# 3. Fulfill the pending request in ChatGPT.
scripts/chatgpt_browser_agent.sh submit \
  --cdp-url "http://127.0.0.1:9222" \
  --project-url "https://chatgpt.com/g/g-p-6992190183fc8191aec8b0c2fad5c017-robust-trust-proof/project" \
  --request-file "runs/<run_id>/branches/main/external_agent/formalizer_request.md" \
  --response-file "runs/<run_id>/branches/main/external_agent/formalizer_response.md"

# 4. Resume the run.
mpp resume --run-id <run_id> --config config/browser_chatgpt.toml
```

Repeat steps 2-4 until the run completes, or replace steps 2-4 entirely with the supervisor command above.

For iterative proof development, update the durable proof-state source after each accepted reviewer pass before launching the next role.

## Long-running roles

- Default max wait is now 90 minutes (`5400` seconds).
- Override with `--max-wait-seconds` if a role needs a different budget.
- Use the heartbeat JSON beside the response file to check whether the worker is still active.
- Use `scripts/chatgpt_browser_supervisor.sh` if you want the run to auto-resume instead of relying on manual polling.

## Current hard-coded behavior

This first pass hard-codes two browser policies:

- always use `ChatGPT 5.4 Pro` in the top model picker
- always use `Extended Pro` in the composer pill

That is deliberate. The goal is a working browser path first, then a more flexible browser config later.

## Current limits

- The browser runner assumes the ChatGPT UI still exposes the composer pill as `Pro -> Extended`.
- Source removal is selector-based and therefore more brittle than prompt submission.
- The script creates a fresh chat from the project page for each request. It does not yet reuse branch-specific conversations.
- The runner closes a Playwright-launched browser at the end of each command. In `--cdp-url` mode it only closes the automation connection and leaves the human-opened Chrome running.
