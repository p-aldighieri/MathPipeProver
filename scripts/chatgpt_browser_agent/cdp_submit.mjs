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
let promptFile = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--timeout' && args[i + 1]) { timeout = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-effort') { /* flag is now default; kept as no-op for back-compat */ continue; }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node cdp_submit.mjs --project-url <URL> [--port <PORT>] <prompt_file>');
    console.log('Note: Extended Pro is always enforced at submission; --check-effort is a no-op (legacy flag).');
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

  // Check model — CRITICAL: Must be "Extended Pro". This check is ALWAYS run
  // because navigation to the project URL can reset the composer pill.
  // Selectors target the new (post-header-removal) composer-pill menu:
  //   pill: button.__composer-pill[aria-haspopup="menu"]
  //   Pro radio: data-testid="model-switcher-gpt-5-5-pro"
  //   Pro effort chevron: data-testid="model-switcher-gpt-5-5-pro-thinking-effort"
  const PILL = 'button.__composer-pill[aria-haspopup="menu"]';
  const PRO_TID = 'model-switcher-gpt-5-5-pro';
  const PRO_EFFORT_TID = 'model-switcher-gpt-5-5-pro-thinking-effort';
  const readPill = async () => await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || '').trim() : 'unknown';
  }, PILL);
  const closeMenu = async () => {
    const open = await page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-expanded') === 'true', PILL);
    if (open) { await page.keyboard.press('Escape').catch(() => {}); await new Promise(r => setTimeout(r, 250)); }
  };
  const openMenu = async () => {
    await closeMenu();
    await page.locator(PILL).first().click();
    await page.locator(`[data-testid="${PRO_TID}"]`).first()
      .waitFor({ state: 'visible', timeout: 5000 });
  };

  let composerPill = await readPill();
  console.log('Model pill before submit:', composerPill);
  if (composerPill !== 'Extended Pro') {
    console.log('Pill not Extended Pro — setting it now.');
    try {
      await openMenu();
      const proSelected = await page.evaluate((tid) =>
        document.querySelector(`[data-testid="${tid}"]`)?.getAttribute('aria-checked') === 'true', PRO_TID);
      if (!proSelected) {
        await page.locator(`[data-testid="${PRO_TID}"]`).first().click();
        await new Promise(r => setTimeout(r, 800));
        await openMenu();
      }
      const effort = await page.evaluate((tid) => {
        const t = (document.querySelector(`[data-testid="${tid}"]`)?.textContent || '').trim();
        const m = t.match(/^Pro[•\s·]+(Standard|Extended)/i);
        return m ? m[1] : null;
      }, PRO_TID);
      if (effort !== 'Extended') {
        await page.locator(`[data-testid="${PRO_TID}"]`).first().hover();
        await new Promise(r => setTimeout(r, 300));
        const chev = await page.evaluate((tid) => {
          const el = document.querySelector(`[data-testid="${tid}"]`); if (!el) return false; el.click(); return true;
        }, PRO_EFFORT_TID);
        if (!chev) throw new Error('Pro effort chevron not found');
        await new Promise(r => setTimeout(r, 700));
        const ok = await page.evaluate(() => {
          for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
            if ((r.textContent || '').trim() === 'Extended') { r.click(); return true; }
          }
          return false;
        });
        if (!ok) throw new Error('Extended option not found in effort submenu');
        await new Promise(r => setTimeout(r, 800));
      }
      await closeMenu();
    } catch (e) {
      console.error('ERROR setting Extended Pro:', e.message);
      process.exit(1);
    }
    composerPill = await readPill();
    console.log('Model pill after fix:', composerPill);
    if (composerPill !== 'Extended Pro') {
      console.error('ERROR: still not Extended Pro after fix. Pill: ' + composerPill);
      console.error('Run cdp_set_model_pro.mjs first, or manually fix in browser.');
      process.exit(1);
    }
  }
  console.log('Model: Extended Pro (confirmed at submission time)');

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
