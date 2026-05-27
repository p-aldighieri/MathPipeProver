---
name: inspect-chat
description: Read-only one-shot inspection of a live ChatGPT chat — returns generating flag, assistant turn count, last assistant message length and tail. Use during long-running roles to check whether the chat is still working or done.
---

# inspect-chat

**Canonical content:** `.claude/commands/inspect-chat.md` in this repo. Codex
and Claude Code share the same procedure — edit the Claude command file,
not this stub.

## TL;DR for Codex sessions

Use when the orchestrator needs to know "is this chat still working or
done?" without harvesting the content. Shells out to:

```bash
scripts/chatgpt_browser_agent/cdp_inspect_chat.mjs --chat-url URL --port PORT
```

Outputs JSON with `generating`, `assistantMessages`, `lastAssistantLen`,
`lastAssistantTail`. If the chat is done, follow up with `/recover-chat` to
harvest. If still generating, decide whether to wait or move on.

Read `.claude/commands/inspect-chat.md` for the full step-by-step.
