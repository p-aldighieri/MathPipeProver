---
name: submit-role
description: Submit a proof role prompt to a ChatGPT project via CDP and monitor for completion. Verifies Extended Pro (or toggles Deep Research for the literature role), sends, reports the chat URL, and provides recovery guidance for long-running roles.
---

# submit-role

**Canonical content:** `.claude/commands/submit-role.md` in this repo. Codex and
Claude Code share the same operational steps — edit the Claude command file,
not this stub, when changing the procedure.

## TL;DR for Codex sessions

Use this when MathPipeProver pauses with `waiting_external_agent` and the
orchestrator needs to fulfill the pending request manually. The skill:

1. Picks the right model mode based on the prompt file — Extended Pro for
   analytical roles, Deep Research for the literature role
   (`prompts/soft/02_literature_soft.md`).
2. Submits via `scripts/chatgpt_browser_agent.sh submit ...` (preferred) or
   `scripts/chatgpt_browser_agent/cdp_submit.mjs` (lower-level).
3. Reports the chat URL.
4. Suggests monitoring tools: `/inspect-chat` (one-shot), `/recover-chat`
   (harvest), `/heartbeat <interval>` (unattended orchestrator-pace loop).

Read `.claude/commands/submit-role.md` for the full step-by-step, CLI
argument shapes, and error-recovery guidance.
