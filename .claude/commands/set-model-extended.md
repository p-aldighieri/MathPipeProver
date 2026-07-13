Set the ChatGPT browser session to the **Sol Pro target** (a.k.a. GPT 5.6 Sol Pro; legacy name "Extended Pro").

Target:
1. **Reasoning / Intelligence:** `Pro` (top lane of the Intelligence picker)
2. **Model:** `GPT-5.6 Sol` (the picker's bottom model-submenu row — read-only, never probe/hover it)

## Steps

1. Run the automated script:
   ```bash
   cd C:/repos/MathPipeProver/scripts/chatgpt_browser_agent
   node cdp_set_model_pro.mjs --port PORT
   ```
   Replace PORT with the CDP port for the current session (check memory/session info).

2. If the script succeeds (exit 0), Sol Pro is confirmed (pill reads "Pro").

3. If the script fails, manually fix via Playwright CDP: open the composer model/reasoning pill, select the `Pro` intelligence lane, and verify the pill reads "Pro". Check (read-only) that the bottom model row shows `GPT-5.6 Sol`.

4. Report the final state.

**CRITICAL**: `Extra High`, `High`, `Medium`, `Instant`, or any non-Pro lane is NOT the Sol Pro target (`Instant` additionally runs the older GPT-5.5). Always verify before submitting. The enforcement lib warns if the base-model row stops reading GPT-5.6 Sol; set `MPP_STRICT_BASE_MODEL=1` to make that fatal.
