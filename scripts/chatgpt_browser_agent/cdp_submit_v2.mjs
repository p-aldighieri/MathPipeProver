#!/usr/bin/env node
/**
 * cdp_submit_v2.mjs — Submit a prompt to a ChatGPT project via CDP.
 *
 * Usage:
 *   node cdp_submit_v2.mjs --project-url <URL> --port <CDP_PORT> <prompt_file>
 *
 * Options:
 *   --project-url <URL>   Full ChatGPT project URL (required)
 *                         e.g. https://chatgpt.com/g/g-p-XXXX/project
 *   --port <PORT>         CDP remote-debugging port (default: 9222)
 *   --timeout <MS>        Navigation timeout in ms (default: 30000)
 *   --check-effort        Verify effort pill shows "Heavy thinking" before sending
 *
 * Examples:
 *   node cdp_submit_v2.mjs --project-url https://chatgpt.com/g/g-p-abc123/project \
 *     --port 9225 --check-effort prompt.md
 *
 * How it works:
 *   1. Connects to Chrome via CDP
 *   2. Navigates to the project page (starts a fresh chat)
 *   3. Optionally verifies the effort pill
 *   4. Fills the prompt textarea with the file contents
 *   5. Clicks send
 *   6. Reports the chat URL and whether generation started
 */

import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Parse CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
let projectUrl = '';
let port = 9222;
let timeout = 30000;
let checkEffort = false;
let promptFile = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--timeout' && args[i + 1]) { timeout = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-effort') { checkEffort = true; continue; }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node cdp_submit_v2.mjs --project-url <URL> [--port <PORT>] [--check-effort] <prompt_file>');
    process.exit(0);
  }
  promptFile = resolve(args[i]);
}

if (!projectUrl) { console.error('ERROR: --project-url required'); process.exit(1); }
if (!promptFile) { console.error('ERROR: prompt file path required'); process.exit(1); }

const promptText = readFileSync(promptFile, 'utf-8');
console.log(`Prompt: ${promptFile.split(/[\\/]/).pop()} (${promptText.length} chars)`);
console.log(`Project: ${projectUrl}`);
console.log(`CDP port: ${port}`);

// ── Main ────────────────────────────────────────────────────────
try {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  // Navigate to project page (opens fresh chat)
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  // Check model — CRITICAL: Pro is a separate model from Thinking+Heavy
  if (checkEffort) {
    const composerPill = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const rect = btn.getBoundingClientRect();
        if (rect.y > 300) {
          const text = btn.textContent.trim();
          if (text.includes('Pro') || text.includes('thinking') || text.includes('Extended')) {
            return text;
          }
        }
      }
      return 'unknown';
    });
    console.log('Model pill:', composerPill);
    if (composerPill.includes('Pro')) {
      console.log('Model: Pro (correct)');
    } else {
      console.error('WARNING: Model is NOT Pro! Pill shows: ' + composerPill);
      console.error('Run cdp_set_model_pro.mjs first to switch to Pro model.');
    }
  }

  // Fill textarea
  const textarea = page.locator('[id="prompt-textarea"]');
  await textarea.waitFor({ timeout: 10000 });
  await textarea.click();
  await new Promise(r => setTimeout(r, 500));
  await textarea.fill(promptText);
  console.log('Filled prompt');
  await new Promise(r => setTimeout(r, 1500));

  // Send
  const sendBtn = page.locator('[data-testid="send-button"]');
  if (await sendBtn.count() > 0) {
    await sendBtn.click();
    console.log('SENT');
  } else {
    console.error('WARNING: Send button not found');
  }

  await new Promise(r => setTimeout(r, 8000));
  const chatUrl = page.url();
  console.log('Chat URL:', chatUrl);

  const generating = await page.locator('[data-testid="stop-button"]').count() > 0;
  console.log('Generating:', generating ? 'YES' : 'NO');

  await page.screenshot({ path: 'C:/tmp/cdp_submit_result.png' });
  console.log('Screenshot: C:/tmp/cdp_submit_result.png');

  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
