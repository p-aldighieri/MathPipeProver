---
name: recover-chat
description: Harvest a completed ChatGPT chat's last assistant message into a response file. Use when a role finished but the response file wasn't captured (e.g., orchestrator lost the chat URL, or the submit script died after the model responded).
---

# recover-chat

**Canonical content:** `.claude/commands/recover-chat.md` in this repo. Codex
and Claude Code share the same procedure — edit the Claude command file,
not this stub.

## TL;DR for Codex sessions

Use when a chat completed but its response wasn't captured — the orchestrator
has the chat URL but no response file on disk. Shells out to:

```bash
scripts/chatgpt_browser_agent.sh recover --chat-url URL --response-file PATH [--cdp-url URL]
```

This is also the right recovery path when a submit died mid-flight after the
model started responding. Always try `/recover-chat` before resubmitting —
re-running a 30-90 min Extended Pro role only to find the prior chat had
already completed is the worst-case outcome.

Read `.claude/commands/recover-chat.md` for the full step-by-step.
