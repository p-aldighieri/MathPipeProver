#!/usr/bin/env node
/**
 * cdp_set_model_pro.mjs — verify/set ChatGPT composer to legacy "Extended Pro".
 *
 * 2026-05-21 DOM update: ChatGPT removed the `model-switcher-gpt-5-5-pro`
 * and `*-thinking-effort` data-testids. The composer-pill menu now has:
 *   * Reasoning radios "Instant | 5s" / "Medium | 5–30s" / "High | 15–60s"
 *     / "Pro | 5+ min" (no testid; matched by role + innerText prefix).
 *   * A "GPT-5.5" submenu (role=menuitem, data-has-submenu) opening a child
 *     menu of "5.5" / "5.4" / "5.3" / "5.2" / "4.5" / "o3" radios.
 *
 * The legacy "Extended Pro" label = reasoning "Pro" + model "5.5". When both
 * are set, the pill text reads exactly "Pro".
 *
 * Usage:
 *   node cdp_set_model_pro.mjs [--port <PORT>] [--check-only] [--extended]
 *
 * Flags:
 *   --port <PORT>    CDP debug port (default 9222)
 *   --check-only     Exit 0 if already Pro+5.5; exit 1 otherwise. No edits.
 *   --extended       Back-compat no-op (Pro+5.5 IS Extended Pro in new UI).
 *
 * Exit codes: 0 — Pro+5.5 confirmed; 1 — error or wrong selection.
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
let port = 9222;
let checkOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-only') { checkOnly = true; continue; }
  if (args[i] === '--extended') { /* no-op, kept for back-compat */ continue; }
}

const PILL_SELECTOR = 'button.__composer-pill[aria-haspopup="menu"]';
const TARGET_PILL_TEXT = 'Pro';
const DESIRED = { reasoning: 'Pro', model: '5.5' };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getPillText(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || '').trim() : null;
  }, PILL_SELECTOR);
}

async function isPillOpen(page) {
  return page.evaluate((sel) =>
    document.querySelector(sel)?.getAttribute('aria-expanded') === 'true',
    PILL_SELECTOR);
}

async function closeAnyMenu(page) {
  if (await isPillOpen(page)) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
  }
}

async function openPillMenu(page) {
  await closeAnyMenu(page);
  const pill = page.locator(PILL_SELECTOR).first();
  await pill.waitFor({ state: 'visible', timeout: 10000 });
  await pill.click();
  // Wait for the reasoning radios to appear.
  await page.locator('[role="menuitemradio"]').first()
    .waitFor({ state: 'visible', timeout: 5000 });
}

// Returns { reasoning, model } where:
//   reasoning ∈ {"Instant","Medium","High","Pro"} (or null)
//   model ∈ {"5.5","5.4","5.3","5.2","4.5","o3",...} (or null)
// Caller must ensure the menu is closed before calling; this function
// opens it, reads, opens the submenu, reads, and closes.
async function readCurrentSelection(page) {
  await openPillMenu(page);

  const reasoning = await page.evaluate(() => {
    for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
      if (r.getAttribute('aria-checked') === 'true') {
        const t = (r.innerText || '').trim();
        // Reasoning labels render as "Pro\n5+ min" or "Pro | 5+ min".
        return t.split(/[\n|]/)[0].trim();
      }
    }
    return null;
  });

  // Hover the "GPT-..." row to open its submenu, then read the checked model.
  const gpt = page.locator('[role="menuitem"]', { hasText: /^GPT/ }).first();
  let model = null;
  if (await gpt.count() > 0) {
    await gpt.hover();
    await sleep(700);
    model = await page.evaluate(() => {
      const radios = [...document.querySelectorAll('[role="menuitemradio"]')];
      for (const r of radios) {
        if (r.getAttribute('aria-checked') !== 'true') continue;
        const t = (r.innerText || '').trim();
        // Model labels are short tokens like "5.5" or "o3" (single line);
        // reasoning labels carry a "| 5+ min" or contain a newline.
        if (/^[0-9]+(\.[0-9]+)?$/.test(t) || /^o\d$/.test(t)) return t;
      }
      return null;
    });
  }

  await closeAnyMenu(page);
  return { reasoning, model };
}

async function clickReasoning(page, label) {
  await openPillMenu(page);
  const ok = await page.evaluate((target) => {
    for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
      const t = (r.innerText || '').split(/[\n|]/)[0].trim();
      if (t === target) { r.click(); return true; }
    }
    return false;
  }, label);
  if (!ok) throw new Error(`Reasoning radio "${label}" not found`);
  await sleep(600);
  await closeAnyMenu(page);
}

async function clickModel(page, modelLabel) {
  await openPillMenu(page);
  const gpt = page.locator('[role="menuitem"]', { hasText: /^GPT/ }).first();
  await gpt.hover();
  await sleep(700);
  const ok = await page.evaluate((target) => {
    for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
      const t = (r.innerText || '').trim();
      if (t === target) { r.click(); return true; }
    }
    return false;
  }, modelLabel);
  if (!ok) throw new Error(`Model radio "${modelLabel}" not found`);
  await sleep(700);
  await closeAnyMenu(page);
}

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();
  if (!page.url().includes('chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
  }
  await page.bringToFront();

  const initialPill = await getPillText(page);
  console.log('Current pill:', initialPill);

  const initial = await readCurrentSelection(page);
  console.log('Current selection:', JSON.stringify(initial));

  const isCorrect = initial.reasoning === DESIRED.reasoning && initial.model === DESIRED.model;

  if (isCorrect) {
    console.log('MODEL: Pro + GPT-5.5 (Extended Pro equivalent — already active)');
    await browser.close();
    process.exit(0);
  }

  if (checkOnly) {
    console.log(`MODEL: NOT Pro+5.5 (current: ${initial.reasoning}+${initial.model})`);
    await browser.close();
    process.exit(1);
  }

  if (initial.reasoning !== DESIRED.reasoning) {
    console.log(`Step 1: setting reasoning -> ${DESIRED.reasoning}`);
    await clickReasoning(page, DESIRED.reasoning);
  } else {
    console.log('Step 1: reasoning already Pro.');
  }

  if (initial.model !== DESIRED.model) {
    console.log(`Step 2: setting model -> ${DESIRED.model}`);
    await clickModel(page, DESIRED.model);
  } else {
    console.log('Step 2: model already 5.5.');
  }

  const finalSel = await readCurrentSelection(page);
  const finalPill = await getPillText(page);
  console.log('Final pill:', finalPill);
  console.log('Final selection:', JSON.stringify(finalSel));

  if (finalSel.reasoning === DESIRED.reasoning && finalSel.model === DESIRED.model) {
    console.log('MODEL: Pro + GPT-5.5 (Extended Pro equivalent — confirmed)');
    await page.screenshot({ path: 'C:/tmp/cdp_pro_confirmed.png' }).catch(() => {});
    await browser.close();
    process.exit(0);
  }
  console.error(`ERROR: target Pro+5.5 not reached. Got ${finalSel.reasoning}+${finalSel.model}`);
  await page.screenshot({ path: 'C:/tmp/cdp_pro_failed.png' }).catch(() => {});
  await browser.close();
  process.exit(1);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
