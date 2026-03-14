# Heartbeat Watcher MCP

MCP server that watches MathPipeProver heartbeat JSON files written by the browser agent.
It lets an agent session stay alive while waiting for a long-running ChatGPT Pro response.

## When To Use

After launching the browser agent (via `chatgpt_browser_agent.mjs` or the supervisor),
the orchestrator session needs to wait for the ChatGPT Pro response. This tool replaces
idle waiting with a blocking MCP call so the session does not go idle or time out.

## Tools

### `wait_for_completion`

Blocks until the heartbeat reaches a terminal status.  The agent session stays alive
because a tool call is pending.  Returns the full response text on success.

**Use this when:** you want to hand off and resume only when the browser agent is done.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `heartbeat_file` | yes | — | Absolute path to the heartbeat JSON written by the browser agent |
| `response_file` | no | from heartbeat | Absolute path to the expected response `.md` file |
| `poll_interval_seconds` | no | 10 | Seconds between internal checks |
| `timeout_seconds` | no | 5400 (90 min) | Max wait.  0 = no limit |
| `stale_after_seconds` | no | 120 | If heartbeat_at is older than this while status is active, return `stale` |

**Terminal statuses returned:** `completed`, `error`, `stale`, `timeout`

**On `completed`:** the response file contents are returned inline so the agent can
continue processing without an extra file read.

**Example call:**

```
wait_for_completion(
  heartbeat_file="/path/to/runs/.../prover_response_heartbeat.json",
  response_file="/path/to/runs/.../prover_response.md",
  timeout_seconds=5400
)
```

## Heartbeat JSON Format

The browser agent writes this file (typically `{role}_response_heartbeat.json`):

```json
{
  "command": "submit",
  "status": "waiting_reply",
  "project_url": "https://chatgpt.com/g/...",
  "request_file": "/abs/path/to/request.md",
  "response_file": "/abs/path/to/response.md",
  "heartbeat_at": "2026-03-12T10:30:00.000Z",
  "submitted_at": "2026-03-12T10:00:00.000Z",
  "chat_url": "https://chatgpt.com/c/...",
  "generating": true,
  "stable_cycles": 0,
  "latest_response_chars": 3200,
  "deadline_at": "2026-03-12T11:30:00.000Z"
}
```

**Status lifecycle:** `starting` -> `submitted` -> `waiting_reply` -> `completed` | `error`

The MCP watcher adds synthetic terminal statuses: `stale` (heartbeat_at too old) and
`timeout` (max wait exceeded).

## Configuration

### Claude Code (project-level)

In `.claude/settings.json`:

```json
{
  "mcpServers": {
    "heartbeat-watcher": {
      "command": "node",
      "args": ["scripts/mcp-heartbeat-watcher/index.mjs"]
    }
  }
}
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.heartbeat-watcher]
command = "node"
args = ["/full/path/to/MathPipeProver/scripts/mcp-heartbeat-watcher/index.mjs"]
```

## Orchestrator Policy

Use `wait_for_completion` as the only MCP waiting interface in normal orchestration.
If a run returns `error`, `stale`, or `timeout`, recover by inspecting the saved chat URL
or resubmitting the step; do not build polling loops on top of the MCP layer.
