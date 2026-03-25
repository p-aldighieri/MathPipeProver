Submit a proof role request to ChatGPT via the browser and wait for the response.

Arguments: $ARGUMENTS
- Format: `--project-url URL --request-file PATH --response-file PATH [--attach PATH ...]`
- All paths should be absolute or relative to the project root.

Prefer the repo browser helper first:

```bash
scripts/chatgpt_browser_agent.sh submit --project-url URL --request-file PATH --response-file PATH [--cdp-url URL] [--attach-file PATH ...]
```

Use Playwright MCP tools only when you need to inspect or repair the live browser state. In that case:

1. Navigate to the ChatGPT project URL.
2. Ensure the model is set to **ChatGPT 5.4 Pro** with **Extended Pro** effort.
3. Click "Add files and more" in the composer area.
4. Upload the request file as an attachment.
5. If `--attach` files are given, upload those too.
6. Type the submission prompt into the composer:
   ```
   Read the attached file `{request_filename}` and answer that request directly.
   The supporting files are attached separately: `file1`, `file2`.
   Follow the role instructions exactly.
   Use the durable project sources when relevant.
   Return only the substantive markdown answer for the role.
   ```
7. Click "Send prompt" to submit.
8. Poll the page for a stable assistant reply:
   - Check if a stop/pause button is visible (means still generating).
   - Read the latest assistant turn text.
   - Wait until text stabilizes for 2+ cycles with no stop button.
   - Default poll interval: 10 seconds, max wait: 90 minutes.
9. Once stable, extract the full response text.
10. Write the response to the specified response file.
11. Report: chat URL, response length, and completion status.

Recovery:
- If the response file is missing but the chat URL exists, inspect and recover the existing chat before resubmitting.
- If the project URL, model, effort mode, or durable sources drifted, repair them and retry.
- If ChatGPT shows an account chooser and there is one clear account entry, select it and continue.
- Only ask for human help after the browser state has been re-checked and a real auth/infrastructure blocker remains.
