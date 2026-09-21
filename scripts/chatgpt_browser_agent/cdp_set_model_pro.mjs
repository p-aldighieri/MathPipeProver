#!/usr/bin/env node
/**
 * cdp_set_model_pro.mjs — verify/set the ChatGPT composer to the Pro target
 * (currently GPT-6 Pro: "Latest" family + top Power level; pill "6 Pro").
 * Legacy name: the "Extended Pro" / "Sol Pro" target.
 *
 * Thin shim over lib/model_pill.mjs (the single source of truth for pill
 * detection and Pro-target enforcement).
 *
 * Usage:
 *   node cdp_set_model_pro.mjs [--port <PORT>] [--check-only] [--extended]
 *
 * Flags:
 *   --port <PORT>    CDP debug port (default 9222).
 *   --check-only     Exit 0 if the pill already passes the Pro gate;
 *                    exit 1 otherwise. No edits.
 *   --extended       Back-compat no-op (kept so old callers do not break).
 *
 * Exit codes: 0 — Pro target confirmed; 1 — error or wrong selection.
 */

import { attachCDP } from './lib/browser.mjs';
import { readPill, readPickerState, isTargetPill, ensureExtendedPro } from './lib/model_pill.mjs';

const args = process.argv.slice(2);
let port = 9222;
let checkOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-only') { checkOnly = true; continue; }
  if (args[i] === '--extended') { /* no-op, kept for back-compat */ continue; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let close = async () => {};
try {
  const att = await attachCDP({ port });
  close = att.close;
  const ctx = att.context;
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();
  if (!page.url().includes('chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
  }

  const initial = await readPickerState(page);
  console.log('Current picker:', JSON.stringify(initial));

  if (isTargetPill(initial.pill)) {
    console.log(`MODEL: Pro target (already active; pill "${initial.pill}")`);
    await close();
    process.exit(0);
  }

  if (checkOnly) {
    console.log(`MODEL: NOT the Pro target (current pill: "${initial.pill}")`);
    await close();
    process.exit(1);
  }

  console.log(`Setting the Pro target (current pill: "${initial.pill}")`);
  try {
    await ensureExtendedPro(page);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    await close();
    process.exit(1);
  }

  const finalPill = await readPill(page);
  console.log('Final pill:', finalPill);
  if (isTargetPill(finalPill)) {
    console.log('MODEL: Pro target (confirmed)');
    await close();
    process.exit(0);
  }
  console.error(`ERROR: pill is "${finalPill}" after fix, not the Pro target.`);
  await close();
  process.exit(1);
} catch (e) {
  console.error('ERROR:', e.message);
  await close();
  process.exit(1);
}
