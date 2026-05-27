#!/usr/bin/env node
/**
 * cdp_set_model_pro.mjs — verify/set ChatGPT composer to Extended Pro.
 *
 * Thin shim over lib/model_pill.mjs (the single source of truth for pill
 * detection and Extended Pro enforcement). This file used to carry its
 * own copy of the pill logic; after the 2026-05-21 / 2026-05-25 DOM
 * changes that copy went stale (it tried to read a GPT-version submenu
 * that no longer exists, and always reported failure on --check-only).
 *
 * Usage:
 *   node cdp_set_model_pro.mjs [--port <PORT>] [--check-only] [--extended]
 *
 * Flags:
 *   --port <PORT>    CDP debug port (default 9222).
 *   --check-only     Exit 0 if pill already reads "Extended Pro"/"Pro";
 *                    exit 1 otherwise. No edits.
 *   --extended       Back-compat no-op (Pro IS Extended Pro in the
 *                    current UI; the separate effort submenu is gone).
 *
 * Exit codes: 0 — Extended Pro confirmed; 1 — error or wrong selection.
 */

import { attachCDP } from './lib/browser.mjs';
import { readPill, ensureExtendedPro, EXTENDED_PRO_LABELS } from './lib/model_pill.mjs';

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
  await page.bringToFront();

  const initialPill = await readPill(page);
  console.log('Current pill:', initialPill);

  if (EXTENDED_PRO_LABELS.includes(initialPill)) {
    console.log('MODEL: Extended Pro / Pro (already active)');
    await close();
    process.exit(0);
  }

  if (checkOnly) {
    console.log(`MODEL: NOT Extended Pro (current pill: "${initialPill}")`);
    await close();
    process.exit(1);
  }

  console.log(`Setting pill to Extended Pro (current: "${initialPill}")`);
  try {
    await ensureExtendedPro(page);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    await close();
    process.exit(1);
  }

  const finalPill = await readPill(page);
  console.log('Final pill:', finalPill);
  if (EXTENDED_PRO_LABELS.includes(finalPill)) {
    console.log('MODEL: Extended Pro / Pro (confirmed)');
    await close();
    process.exit(0);
  }
  console.error(`ERROR: pill is "${finalPill}" after fix, not Extended Pro / Pro.`);
  await close();
  process.exit(1);
} catch (e) {
  console.error('ERROR:', e.message);
  await close();
  process.exit(1);
}
