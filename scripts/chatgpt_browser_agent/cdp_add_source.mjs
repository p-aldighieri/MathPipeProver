#!/usr/bin/env node
/**
 * cdp_add_source_v2.mjs — Add files to a ChatGPT project's Sources tab via CDP.
 *
 * Usage:
 *   node cdp_add_source_v2.mjs --project-url <URL> --port <CDP_PORT> <file1> [file2] ...
 *
 * Options:
 *   --project-url <URL>   Full ChatGPT project URL (required)
 *                         e.g. https://chatgpt.com/g/g-p-XXXX/project
 *   --port <PORT>         CDP remote-debugging port (default: 9222)
 *   --timeout <MS>        Navigation/upload timeout in ms (default: 30000)
 *
 * Examples:
 *   node cdp_add_source_v2.mjs --project-url https://chatgpt.com/g/g-p-abc123/project \
 *     --port 9225 proof_state.md objectives.md paper.pdf
 *
 * How it works:
 *   1. Connects to Chrome via CDP on the given port
 *   2. Navigates to the project's Sources tab
 *   3. Clicks the "Add" button in the sources area (not the composer attachment button)
 *   4. Clicks "Upload" in the dialog
 *   5. Selects the provided files via the file chooser
 *   6. Waits for upload to complete
 *
 * Notes:
 *   - Chrome must already be running with --remote-debugging-port=<PORT>
 *   - User must already be logged into ChatGPT in that Chrome instance
 *   - The "Add" button is located by position (lower on the page) to distinguish
 *     it from the composer's "+" attachment button
 */

import { chromium } from 'playwright';
import { resolve } from 'path';

// ── Parse CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
let projectUrl = '';
let port = 9222;
let timeout = 30000;
const files = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--timeout' && args[i + 1]) { timeout = parseInt(args[++i], 10); continue; }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node cdp_add_source_v2.mjs --project-url <URL> [--port <PORT>] <file1> [file2] ...');
    process.exit(0);
  }
  // Anything else is a file path
  files.push(resolve(args[i]));
}

if (!projectUrl) {
  console.error('ERROR: --project-url is required');
  console.error('Usage: node cdp_add_source_v2.mjs --project-url <URL> [--port <PORT>] <file1> [file2] ...');
  process.exit(1);
}
if (files.length === 0) {
  console.error('ERROR: At least one file path is required');
  process.exit(1);
}

console.log(`Project: ${projectUrl}`);
console.log(`CDP port: ${port}`);
console.log(`Files: ${files.map(f => f.split(/[\\/]/).pop()).join(', ')}`);

// ── Main ────────────────────────────────────────────────────────
try {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) { page = await ctx.newPage(); }

  // Navigate to project
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  // Click Sources tab
  const sourcesTab = page.getByText('Sources', { exact: true }).first();
  if (await sourcesTab.count() > 0) {
    await sourcesTab.click();
    await new Promise(r => setTimeout(r, 2000));
    console.log('On Sources tab');
  } else {
    console.error('ERROR: Sources tab not found');
    await browser.close();
    process.exit(1);
  }

  // Find the Add button in the sources section (lower on the page, y > 300).
  // This distinguishes it from the composer "+" button near the top.
  const addBtns = page.locator('button');
  const count = await addBtns.count();
  let clicked = false;

  // First try: look for an "Add sources" link/button
  const addSourcesBtn = page.getByText('Add sources', { exact: false }).first();
  if (await addSourcesBtn.count() > 0) {
    await addSourcesBtn.click();
    console.log('Clicked "Add sources"');
    clicked = true;
  }

  // Second try: look for a standalone "Add" button low on the page
  if (!clicked) {
    for (let i = 0; i < count; i++) {
      const btn = addBtns.nth(i);
      const text = await btn.textContent();
      if (text && text.trim() === 'Add') {
        const box = await btn.boundingBox();
        if (box && box.y > 300) {
          await btn.click();
          console.log(`Clicked "Add" button at y=${Math.round(box.y)}`);
          clicked = true;
          break;
        }
      }
    }
  }

  if (!clicked) {
    console.error('ERROR: Could not find Add/Add sources button');
    await browser.close();
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 2000));

  // Click Upload in the dialog
  const uploadBtn = page.getByText('Upload', { exact: true }).first();
  if (await uploadBtn.count() > 0) {
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 10000 }),
      uploadBtn.click()
    ]);
    await fileChooser.setFiles(files);
    console.log(`Uploaded ${files.length} file(s)`);
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.error('ERROR: Upload option not found in dialog');
    await browser.close();
    process.exit(1);
  }

  // Verify upload
  await page.screenshot({ path: 'C:/tmp/cdp_add_source_result.png' });
  console.log('Screenshot: C:/tmp/cdp_add_source_result.png');
  console.log('Done.');

  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
