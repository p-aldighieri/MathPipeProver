Set the ChatGPT browser session to the **Pro target** — currently **GPT-6 Pro** (legacy names "Sol Pro", "Extended Pro").

Target:
1. **Model family:** the `Latest` radio (GPT-6 today). It lives in the picker's advanced view, opened from the `Select model` header row.
2. **Power:** the top step of the 5-step `Power` slider, labelled `Pro` ("Pro, 5 of 5").

The composer pill then reads **"6 Pro"**.

## Steps

1. Run the automated script from the repo root:
   ```bash
   node scripts/chatgpt_browser_agent/cdp_set_model_pro.mjs --port PORT
   ```
   Replace PORT with the CDP port for the current session (check memory/session info). Add `--check-only` to verify without changing anything.

2. If the script succeeds (exit 0), the Pro target is confirmed (pill reads "6 Pro").

3. If the script fails, fix it manually via Playwright CDP: open the composer pill, click `Select model`, pick `Latest`, focus the `Power` row and press ArrowRight until the slider reads "Pro, 5 of 5", close the menu, and verify the pill reads "6 Pro".

4. Report the final state.

**CRITICAL**: `5.6 Pro`, `6 Extra High`, a bare `Extra High`, `High`, `Medium`, or any other combination is NOT the Pro target. The gate in `lib/model_pill.mjs` accepts a `Pro` tier on a model family ≥ 6 (override with `MPP_MODEL_FAMILY` / `MPP_MIN_MODEL_VERSION`), and every submit path re-checks the pill right before sending.
