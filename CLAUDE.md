# MathPipeProver

Automated proof orchestration pipeline with browser-backed soft scaffolding.

The soft-scaffolding orchestrator is expected to act intelligently, not mechanically.
It should synthesize proof-state, reviewer verdicts, route obstructions, and current branch value before choosing the next role.
Do not merely relay model outputs or follow stale pipeline momentum when the mathematical frontier has already shifted.
When browser state drifts, do not play dumb: inspect the project, model, effort, durable sources, and live chat before escalating.

## Key Documentation

- `docs/soft_scaffolding.md` — browser-orchestrated proof workflow guide
- `docs/browser_chatgpt.md` — ChatGPT browser agent operations
- `docs/heartbeat_watcher_mcp.md` — heartbeat watcher MCP tool reference

## Heartbeat Watcher MCP

When orchestrating browser-based ChatGPT Pro sessions, use the `heartbeat-watcher`
MCP tools to wait for responses without letting the session go idle.

For watcher-owned automation, prefer the CLI session-bridge flow instead of trying
to keep one Claude session blocked forever. In that mode, a saved Claude `session_id`
is resumed later by a watcher after the browser response lands.

The resumed Claude CLI automation should run with `--dangerously-skip-permissions`
and is expected to attempt straightforward browser recovery itself:

- reopen the intended project page
- verify `ChatGPT 5.4 Pro` and `Extended Pro`
- confirm durable sources are present
- recover a live chat when the response file is missing but the chat URL exists
- only ask for help when auth or browser transport is truly blocked

### After launching the browser agent

Call `wait_for_completion` with the heartbeat and response file paths.  This blocks
until the browser agent finishes, keeping this session alive:

```
wait_for_completion(
  heartbeat_file="<absolute path to {role}_response_heartbeat.json>",
  response_file="<absolute path to {role}_response.md>"
)
```

The tool returns the full response text on success.  On error or stale, it returns
the failure reason so you can decide whether to resubmit.

### Typical heartbeat file locations

Heartbeat files are written next to the response file:
- `runs/<run>/branches/<branch>/external_agent/{role}_response_heartbeat.json`
- Response at: `runs/<run>/branches/<branch>/external_agent/{role}_response.md`

See `docs/heartbeat_watcher_mcp.md` for the full parameter reference.
