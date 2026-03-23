## Skills
Repo-local skills available in this repository:

- `mathpipe-browser-proof-ops`: Use when working on ChatGPT project preparation, durable source refresh, project-source inspection, or browser-backed `external_agent` submissions in MathPipeProver. (file: `/Users/p-aldighieri/Library/CloudStorage/OneDrive-Personal/Codebook/MathPipeProver/.codex/skills/mathpipe-browser-proof-ops/SKILL.md`)

### How To Use Skills
- If the task mentions ChatGPT projects, browser-backed proof orchestration, durable sources, `external_agent`, `Extended Pro`, `prepare`, or `submit`, use the matching repo-local skill.
- Prefer repo scripts over ad hoc browser actions.
- Keep durable project sources and temporary chat attachments separate.
- For browser-backed MathPipeProver work, prefer attaching to the already-running visible Chrome session over CDP via `MPP_CHATGPT_CDP_URL` or `--cdp-url`.
- Do not improvise alternate browser launch paths, headless runs, or profile-based fallbacks unless the user explicitly asks for that. If CDP attach fails, treat it as an infrastructure issue and report it.
