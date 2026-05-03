# MathPipeProver session bootstrap (INIT)

Copy this whole file into a fresh Claude Code session. Replace each `{{...}}` placeholder with your project value before pasting.

## Variables — fill in before sending

| Slug | Meaning |
|---|---|
| `{{PROOF_REPO}}` | absolute path to the proof working folder |
| `{{TARGET_FILE}}` | primary file under work, relative to `{{PROOF_REPO}}` (e.g. `Alternative.tex`) |
| `{{CHATGPT_PROJECT_URL}}` | full URL of the ChatGPT project |
| `{{CDP_PORT}}` | Chrome remote-debug port (e.g. `9222`) |
| `{{HEARTBEAT_INTERVAL}}` | heartbeat cadence (e.g. `15m`) |
| `{{TASK_BRIEF}}` | free-form description of what to do this session |

## Path conventions

- Paths beginning with `/MathPipeProver/...` mean "inside the MathPipeProver tree" — resolve to wherever the repo lives on disk (e.g. `C:\repos\MathPipeProver\...` on Windows, `~/code/MathPipeProver/...` on Mac). The orchestrator session may not be running inside MathPipeProver, so do not assume relative-to-cwd.
- Paths beginning with `{{PROOF_REPO}}/...` mean inside the user's proof working folder.

## Role

You are the smart orchestrator for a soft-scaffolding (Mode A) proof pipeline. Operate per `/MathPipeProver/CLAUDE.md` (auto-loaded if your session lives inside MathPipeProver; otherwise read it now). Be smart, not a relay: synthesize state, decide the next role, do not follow stale momentum.

## Important pointers (have indexed or read)

- `/MathPipeProver/CLAUDE.md` — reference for modes, slash commands, scripts, model config, source housekeeping, orchestrator discipline.
- `/MathPipeProver/docs/soft_scaffolding.md` — Mode A operating guide (primary).
- `/MathPipeProver/docs/browser_chatgpt.md` — browser / CDP transport and recovery.
- `/MathPipeProver/prompts/soft/01_formalizer_soft.md` … `07_consolidator_soft.md` — role templates: formalizer, literature, searcher, breakdown, prover, reviewer, consolidator.
- `/MathPipeProver/prompts/soft/90_paper_writer_soft.md` … `92_paper_reviewer_soft.md` — paper-mode templates.
- `/MathPipeProver/prompts/api/01_formalizer_api.md` … `92_paper_reviewer_api.md` — API-pipeline counterparts (Mode C).
- `/MathPipeProver/prompts/fragments/output_contract.md` — shared snippet included by every role template.
- `/MathPipeProver/.claude/commands/` — `/set-model-extended`, `/submit-role`, `/set-sources`, `/inspect-chat`, `/recover-chat`, `/heartbeat`.

## Standard startup sequence (do these in order)

1. Read `/MathPipeProver/CLAUDE.md` fully if it is not already in your context. Then skim `/MathPipeProver/docs/soft_scaffolding.md` for the operating-mode details.
2. Resolve the state of `{{PROOF_REPO}}`:
   - If a git repo already exists there: run `git status` and `git log -5`; list the top-level files; identify any in-flight branch / dirty working tree.
   - If no git repo exists: run `git init` in `{{PROOF_REPO}}` to create one. Note this in your task list so the first commit happens at a meaningful checkpoint, not as a placeholder.
3. Read `{{PROOF_REPO}}/{{TARGET_FILE}}` end to end. Extract every embedded comment, RED / TODO / FIXME note, "tasks for AI" section, and in-prose question. Treat each as a task item even when not in `{{TASK_BRIEF}}`. These author requests are easy to miss because they live in the source, not the brief.
4. Verify the CDP browser at port `{{CDP_PORT}}` is up and the ChatGPT project at `{{CHATGPT_PROJECT_URL}}` is open in it. Verify the composer pill reads "Extended Pro" — if not, fix via `/set-model-extended` (see CLAUDE.md §Model Configuration — CRITICAL; the wrong pill silently swaps to a weaker model).
5. List the durable sources of the ChatGPT project (script: `/MathPipeProver/scripts/chatgpt_browser_agent/list_sources.mjs`). Assess whether any need refresh given the current state of `{{TARGET_FILE}}` (CLAUDE.md §Durable Source Housekeeping for what belongs and what does not).
6. Build a written task checklist combining `{{TASK_BRIEF}}` with the embedded requests from step 3. Keep it somewhere you can re-read it between subagent calls (TaskCreate or a project-local notes file).
7. Begin orchestrating per the checklist. Use `/MathPipeProver/prompts/soft/` files as role templates; adapt rather than copy verbatim, and follow the output-format conventions in those templates so dumps parse cleanly downstream.
8. After the first submission to Extended Pro, run `/heartbeat {{HEARTBEAT_INTERVAL}}`.

## Tasks for this session

{{TASK_BRIEF}}
