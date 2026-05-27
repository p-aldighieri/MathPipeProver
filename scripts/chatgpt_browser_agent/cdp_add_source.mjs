#!/usr/bin/env node
/**
 * cdp_add_source.mjs — Add files to a ChatGPT project's Sources tab.
 *
 * Thin shim over lib/sources.mjs. The lib uses the hidden file input
 * (`input[type="file"]:not([accept="image/*"])` + setInputFiles), which
 * is more robust than the earlier visible-button cascade ("Add sources"
 * → "Upload" → filechooser) and survives ChatGPT button position
 * changes.
 *
 * Duplicate-file handling: pass `--on-duplicate replace` to click the
 * Replace button when a duplicate-file modal appears (legacy behavior).
 * Default is `throw`, matching the wrapper's pattern of preferring
 * explicit remove-then-add via `cdp_refresh_sources.mjs`.
 *
 * Usage:
 *   node cdp_add_source.mjs --project-url <URL> [--port <PORT>] \
 *     [--on-duplicate throw|replace] <file1> [file2] ...
 */
import { attachCDP } from './lib/browser.mjs';
import { openSourcesTab, addSource } from './lib/sources.mjs';
import { resolve } from 'path';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222, onDuplicate = 'throw';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--on-duplicate' && args[i + 1]) { onDuplicate = args[++i]; continue; }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node cdp_add_source.mjs --project-url <URL> [--port <PORT>] [--on-duplicate throw|replace] <file1> [file2] ...');
    process.exit(0);
  }
  files.push(resolve(args[i]));
}

if (!projectUrl) { console.error('ERROR: --project-url required'); process.exit(1); }
if (files.length === 0) { console.error('ERROR: at least one file path required'); process.exit(1); }
if (!['throw', 'replace'].includes(onDuplicate)) {
  console.error(`ERROR: --on-duplicate must be 'throw' or 'replace' (got '${onDuplicate}')`);
  process.exit(1);
}

console.log(`Project: ${projectUrl}`);
console.log(`Files: ${files.map(f => f.split(/[\\/]/).pop()).join(', ')}`);
console.log(`On-duplicate: ${onDuplicate}`);

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find(p => p.url().includes('chatgpt.com')) || context.pages()[0] || await context.newPage();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  await openSourcesTab(page);
  await new Promise(r => setTimeout(r, 1500));

  for (const f of files) {
    const baseName = f.split(/[\\/]/).pop();
    try {
      await addSource(page, f, { onDuplicate });
      console.log(`  added: ${baseName}`);
    } catch (e) {
      console.error(`  FAILED: ${baseName} — ${e.message}`);
      throw e;
    }
  }
  console.log('Done.');
  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
