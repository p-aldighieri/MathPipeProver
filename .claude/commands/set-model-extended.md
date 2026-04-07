Set the ChatGPT browser session to **Extended Pro** (Pro model + Extended effort).

This requires TWO separate settings:
1. **Model**: "Pro" (selected via the ChatGPT header dropdown — NOT "Thinking")
2. **Effort**: "Extended" (selected via the Pro pill dropdown in the composer)

The composer pill must show **"Extended Pro"** when correctly configured.

## Steps

1. Run the automated script:
   ```bash
   cd C:/repos/MathPipeProver/scripts/chatgpt_browser_agent
   node cdp_set_model_pro.mjs --port PORT
   ```
   Replace PORT with the CDP port for the current session (check memory/session info).

2. If the script succeeds (exit 0), Extended Pro is confirmed.

3. If the script fails, manually fix via Playwright CDP:
   a. Navigate to chatgpt.com
   b. Click the "ChatGPT ˅" header dropdown → select "Pro"
   c. Click the "Pro >" pill in the composer (next to the "+" button)
   d. Select "Extended" from the sub-menu
   e. Verify pill shows "Extended Pro"

4. Report the final state.

**CRITICAL**: "Thinking + Heavy" is NOT the same as "Extended Pro". They are different models. Always verify the pill shows exactly "Extended Pro".
