Submit a proof role prompt to ChatGPT via CDP and monitor for completion.

Arguments: $ARGUMENTS
- Format: `--project-url URL --port PORT --prompt-file PATH [--response-file PATH]`

## Steps

1. **Verify Extended Pro** before submitting:
   ```bash
   cd C:/repos/MathPipeProver/scripts/chatgpt_browser_agent
   node cdp_set_model_pro.mjs --port PORT --check-only
   ```
   If not Extended Pro, run `node cdp_set_model_pro.mjs --port PORT` first.

2. **Submit the prompt**:
   ```bash
   node cdp_submit.mjs --project-url URL --port PORT --check-effort PROMPT_FILE
   ```
   The script navigates to the project (starts a fresh chat), verifies Extended Pro, fills the prompt, and sends.

3. **Record the chat URL** from the script output for heartbeat monitoring.

4. **Monitor** via heartbeat or manual polling. Extended Pro responses take 30-90+ minutes.

5. **Harvest** the response when complete using inline Playwright CDP (connect, extract assistant messages, write to response file).

## Recovery

- If the script can't connect to CDP, check Chrome is running on the right port.
- If Extended Pro reverts after navigating to a project, re-run `cdp_set_model_pro.mjs`.
- If a response was generated but not captured, use `/recover-chat`.
- Never resubmit without first checking if the chat already completed.
