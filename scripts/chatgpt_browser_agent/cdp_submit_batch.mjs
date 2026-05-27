#!/usr/bin/env node
/**
 * cdp_submit_batch.mjs — Submit N prompts to a ChatGPT project in sequence.
 *
 * Each prompt is submitted via the canonical `cdp_submit.mjs`, creating a
 * separate chat. The script returns the resulting chat URLs as JSON so the
 * orchestrator can dispatch parallel pollers (typically `wait_chat_done`).
 *
 * Despite the name, submissions are sequential with a configurable delay
 * (too short causes submit-collision: two prompts land in the same chat).
 * "Batch" refers to the API surface, not parallelism on the browser side
 * — ChatGPT's composer is single-threaded per tab.
 *
 * ## Refactor note (post lib-unification)
 *
 * Earlier versions of this script spawned `cdp_submit_no_model_check.mjs`,
 * a sibling that no longer exists in the repository (silent FAIL on every
 * batch). After the lib refactor, `cdp_submit.mjs` enforces Extended Pro
 * via lib/model_pill.mjs with adaptive fallback — there's no longer a
 * reason to skip the model check, and the spawn target is now the
 * canonical `cdp_submit.mjs`.
 *
 * Usage:
 *   node cdp_submit_batch.mjs \
 *     --project-url <URL> --port <PORT> \
 *     [--delay-ms <ms-between-submits>] \
 *     <prompt-file-1> [<prompt-file-2> ...]
 *
 * Output (stdout): JSON array of {file, chatUrl, status} objects.
 * Output (stderr): per-submit progress.
 *
 * Default delay between submits: 2000ms.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let projectUrl = '', port = 9222, delayMs = 2000;
const promptFiles = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--delay-ms' && args[i + 1]) { delayMs = parseInt(args[++i], 10); continue; }
  promptFiles.push(args[i]);
}

if (!projectUrl || promptFiles.length === 0) {
  console.error('Usage: cdp_submit_batch.mjs --project-url <URL> --port <PORT> [--delay-ms <ms>] <prompt-file-1> ...');
  process.exit(2);
}

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d.toString());
    p.stderr.on('data', d => stderr += d.toString());
    p.on('exit', code => resolve({ code, stdout, stderr }));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractChatUrl(stdoutText) {
  const m = stdoutText.match(/Chat URL:\s*(\S+)/);
  return m ? m[1] : null;
}

(async () => {
  const submitScript = join(__dirname, 'cdp_submit.mjs');
  const results = [];

  for (let i = 0; i < promptFiles.length; i++) {
    const file = promptFiles[i];
    process.stderr.write(`[${i + 1}/${promptFiles.length}] Submitting ${basename(file)} ... `);

    const r = await sh('node', [submitScript, '--project-url', projectUrl, '--port', String(port), file]);
    const chatUrl = extractChatUrl(r.stdout);

    if (chatUrl) {
      process.stderr.write(`OK ${chatUrl}\n`);
      results.push({ file, chatUrl, status: 'ok' });
    } else {
      process.stderr.write(`FAIL\n${r.stderr || r.stdout}\n`);
      results.push({ file, chatUrl: null, status: 'fail', stderr: r.stderr });
    }

    if (i < promptFiles.length - 1) {
      await sleep(delayMs);
    }
  }

  // stdout = pure JSON for downstream consumption
  console.log(JSON.stringify(results, null, 2));

  const failures = results.filter(r => r.status !== 'ok').length;
  process.exit(failures > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
