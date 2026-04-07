Manage durable project sources in a ChatGPT project's Sources tab.

Arguments: $ARGUMENTS
- Format: `--project-url URL --port PORT [--add file1 file2 ...] [--remove name1 name2 ...]`
- If no --add/--remove, just list current sources.

## Adding Sources

```bash
cd C:/repos/MathPipeProver/scripts/chatgpt_browser_agent
node cdp_add_source.mjs --project-url URL --port PORT file1.pdf file2.md ...
```

The script navigates to the project Sources tab, clicks Add → Upload, and uploads the specified files.

## Removing Sources

Removing must be done manually via Playwright CDP:
1. Connect to Chrome on the CDP port
2. Navigate to the project URL
3. Click the Sources tab
4. For each source to remove: hover over it, click the three-dot menu, click Remove

## Source Hygiene Rules

- **4-6 files max** in durable sources
- **Include**: paper PDF, proof-state file, objectives, active route memo
- **Exclude**: per-step packets, prover drafts, old branch files
- Remove stale sources BEFORE adding new ones
- After a consolidator pass: refresh proof-state, remove old versions
- Never duplicate durable sources as composer attachments
