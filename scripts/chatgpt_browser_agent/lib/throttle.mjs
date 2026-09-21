/**
 * lib/throttle.mjs — keep submissions to ChatGPT spaced out.
 *
 * ChatGPT answers bursts of activity with "You're making requests too
 * quickly" (seen 2026-09-21 after eight role submissions, each uploading
 * several attachments, within ~15 minutes while five watchers reloaded chat
 * pages). Every submit path calls respectSubmitGap() before it starts and
 * recordSubmit() after the message is sent, so consecutive submissions on
 * one machine are at least MPP_MIN_SUBMIT_GAP_SECONDS apart (default 180),
 * whichever script or process sends them. The state is one timestamp file
 * per CDP endpoint under ~/.mathpipeprover/.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_GAP_SECONDS = Number(process.env.MPP_MIN_SUBMIT_GAP_SECONDS || '180');

// Key by CDP port when there is one, so "http://127.0.0.1:9225", "localhost:9225"
// and a bare 9225 share one pacing clock.
function stampFile(endpoint) {
  const text = String(endpoint ?? 'default');
  const port = text.match(/(?:^|:)(\d{2,5})\/?$/);
  const key = port ? `port_${port[1]}` : text.replace(/[^A-Za-z0-9]+/g, '_');
  return path.join(os.homedir(), '.mathpipeprover', `last_submit_${key}.json`);
}

/** Wait until the minimum gap since the last recorded submission has passed. */
export async function respectSubmitGap(endpoint, minGapSeconds = DEFAULT_GAP_SECONDS) {
  if (!(minGapSeconds > 0)) return;
  let last = 0;
  try {
    last = JSON.parse(fs.readFileSync(stampFile(endpoint), 'utf8')).at || 0;
  } catch { /* no previous submission recorded */ }
  const waitMs = last + minGapSeconds * 1000 - Date.now();
  if (waitMs > 0) {
    console.error(`Pacing: last submission ${Math.round((Date.now() - last) / 1000)}s ago; ` +
      `waiting ${Math.ceil(waitMs / 1000)}s (MPP_MIN_SUBMIT_GAP_SECONDS=${minGapSeconds}).`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** Record that a submission was just sent through this endpoint. */
export function recordSubmit(endpoint) {
  const file = stampFile(endpoint);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: Date.now() }));
  } catch { /* pacing is best-effort */ }
}
