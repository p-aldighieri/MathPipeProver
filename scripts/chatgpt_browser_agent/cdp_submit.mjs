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

  // Check model — CRITICAL: ensure pill is on "Pro" reasoning + "GPT-5.5"
  // model (jointly equivalent to the legacy "Extended Pro" label).
  //
  // 2026-05-21 DOM update: ChatGPT removed the
  // `model-switcher-gpt-5-5-pro` / `*-thinking-effort` data-testids. The new
  // composer-pill menu carries:
  //   * Reasoning radios "Instant | 5s" / "Medium | 5–30s" / "High | 15–60s" /
  //     "Pro | 5+ min"  (no data-testid, matched by role + innerText prefix)
  //   * A "GPT-5.5" submenu entry (role=menuitem, data-has-submenu) opening
  //     a child menu of "5.5" / "5.4" / "5.3" / "5.2" / "4.5" / "o3" radios.
  //
  // When reasoning=Pro AND model=5.5 the pill text is exactly "Pro" — this
  // is the new equivalent of legacy "Extended Pro".
  const PILL = 'button.__composer-pill[aria-haspopup="menu"]';
  const readPill = async () => await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || '').trim() : 'unknown';
  }, PILL);
  const isMenuOpen = async () => await page.evaluate((s) =>
    document.querySelector(s)?.getAttribute('aria-expanded') === 'true', PILL);
  const closeMenu = async () => {
    if (await isMenuOpen()) {
      await page.keyboard.press('Escape').catch(() => {});
      await new Promise(r => setTimeout(r, 250));
    }
  };
  const openMenu = async () => {
    await closeMenu();
    await page.locator(PILL).first().click();
    // wait for the reasoning radios to appear
    await page.locator('[role="menuitemradio"]').first()
      .waitFor({ state: 'visible', timeout: 5000 });
  };
  // Returns { reasoning, model } where reasoning ∈ {Instant,Medium,High,Pro}
  // and model is one of the GPT-x submenu values (e.g. "5.5").
  const readCurrentSelection = async () => {
    await openMenu();
    const reasoning = await page.evaluate(() => {
      for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
        if (r.getAttribute('aria-checked') === 'true') {
          const t = (r.innerText || '').trim();
          // text shape: "Pro\n5+ min"; first line is the label
          return t.split(/[\n|]/)[0].trim();
        }
      }
      return null;
    });
    // Hover the GPT-x row to open its submenu and read the checked model
    const gpt = page.locator('[role="menuitem"]', { hasText: /^GPT/ }).first();
    if (await gpt.count() === 0) { await closeMenu(); return { reasoning, model: null }; }
    await gpt.hover();
    await new Promise(r => setTimeout(r, 800));
    const model = await page.evaluate(() => {
      // The submenu's radios are model-version labels like "5.5"
      const radios = [...document.querySelectorAll('[role="menuitemradio"]')];
      for (const r of radios) {
        if (r.getAttribute('aria-checked') !== 'true') continue;
        const t = (r.innerText || '').trim();
        // reasoning labels include " | " so they look like "Pro | 5+ min" or
        // "Pro\n5+ min"; model labels are short like "5.5" / "o3".
        if (/^[0-9]+(\.[0-9]+)?$/.test(t) || /^o\d$/.test(t)) return t;
      }
      return null;
    });
    await closeMenu();
    return { reasoning, model };
  };

  let composerPill = await readPill();
  console.log('Model pill before submit:', composerPill);
  const desired = { reasoning: 'Pro', model: '5.5' };
  let current = await readCurrentSelection();
  console.log('Current selection:', JSON.stringify(current));
  if (current.reasoning !== desired.reasoning || current.model !== desired.model) {
    console.log(`Selection != ${desired.reasoning}+${desired.model}; fixing.`);
    try {
      // Fix reasoning
      if (current.reasoning !== desired.reasoning) {
        await openMenu();
        const clicked = await page.evaluate((target) => {
          for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
            const label = (r.innerText || '').split(/[\n|]/)[0].trim();
            if (label === target) { r.click(); return true; }
          }
          return false;
        }, desired.reasoning);
        if (!clicked) throw new Error(`Reasoning radio "${desired.reasoning}" not found`);
        await new Promise(r => setTimeout(r, 600));
        await closeMenu();
      }
      // Fix model
      if (current.model !== desired.model) {
        await openMenu();
        const gpt = page.locator('[role="menuitem"]', { hasText: /^GPT/ }).first();
        await gpt.hover();
        await new Promise(r => setTimeout(r, 700));
        const clicked = await page.evaluate((target) => {
          for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
            const t = (r.innerText || '').trim();
            if (t === target) { r.click(); return true; }
          }
          return false;
        }, desired.model);
        if (!clicked) throw new Error(`Model radio "${desired.model}" not found`);
        await new Promise(r => setTimeout(r, 800));
        await closeMenu();
      }
    } catch (e) {
      console.error('ERROR setting Pro/5.5:', e.message);
      process.exit(1);
    }
    composerPill = await readPill();
    current = await readCurrentSelection();
    console.log('Model pill after fix:', composerPill);
    console.log('Selection after fix:', JSON.stringify(current));
    if (current.reasoning !== desired.reasoning || current.model !== desired.model) {
      console.error(`ERROR: still wrong after fix. Reasoning=${current.reasoning}, model=${current.model}`);
      process.exit(1);
    }
  }
  console.log('Model: Pro + GPT-5.5 (Extended Pro equivalent; confirmed at submission time)');

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
