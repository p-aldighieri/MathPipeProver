Refresh durable project sources in the active ChatGPT project.

Arguments: $ARGUMENTS
- Format: `--project-url URL [--add path1 path2 ...] [--remove name1 name2 ...]`
- If no arguments given, just open the Sources tab and list what's currently there.

Use the Playwright MCP tools to:

1. Navigate to the ChatGPT project URL provided (or the current page if already on a project page).
2. Find and click the "Sources" tab on the project page.
3. If `--remove` names are given:
   a. For each source name, find it in the sources list.
   b. Click its "Source actions" button (three-dot menu or similar).
   c. Click "Remove" from the context menu.
   d. Confirm the source is gone.
4. If `--add` paths are given:
   a. For each file path, use the file upload input on the Sources tab.
   b. Upload the file and confirm it appears in the sources list.
5. Report what sources are now in the project.

Important rules from the soft scaffolding guide:
- Do not duplicate durable files as temporary attachments.
- Remove stale branch-specific sources BEFORE adding new ones.
- Durable sources should include: objective statement, paper PDF, proof-state file, current route memo.
- Temporary per-chat attachments (packets, drafts) should NOT be added as durable sources.
