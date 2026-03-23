---
name: mathpipe-browser-proof-ops
description: Use when working in MathPipeProver on ChatGPT project preparation, durable source refresh, project-source inspection, or browser-backed external_agent submission. Prefer scripts/chatgpt_browser_agent.sh prepare/submit over ad hoc UI work, enforce ChatGPT 5.4 Pro with Extended Pro, and keep durable sources separate from temporary attachments.
---

# MathPipe Browser Proof Ops

Use this skill for:

- preparing a ChatGPT project before proof work
- inspecting or syncing durable project sources
- submitting `external_agent` request packets in the browser

## Workflow

1. Read `docs/browser_chatgpt.md` if you need the durable-vs-temporary policy.
2. Use the existing visible Chrome/CDP session for automation. Prefer `MPP_CHATGPT_CDP_URL` or pass `--cdp-url URL` explicitly.
3. Before `prepare` or `submit`, verify the CDP endpoint is alive:

```bash
curl -s "$MPP_CHATGPT_CDP_URL/json/version"
```

If CDP is unavailable, stop and report the infrastructure problem. Do not switch to headless mode, do not launch a fresh profile with `--profile-dir`, and do not substitute an unrelated browser tool path on your own.

4. For project setup or source sync, run:

```bash
scripts/chatgpt_browser_agent.sh prepare --project-url URL [--cdp-url URL] [--add-source PATH ...] [--remove-source NAME ...]
```

This command prints JSON including:

- `base_model`
- `effort_mode`
- `source_names`

5. For one browser-backed role submission, run:

```bash
scripts/chatgpt_browser_agent.sh submit --project-url URL --request-file PATH --response-file PATH [--cdp-url URL] [--attach-file PATH ...]
```

## Durable Source Policy

- Add only stable background files.
- Typical candidates: objective or claim file, paper PDF, durable proof-state file, current stable route memo.
- Do not add packets, logs, or per-step drafts as durable sources.
- Remove stale branch-specific durable sources before adding replacements.

## Temporary Attachment Policy

- Use `--attach-file` only for per-step inputs that should stay chat-local.

## Browser Policy

- Base model must be `ChatGPT 5.4 Pro`.
- Effort must be `Extended Pro`.
- In automated repo tests, use the same visible Chrome/CDP route that the live workflow uses.
- Treat CDP attach failure as a hard stop, not as a cue to invent another browser launch path.

## References

- `docs/browser_chatgpt.md`
- `docs/soft_scaffolding.md`
- `.claude/commands/set-sources.md`
- `.claude/commands/submit-role.md`
