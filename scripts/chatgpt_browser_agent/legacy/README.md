Legacy browser-agent probes retained for reference.

These scripts were early NPIV-specific CDP experiments used while the
browser-backed workflow was being explored. They are intentionally kept out of
the main `scripts/chatgpt_browser_agent/` directory because they are not part
of the supported MathPipeProver workflow:

- `chatgpt_browser_agent.mjs` is the supported runner for `prepare`, `submit`,
  `recover`, and `inspect`.
- `cdp_set_model_pro.mjs`, `cdp_add_source.mjs`, and `cdp_submit.mjs` are the
  remaining generic low-level CDP helpers.

Everything in this `legacy/` folder is project-specific, has hardcoded chat or
project assumptions, or duplicates functionality that now exists in the main
browser agent.
