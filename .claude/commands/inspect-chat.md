Inspect a live ChatGPT chat to check its current generation state.

Arguments: $ARGUMENTS
- Format: `--chat-url URL --port PORT`

## Steps

Use inline Playwright CDP to:

1. Connect to Chrome via `chromium.connectOverCDP('http://localhost:PORT')`
2. Navigate to the provided chat URL
3. Wait for the page to load (5-8 seconds)
4. Check if still generating: `page.locator('[data-testid="stop-button"]').count() > 0`
5. Extract response text: query all `[data-message-author-role="assistant"]` elements
6. Report:
   - Status: generating / complete / waiting
   - Response length in characters
   - First ~300 characters as preview
   - Chat URL
   - Current timestamp

This is **read-only**. Do not modify anything. Do not submit or interact with the chat.

Used for monitoring long-running Extended Pro responses between heartbeat ticks.
