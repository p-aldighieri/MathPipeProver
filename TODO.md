# MathPipeProver TODO

Last updated: 2026-03-03

## Completed

- [x] Create `MathPipeProver` repo scaffold with CLI (`run`, `resume`, `inspect`).
- [x] Implement mode policies (`strict`, `semi_strict`, `flexible`).
- [x] Implement markdown-first branch context pools and role file-access controls.
- [x] Add `workflow_router` with structured output (`{"next":"TAG"}`) + fallback handling.
- [x] Add provider adapters (OpenAI/Anthropic/Gemini) and provider smoke command.
- [x] Add prompt templates in `prompts/`.
- [x] Add automatic `.env` loading in CLI.
- [x] Implement token accounting and per-run usage artifacts.
- [x] Keep tests outside package (`tests/`) and explicitly not ignored.
- [x] Add budget gates (global + per-branch token/call limits).
- [x] Add multi-branch strategy fan-out with route pruning.
- [x] Add `mpp report` command for run summaries.
- [x] Add `production.toml` profile.
- [x] Add external-agent request/response flow for roles (including literature mode).

## In Progress

- [ ] Validate full end-to-end with non-stub multi-branch real-provider profile.

## Next

- [ ] Add explicit USD cost estimation (provider/model pricing table + report integration).
- [ ] Add branch concurrency option (parallel branch execution).
- [ ] Add regression benchmark set with fixed claims and expected end states.

## Notes

- Token usage is stored in:
  - `runs/<run_id>/token_usage_summary.json`
  - `runs/<run_id>/branches/<branch>/token_events.jsonl`
- `mpp inspect` includes token totals.
- `mpp report` includes branch outcomes and per-role usage breakdown.
