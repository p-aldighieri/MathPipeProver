## Output Contract

Return the deliverable inline in this chat so the orchestrator can harvest it cleanly.

- Do not try to edit repository files in place.
- Do not ask the orchestrator to click, download, export, or create a sidecar file for you.
- Do not rely on attachments, Canvas, or side panels as the primary output channel.
- Put the final deliverable directly in the response body.
- If the natural deliverable is markdown, return plain markdown only.
- If the natural deliverable is another format, place that payload in exactly one fenced code block with the correct language tag.
- Keep any prefatory note outside the deliverable to one short sentence at most.
- Follow the role-specific section order exactly when one is requested.
