---
name: set-model-extended
description: Verify or set the ChatGPT composer to the Extended Pro target (reasoning Pro + model 5.5; pill reads "Extended Pro" or "Pro"). Required before any analytical submission.
---

# set-model-extended

**Canonical content:** `.claude/commands/set-model-extended.md` in this repo.
Codex and Claude Code share the same procedure — edit the Claude command
file, not this stub.

## TL;DR for Codex sessions

Use before any role submission via `submit-role`. Shells out to:

```bash
scripts/chatgpt_browser_agent/cdp_set_model_pro.mjs --port PORT [--check-only]
```

`--check-only` just verifies (exit 0 = correct, exit 1 = wrong); without it
the script will actively toggle the composer into Extended Pro and
auto-disable Deep Research if it's currently active.

All DOM logic for the model pill lives in
`scripts/chatgpt_browser_agent/lib/model_pill.mjs` — when ChatGPT's
composer DOM changes, fix the lib once, not each entry-point script.

Read `.claude/commands/set-model-extended.md` for the full step-by-step.
