Submit a proof role prompt to ChatGPT via CDP and wait for completion with the chat watcher.

Arguments: $ARGUMENTS
- Format: `--project-url URL --port PORT --prompt-file PATH [--response-file PATH]`

Paths below are relative to the MathPipeProver repo root.

## Mode selection

Two model modes are supported. The orchestrator picks the right one for the role:

- **Pro target** (default; GPT-6 Pro, pill "6 Pro"; legacy name "Extended Pro") —
  for analytical proof roles: formalizer, searcher, breakdown, prover, reviewer,
  consolidator, gatekeeper. Typically 4–20+ min. Pass no extra flags.
- **Deep Research** — for the literature role only (`02_literature_soft.md`). DR
  can browse the open web and academic repositories, return long-form synthesis
  with citations and quoted passages, and chain sub-searches. 5–30 min. Pass
  `--deep-research`.

**The model mode must match the prompt.** Submitting `02_literature_soft.md`
without `--deep-research` runs it on Pro, which is a much weaker literature
search. Submitting an analytical role with `--deep-research` wastes the DR
session on a task it isn't designed for. The submit scripts re-verify the mode
after the prompt is filled and refuse to send on a mismatch.

## Steps

1. **Determine mode.** If the prompt file is `prompts/soft/02_literature_soft.md`,
   the mode is **Deep Research**. Otherwise it's the **Pro target**.

2. **Verify the model state** before submitting:
   ```bash
   node scripts/chatgpt_browser_agent/cdp_set_model_pro.mjs --port PORT --check-only
   ```
   The submit script also enforces the mode, but the pre-check catches obvious
   problems (composer not loaded, login lapsed, etc.) before you commit to a role.

3. **Submit and return immediately:**

   ```bash
   scripts/chatgpt_browser_agent.sh submit \
     --project-url URL \
     --cdp-url http://127.0.0.1:PORT \
     --page new \
     --clear-draft safe \
     --request-file PROMPT_FILE \
     --response-file RESPONSE_FILE \
     --return-after-submit
   ```

   Add `--deep-research` for the literature role and `--attach-file PATH` (repeatable)
   for per-step context. The script opens a fresh project tab, clears stale drafts
   and attachments, enforces the mode, attaches the request file, re-verifies the
   mode, sends, prints the chat URL, and closes its tab (generation continues
   server-side).

4. **Record the chat URL** from the script output in the run log.

5. **Start the watcher as a background job** (Claude Code: Bash with
   `run_in_background: true`):
   ```bash
   node scripts/chatgpt_browser_agent/wait_chat_done.mjs --port PORT \
     --chat-url CHAT_URL --out RESPONSE_FILE
   ```
   For Deep Research add `--deep-research --min-stable-length 3000`. The watcher
   exits when the answer is complete and written (exit 0), when the chat fails
   (3), on timeout (2), or when a DR report landed in a canvas (4). Its exit
   re-invokes the orchestrator; read RESPONSE_FILE and decide the next role.

6. **Deep Research canvas (exit 4).** Heavy DR jobs return the report in a
   canvas that is not in the chat DOM. Harvest with
   `node scripts/chatgpt_browser_agent/harvest_deep_research.mjs --port PORT --chat-url CHAT_URL --out RESPONSE_FILE --repost-now`
   (see CLAUDE.md "Model modes" → DR harvest).

## Recovery

- If the script can't connect to CDP, check Chrome is running on the right port.
- If the pill drifts after navigating to a project, re-run `cdp_set_model_pro.mjs`.
- If Deep Research mode fails to engage, the `ensureDeepResearch` selectors in
  `lib/model_pill.mjs` may be stale (ChatGPT's DR DOM changes periodically) —
  inspect the "+" menu and update the lib.
- If a response was generated but not captured, use `/recover-chat` or re-run the
  watcher on the chat URL (it returns within a minute on a finished chat).
- Never resubmit without first checking whether the chat already completed.
