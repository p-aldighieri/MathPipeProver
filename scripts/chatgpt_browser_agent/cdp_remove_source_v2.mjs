#!/usr/bin/env node
/**
 * cdp_remove_source_v2.mjs — Remove durable project sources by name.
 *
 * Thin shim over lib/sources.mjs. The lib's removeSource adopts this
 * script's pre-refactor strict superset: opens the Source actions
 * menu, clicks Remove, then handles the optional confirmation dialog
 * (Remove/Confirm/Delete button) that ChatGPT shows in some account
 * configurations.
 *
 * Usage:
 *   node cdp_remove_source_v2.mjs --project-url <URL> [--port <PORT>] <name1> [name2] ...
 *
 * Output (stdout): JSON { removed, skipped, finalSources }.
 */
import { attachCDP } from './lib/browser.mjs';
import { openSourcesTab, listSources, removeSource } from './lib/sources.mjs';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222;
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  names.push(args[i]);
}
if (!projectUrl || names.length === 0) {
  console.error('Usage: cdp_remove_source_v2.mjs --project-url <URL> [--port <PORT>] <name1> [name2] ...');
  process.exit(2);
}

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find(p => p.url().includes('chatgpt.com')) || context.pages()[0];
  await page.bringToFront();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await openSourcesTab(page);
  await page.waitForTimeout(1500);

  const initial = await listSources(page);
  console.log('Initial sources:', JSON.stringify(initial));

  const removed = [], skipped = [];
  for (const name of names) {
    if (!initial.includes(name)) {
      // Re-check live in case `initial` was stale
      const live = await listSources(page);
      if (!live.includes(name)) { skipped.push(`${name} (not present)`); continue; }
    }
    try {
      await removeSource(page, name);
      removed.push(name);
    } catch (e) {
      skipped.push(`${name} (${e.message.split('\n')[0]})`);
    }
  }

  const finalSources = await listSources(page);
  console.log(JSON.stringify({ removed, skipped, finalSources }, null, 2));
  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
