## Skills

Repo-local skills available to a Codex session in this repository. Each
`SKILL.md` lives under `.codex/skills/<name>/`; the operational content
for the six browser/search skills is intentionally a thin pointer to the
canonical `.claude/commands/<name>.md` so Claude Code and Codex orchestrators
follow the same procedure.

| Skill | Purpose |
|-------|---------|
| `mathpipe-browser-proof-ops` | Umbrella workflow guidance for ChatGPT project preparation, durable source refresh, project-source inspection, and browser-backed `external_agent` submissions. Read this first for end-to-end browser workflow. |
| `submit-role` | Submit a proof role prompt to a ChatGPT project. Picks the right model mode (Extended Pro for analytical roles; Deep Research for the literature role only). |
| `set-sources` | Add or remove durable files in a ChatGPT project's Sources tab. |
| `set-model-extended` | Verify or set the ChatGPT composer to the Extended Pro target before any analytical submission. |
| `inspect-chat` | One-shot read-only status check of a live ChatGPT chat (generating? assistant turn count? last text length?). |
| `recover-chat` | Harvest a completed ChatGPT chat's last assistant message into a response file when the original submit died before capturing the response. |
| `search-council` | Opt-in on re-attempt ≥2. Fan out 1 Codex + 1 Gemini + 1 Opus + 1 Extended Pro on the same packet, preserve all four memos, hand off to the regular Strategy Searcher for pure selection. ~3× the cost of a single search. Gemini member needs the `gemini` CLI (`npm i -g @google/gemini-cli` + auth); skip via `--skip-member gemini` if absent. |
| `set-referee-targets` | Create or update `{PROOF_REPO}/referee_targets.yaml` — the per-proof registry of target journals + clearance bars that the `paper_referee` role consults. Optional (referee falls back to a generic publishability check without it). Template at `prompts/fragments/referee_targets_template.yaml`. |

### How To Use Skills

- If the task mentions ChatGPT projects, browser-backed proof orchestration,
  durable sources, `external_agent`, `Extended Pro`, `prepare`, or `submit`,
  use the matching repo-local skill.
- For the literature role specifically (`prompts/soft/02_literature_soft.md`),
  pass `--deep-research` to `chatgpt_browser_agent.sh submit` (or
  `cdp_submit.mjs`). Every other role runs in Extended Pro. The `submit-role`
  skill picks the right flag automatically based on the prompt file.
- Prefer repo scripts over ad hoc browser actions. All DOM logic now lives
  in `scripts/chatgpt_browser_agent/lib/` (8 modules); entry-point scripts
  are thin shims over the lib. When ChatGPT's composer DOM changes, fix the
  lib once, not each entry point.
- Keep durable project sources and temporary chat attachments separate.
- Formal analytical proof roles must go through ChatGPT Extended Pro via
  the browser-backed `external_agent` workflow. Do not use subagents for
  formalizer / searcher / breakdown / prover / reviewer / consolidator /
  gatekeeper / referee work.
- Subagents are allowed only for a specifically requested coding/simulation
  problem, or inside the Lean formalization workflow for Lean / Mathlib /
  AXLE code-checking and proof-engineering loops.
- For browser-backed MathPipeProver work, prefer attaching to the already-
  running visible Chrome session over CDP via `MPP_CHATGPT_CDP_URL` or
  `--cdp-url`.
- Do not improvise alternate browser launch paths, headless runs, or
  profile-based fallbacks unless the user explicitly asks for that. If CDP
  attach fails, treat it as an infrastructure issue and report it.
- Do not stop at the first browser inconsistency. Re-check the project URL,
  base model, effort pill, and durable sources before declaring the browser
  run broken.
- If the Sources tab looks stale or incomplete, reopen it, retry one file
  at a time, and verify the post-sync source list before moving on.
- If a response file is missing but a live `chat_url` exists, inspect or
  recover that chat before treating the step as dead — use `/inspect-chat`
  for a one-shot status read and `/recover-chat` to harvest.
- If ChatGPT shows an account chooser and there is one clear account entry
  to continue with, select it and keep going. Escalate only when the login
  state is ambiguous or blocked.
- For unattended runs, `/heartbeat <interval>` starts an orchestrator-pace
  loop that wakes the orchestrator periodically and advances the pipeline
  on its own. This is the orchestrator-loop skill — unrelated to the older
  Python heartbeat-watcher chain, which was removed.
