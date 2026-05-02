#!/usr/bin/env node
/**
 * cdp_set_model_pro.mjs — Verify and set ChatGPT to "Extended Pro" via CDP.
 *
 * "Extended Pro" requires TWO settings, both reachable from the composer pill:
 *   1. Model = Pro   (radio item data-testid="model-switcher-gpt-5-5-pro")
 *   2. Effort = Extended (radio under the Pro row's trailing "thinking-effort" submenu)
 *
 * The composer pill must show "Extended Pro" when correctly configured.
 *
 * Usage:
 *   node cdp_set_model_pro.mjs [--port <PORT>] [--check-only]
 *
 * Exit codes: 0 — Extended Pro confirmed; 1 — error or not Extended Pro.
 *
 * UI history: ChatGPT removed the header "ChatGPT v" model dropdown. Model and
 * effort are now both selected from the composer pill's unified menu, so this
 * script no longer touches the header.
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
let port = 9222;
let checkOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-only') { checkOnly = true; continue; }
}

const PILL_SELECTOR = 'button.__composer-pill[aria-haspopup="menu"]';
const PRO_RADIO_TESTID = 'model-switcher-gpt-5-5-pro';
const PRO_EFFORT_BTN_TESTID = 'model-switcher-gpt-5-5-pro-thinking-effort';
const TARGET_PILL_TEXT = 'Extended Pro';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getPillText(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return (el.textContent || '').trim();
  }, PILL_SELECTOR);
}

async function isPillOpen(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('aria-expanded') === 'true' : false;
  }, PILL_SELECTOR);
}

async function closeAnyMenu(page) {
  if (await isPillOpen(page)) {
    await page.keyboard.press('Escape');
    await sleep(300);
  }
}

async function openPillMenu(page) {
  await closeAnyMenu(page);
  const pill = page.locator(PILL_SELECTOR).first();
  await pill.waitFor({ state: 'visible', timeout: 10000 });
  await pill.click();
  // Wait for the model radio to appear in the menu
  await page.locator(`[data-testid="${PRO_RADIO_TESTID}"]`).first()
    .waitFor({ state: 'visible', timeout: 5000 });
}

async function isProSelected(page) {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    return el ? el.getAttribute('aria-checked') === 'true' : false;
  }, PRO_RADIO_TESTID);
}

async function getCurrentEffort(page) {
  // Reads aria-label on the trailing chevron button — reads "Effort" generically,
  // but the parent menuitemradio's text shows e.g. "Pro• Extended". Pull from sibling text.
  return page.evaluate((tid) => {
    const row = document.querySelector(`[data-testid="${tid}"]`);
    if (!row) return null;
    const txt = (row.textContent || '').trim();
    // "Pro• Extended" or "Pro• Standard"
    const m = txt.match(/^Pro[•\s·]+(Standard|Extended)/i);
    return m ? m[1] : null;
  }, PRO_RADIO_TESTID);
}

async function selectPro(page) {
  const row = page.locator(`[data-testid="${PRO_RADIO_TESTID}"]`).first();
  await row.click();
  // Selecting a model usually closes the menu; wait briefly.
  await sleep(800);
}

async function selectExtendedEffort(page) {
  // Menu must be open. Hover the Pro row to reveal trailing chevron, then JS-click it.
  const row = page.locator(`[data-testid="${PRO_RADIO_TESTID}"]`).first();
  await row.hover();
  await sleep(300);

  const clicked = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, PRO_EFFORT_BTN_TESTID);
  if (!clicked) throw new Error('Pro effort chevron button not found');
  await sleep(700);

  // The submenu contains role=menuitemradio items "Standard" / "Extended"
  const ok = await page.evaluate(() => {
    const radios = document.querySelectorAll('[role="menuitemradio"]');
    for (const r of radios) {
      const t = (r.textContent || '').trim();
      if (t === 'Extended') {
        r.click();
        return true;
      }
    }
    return false;
  });
  if (!ok) throw new Error('Extended option not found in effort submenu');
  await sleep(800);
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

  // Step 0: quick check via pill text
  const initial = await getPillText(page);
  console.log('Current pill:', initial);
  if (initial === TARGET_PILL_TEXT) {
    console.log('MODEL: Extended Pro (already active)');
    await browser.close();
    process.exit(0);
  }
  if (checkOnly) {
    console.log(`MODEL: NOT Extended Pro (current: ${initial})`);
    await browser.close();
    process.exit(1);
  }

  // Step 1: open pill menu, ensure Pro is selected
  console.log('Step 1: ensuring Pro model...');
  await openPillMenu(page);
  if (!(await isProSelected(page))) {
    console.log('  Pro not selected — clicking Pro radio.');
    await selectPro(page);
    // Selecting Pro typically closes the menu; reopen for effort handling.
    await openPillMenu(page);
  } else {
    console.log('  Pro already selected.');
  }

  // Step 2: ensure effort is Extended
  const currentEffort = await getCurrentEffort(page);
  console.log(`Step 2: current effort = ${currentEffort}`);
  if (currentEffort !== 'Extended') {
    console.log('  Switching to Extended effort...');
    await selectExtendedEffort(page);
  } else {
    console.log('  Already Extended.');
  }

  await closeAnyMenu(page);
  await sleep(500);

  // Verify
  const finalPill = await getPillText(page);
  console.log('Final pill:', finalPill);
  if (finalPill === TARGET_PILL_TEXT) {
    console.log('MODEL: Extended Pro (confirmed)');
    await page.screenshot({ path: 'C:/tmp/cdp_extended_pro_confirmed.png' }).catch(() => {});
    await browser.close();
    process.exit(0);
  }
  console.error(`ERROR: Expected "${TARGET_PILL_TEXT}", got: ${finalPill}`);
  await page.screenshot({ path: 'C:/tmp/cdp_extended_pro_failed.png' }).catch(() => {});
  await browser.close();
  process.exit(1);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
