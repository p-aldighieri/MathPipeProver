Recover a ChatGPT response from an existing chat URL.

Arguments: $ARGUMENTS
- Format: `--chat-url URL --response-file PATH`

Use the Playwright MCP tools to:

1. Navigate to the provided chat URL.
2. Wait for the page to load and the chat to render.
3. Find the last assistant turn in the conversation.
4. Extract the full response text from that turn.
5. If the text is non-empty and looks like mathematical/proof content (not wrapper text or error), write it to the response file.
6. If the text looks like wrapper text, UI artifacts, or is empty, report the failure and do NOT overwrite any existing response file.

This is used for recovery when:
- A browser submission timed out but ChatGPT actually completed.
- The heartbeat went stale but the response is still in the chat.
- A prior extraction captured incomplete or wrapper text.

Important: Do not overwrite a clean response file with wrapper text. Only write if the recovered content is substantive mathematical output.
