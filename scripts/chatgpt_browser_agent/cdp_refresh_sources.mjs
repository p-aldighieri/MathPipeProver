#!/usr/bin/env node
/**
 * cdp_refresh_sources.mjs — Refresh one or more ChatGPT project source files.
 *
 * Wraps `cdp_remove_source_v2.mjs` + `cdp_add_source.mjs` with the cache-bust
 * discipline (remove → sleep → add → sleep) needed so that reviewer chats
 * launched against the project see the latest file content. Without this gap,
 * ChatGPT may serve stale uploads across chat sessions even when remove+add
 * "succeed" from the script's perspective.
 *
 * Usage:
 *   node cdp_refresh_sources.mjs \
 *     --project-url <URL> --port <PORT> \
 *     <abs-path-to-file-1> [<abs-path-to-file-2> ...]
 *
 * For each absolute path, the script:
 *   1. Removes the file by its basename from project sources.
 *   2. Sleeps 3 seconds.
 *   3. Re-uploads the file.
 *   4. Sleeps 5 seconds before processing the next file.
 *
 * Discovery (2026-05-23, PIOTR session): ChatGPT caches uploaded source content
 * for the project per-chat-session. A new chat created BEFORE the remove+add
 * cycle reads the cached prior version. The sleep gaps ensure the project
 * UI commits the change before the next chat is launched.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let projectUrl = '', port = 9222;
const filePaths = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  filePaths.push(args[i]);
}

if (!projectUrl || filePaths.length === 0) {
  console.error('Usage: cdp_refresh_sources.mjs --project-url <URL> --port <PORT> <file1> [<file2> ...]');
  process.exit(2);
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => stdout += d.toString());
    p.stderr.on('data', d => stderr += d.toString());
    p.on('exit', code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`Exit ${code}: ${stderr || stdout}`)));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const removeScript = join(__dirname, 'cdp_remove_source_v2.mjs');
  const addScript = join(__dirname, 'cdp_add_source.mjs');

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const name = basename(filePath);
    console.log(`[${i + 1}/${filePaths.length}] Refreshing ${name}`);

    try {
      console.log(`  remove ${name} ...`);
      await sh('node', [removeScript, '--project-url', projectUrl, '--port', String(port), name]);
    } catch (e) {
      console.log(`  remove ${name}: ${e.message.split('\n')[0]} (may be absent; continuing)`);
    }

    console.log(`  sleep 3s (commit remove)`);
    await sleep(3000);

    console.log(`  add ${name} ...`);
    await sh('node', [addScript, '--project-url', projectUrl, '--port', String(port), filePath]);

    if (i < filePaths.length - 1) {
      console.log(`  sleep 5s (commit add, prevent cache-bleed to next file)`);
      await sleep(5000);
    }
  }

  console.log(`Refreshed ${filePaths.length} source(s). Wait ~5s before launching new chats to bust cache.`);
})().catch(e => { console.error(e); process.exit(1); });
