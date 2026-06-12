#!/usr/bin/env node
/**
 * cdp_refresh_sources.mjs — Refresh one or more ChatGPT project source files.
 *
 * For each file path, removes the existing source by basename (if present),
 * waits a cache-bust gap, then re-uploads. The sleep gaps are LOAD-BEARING:
 *
 *   Discovery (2026-05-23, PIOTR session): ChatGPT caches uploaded source
 *   content per-chat-session at the project layer. A new chat created
 *   BEFORE the remove+add cycle commits reads the cached prior version,
 *   even when the remove/add API calls "succeeded". The sleep gaps ensure
 *   the project UI commits each change before the next operation.
 *
 * Post-lib-refactor change: this script now consumes lib/sources.mjs
 * directly instead of shelling out to cdp_remove_source_v2.mjs + the
 * legacy cdp_add_source.mjs. Same browser session for all operations
 * — faster, easier error handling, identical cache-bust semantics.
 *
 * Usage:
 *   node cdp_refresh_sources.mjs --project-url <URL> [--port <PORT>] \
 *     <abs-path-1> [<abs-path-2> ...]
 */
import { attachCDP } from './lib/browser.mjs';
import { openSourcesTab, addSource, removeSource } from './lib/sources.mjs';
import { basename } from 'path';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222;
const filePaths = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i].startsWith('--')) {
    // Unknown flags must hard-fail BEFORE any browser action: a mistyped flag
    // that falls through to filePaths would otherwise remove a live source and
    // then die on the re-add (observed 2026-06-12 with a stray "--file").
    console.error(`ERROR: unknown flag ${args[i]}`);
    console.error('Usage: cdp_refresh_sources.mjs --project-url <URL> [--port <PORT>] <file1> [<file2> ...]');
    process.exit(2);
  }
  filePaths.push(args[i]);
}
if (!projectUrl || filePaths.length === 0) {
  console.error('Usage: cdp_refresh_sources.mjs --project-url <URL> [--port <PORT>] <file1> [<file2> ...]');
  process.exit(2);
}
// Pre-flight: every file must exist before we touch the project, because the
// refresh cycle removes the old source first — failing midway strands the
// project without that source.
const { statSync } = await import('fs');
for (const fp of filePaths) {
  try { statSync(fp); } catch {
    console.error(`ERROR: file not found: ${fp} (aborting before any source removal)`);
    process.exit(2);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find(p => p.url().includes('chatgpt.com')) || context.pages()[0];
  await page.bringToFront();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);
  await openSourcesTab(page);
  await sleep(1500);

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];
    const name = basename(filePath);
    console.log(`[${i + 1}/${filePaths.length}] Refreshing ${name}`);

    try {
      console.log(`  remove ${name} ...`);
      await removeSource(page, name);
    } catch (e) {
      console.log(`  remove ${name}: ${e.message.split('\n')[0]} (may be absent; continuing)`);
    }

    console.log('  sleep 3s (commit remove)');
    await sleep(3000);

    console.log(`  add ${name} ...`);
    await addSource(page, filePath, { onDuplicate: 'replace' });

    if (i < filePaths.length - 1) {
      console.log('  sleep 5s (commit add, prevent cache-bleed to next file)');
      await sleep(5000);
    }
  }

  console.log(`Refreshed ${filePaths.length} source(s). Wait ~5s before launching new chats to bust cache.`);
  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
