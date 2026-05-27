#!/usr/bin/env node
/**
 * list_sources.mjs — list durable project sources for a ChatGPT project.
 *
 * Thin shim over lib/sources.mjs (single source of truth for the
 * Sources tab DOM heuristics). The earlier inline regex scrape in this
 * file was a weaker fallback that often missed sources without standard
 * file extensions.
 *
 * Usage:
 *   node list_sources.mjs --project-url <URL> [--port <PORT>]
 */
import { attachCDP } from './lib/browser.mjs';
import { openSourcesTab, listSources } from './lib/sources.mjs';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) projectUrl = args[++i];
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
}
if (!projectUrl) { console.error('ERROR: --project-url required'); process.exit(1); }

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find(p => p.url().includes('chatgpt.com')) || context.pages()[0];
  await page.bringToFront();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  await openSourcesTab(page);
  await new Promise(r => setTimeout(r, 1500));

  const names = await listSources(page);
  console.log('Detected sources:');
  for (const n of names) console.log('  ', n);
  console.log(JSON.stringify({ count: names.length, sources: names }, null, 2));

  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
