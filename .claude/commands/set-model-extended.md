Set the ChatGPT browser session to the **Extended Pro target**.

Target:
1. **Reasoning:** `Pro`
2. **Model:** `5.5`

## Steps

1. Run the automated script:
   ```bash
   cd C:/repos/MathPipeProver/scripts/chatgpt_browser_agent
   node cdp_set_model_pro.mjs --port PORT
   ```
   Replace PORT with the CDP port for the current session (check memory/session info).

2. If the script succeeds (exit 0), Extended Pro is confirmed.

3. If the script fails, manually fix via Playwright CDP: open the composer model/reasoning pill, select reasoning `Pro`, select model `5.5`, and verify the pill is a Pro variant.

4. Report the final state.

**CRITICAL**: `Thinking + Heavy`, `High`, `Medium`, or any non-Pro reasoning mode is NOT the Extended Pro target. Always verify before submitting.
