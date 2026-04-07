Recover a ChatGPT response from an existing chat URL and save to file.

Arguments: $ARGUMENTS
- Format: `--chat-url URL --port PORT --response-file PATH`

## Steps

Use inline Playwright CDP to:

1. Connect to Chrome via `chromium.connectOverCDP('http://localhost:PORT')`
2. Navigate to the provided chat URL
3. Wait for the page to load (8+ seconds)
4. Check if still generating — if yes, report and exit without writing
5. Extract ALL assistant turn text from `[data-message-author-role="assistant"]` elements
6. Validate: response must be >500 chars and contain mathematical content (not UI artifacts)
7. If valid: write to the response file path
8. If invalid: report failure, do NOT overwrite any existing response file

## When to Use

- Browser submission timed out but ChatGPT actually completed
- Heartbeat went stale but response exists in the chat
- Prior extraction captured incomplete or garbled text
- Need to re-harvest a response after a Chrome restart

## Safety

- Never overwrite a clean response file with garbage/wrapper text
- Always check generation status before extracting
- If the chat shows an error message from ChatGPT, report it rather than saving it as a response
