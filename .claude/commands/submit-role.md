Submit a proof role prompt to ChatGPT via CDP and monitor for completion.

Arguments: $ARGUMENTS
- Format: `--project-url URL --port PORT --prompt-file PATH [--response-file PATH]`

## Mode selection

Two model modes are supported. The orchestrator picks the right one for the role:

- **Extended Pro** (default) — for analytical proof roles: formalizer, searcher,
  breakdown, prover, reviewer, consolidator, gatekeeper. 30–90 min response time.
  Pass no extra flags.
- **Deep Research** — for the literature role only (`02_literature_soft.md`). DR
  can browse the open web and academic repositories, return long-form synthesis
  with citations and quoted passages, and chain sub-searches. 5–30 min response
  time. Pass `--deep-research`.

**The model mode must match the prompt.** Submitting `02_literature_soft.md`
without `--deep-research` will run it through Extended Pro, which cannot browse
and will produce a much weaker result. Submitting an analytical role with
`--deep-research` will waste the DR session on a task it isn't designed for.

## Steps

1. **Determine mode.** If the prompt file is `prompts/soft/02_literature_soft.md`,
   the mode is **Deep Research**. Otherwise it's **Extended Pro**.

2. **Verify the model state** before submitting:
   ```bash
   cd C:/repos/MathPipeProver/scripts/chatgpt_browser_agent
   node cdp_set_model_pro.mjs --port PORT --check-only
   ```
   This verifies Extended Pro. The submit script will additionally enforce the
   correct mode at submit time, but the pre-check catches obvious problems
   (composer not loaded, login lapsed, etc.) before you commit to a role.

3. **Submit the prompt:**

   **Extended Pro (default):**
   ```bash
   node cdp_submit.mjs --project-url URL --port PORT PROMPT_FILE
   ```

   **Deep Research (literature role only):**
   ```bash
   node cdp_submit.mjs --project-url URL --port PORT --deep-research PROMPT_FILE
   ```

   The script navigates to the project (starts a fresh chat), enforces the
   chosen mode, fills the prompt, and sends.

4. **Record the chat URL** from the script output for status checks and recovery.

5. **Monitor.** Use the passive heartbeat JSON, `/inspect-chat`, or manual polling.
   - Extended Pro responses: 30–90+ minutes.
   - Deep Research responses: 5–30 minutes (sometimes 45 for hard topics).
   Do not start the deprecated recurring `/heartbeat` loop.

6. **Harvest** the response when complete using inline Playwright CDP (connect,
   extract assistant messages, write to response file).

## Recovery

- If the script can't connect to CDP, check Chrome is running on the right port.
- If Extended Pro reverts after navigating to a project, re-run `cdp_set_model_pro.mjs`.
- If Deep Research mode fails to engage, the `ensureDeepResearch` selector in
  `lib/model_pill.mjs` may be stale (ChatGPT DR DOM changes periodically) —
  inspect with `cdp_inspect_actions_menu.mjs` and update the lib.
- If a response was generated but not captured, use `/recover-chat`.
- Never resubmit without first checking if the chat already completed.
