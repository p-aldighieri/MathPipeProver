# Claude Session Bridge Smoke

This smoke flow validates the watcher-owned Claude Code resume loop without touching the live browser lane.

## What it proves

1. A Claude Code CLI session can start a MathPipeProver run and stop at the first external-agent handoff.
2. We can keep an explicit Claude `session_id`.
3. A watcher process can later wake that exact saved Claude session with `claude -p -r <session_id> ...`.
4. The resumed Claude session still has enough tool access to run `mpp resume` and move the run forward.

## Scope

- no browser
- no ChatGPT project submit
- no interference with live proof tabs
- run artifacts stay inside the target workspace under `runs/session_bridge_smoke_20260323/`

## Files

- config: [config/session_bridge_smoke.toml](/Users/p-aldighieri/Library/CloudStorage/OneDrive-Personal/Codebook/MathPipeProver/config/session_bridge_smoke.toml)
- helper: [scripts/session_bridge_smoke.py](/Users/p-aldighieri/Library/CloudStorage/OneDrive-Personal/Codebook/MathPipeProver/scripts/session_bridge_smoke.py)

## Manual flow

### 1. Bootstrap a disposable Claude session

```bash
python3 scripts/session_bridge_smoke.py bootstrap-claude \
  --target-repo /absolute/path/to/target/workspace \
  --claim-file /absolute/path/to/objective_statement.md \
  --metadata-file /absolute/path/to/target/workspace/runs/session_bridge_smoke_20260323/claude_smoke_metadata.json
```

This launches a disposable Claude Code print-mode session, runs `mpp run`, and stops once the run reaches `waiting_external_agent`.
The helper enables `--dangerously-skip-permissions` by default because the bridge needs Bash access when it wakes the saved session later.

### 2. Write a fake external-agent response

```bash
python3 scripts/session_bridge_smoke.py write-dummy-response \
  --metadata-file /absolute/path/to/target/workspace/runs/session_bridge_smoke_20260323/claude_smoke_metadata.json
```

### 3. Run the watcher

```bash
python3 scripts/session_bridge_smoke.py watch-claude \
  --metadata-file /absolute/path/to/target/workspace/runs/session_bridge_smoke_20260323/claude_smoke_metadata.json
```

The watcher waits for the fake response file, resumes the exact saved Claude session by `session_id`, and lets Claude run `mpp resume`.

## Expected outcome

After the watcher step:

- the run should no longer be stuck at `waiting_external_agent`
- the watcher log should record `response_ready` and `resume_completed`
- the run should end in either `complete` or `failed`
