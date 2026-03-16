Inspect a live ChatGPT chat to check its current state.

Arguments: $ARGUMENTS
- Format: `URL` (the chat URL to inspect)

Use the Playwright MCP tools to:

1. Navigate to the provided chat URL.
2. Wait for the page to render.
3. Check if the model is still generating (look for stop/pause buttons).
4. Read the latest assistant turn text.
5. Report:
   - Chat URL
   - Whether it's still generating or done
   - Response length in characters
   - First ~200 characters as a preview
   - Current timestamp

This is a read-only inspection. Do not modify anything.
Used for monitoring long-running ChatGPT Pro extended responses.
