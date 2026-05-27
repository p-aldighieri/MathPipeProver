---
name: set-sources
description: Add or remove durable files in a ChatGPT project's Sources tab. Use after a verified result lands, after a route pivot, or when the durable proof-state file has been updated locally.
---

# set-sources

**Canonical content:** `.claude/commands/set-sources.md` in this repo. Codex
and Claude Code share the same procedure — edit the Claude command file,
not this stub.

## TL;DR for Codex sessions

Manage the ChatGPT project's Sources tab (the durable per-project context
that every chat in that project sees). NOT the same as per-prompt composer
attachments — see `docs/browser_chatgpt.md` for the durable-vs-temporary
policy.

Typical use:
- After a consolidator produces a new proof-state → refresh the durable
  proof-state source.
- After a route pivot → remove the stale route memo, add the new one.
- After scope changes → update the objective file.

Mechanics: shells out to `scripts/chatgpt_browser_agent.sh prepare` with
`--add-source PATH` / `--remove-source NAME` flags. The browser refresh
includes a cache-bust gap so new chats see the latest content.

Read `.claude/commands/set-sources.md` for full args + the durable-source
housekeeping rules from CLAUDE.md.
