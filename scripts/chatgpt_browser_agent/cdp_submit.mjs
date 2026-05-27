#!/usr/bin/env node
/**
 * cdp_submit.mjs — Submit a prompt to a ChatGPT project via CDP.
 *
 * Thin entry point — all DOM work lives in lib/{model_pill,composer,browser}.mjs.
 *
 * Usage:
 *   node cdp_submit.mjs --project-url <URL> --port <PORT> [options] <prompt_file>
 *
 * Options:
 *   --project-url <URL>   Full ChatGPT project URL (required).
 *   --port <PORT>         CDP remote-debugging port (default: 9222).
 *   --timeout <MS>        Navigation timeout in ms (default: 30000).
 *   --dry-run             Fill the composer but do not send (testing).
 *   --deep-research       Switch the composer into Deep Research mode
 *                         instead of Extended Pro. Used by the literature
 *                         role; DR responses take 5-30 min (vs 30-90 for
 *                         Extended Pro). NOTE: the DR DOM selector is
 *                         currently a stub — requires live-inspect wiring
 *                         before this flag works end-to-end.
 *   --check-effort        Legacy no-op kept for back-compat.
 *
 * Flow:
 *   1. attachCDP() to existing Chrome
 *   2. Navigate to project URL (fresh chat)
 *   3. Enforce model: ensureExtendedPro OR ensureDeepResearch
 *   4. Fill composer, click send
 *   5. Print chat URL + generation state
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { attachCDP } from './lib/browser.mjs';
import { readPill, ensureExtendedPro, ensureDeepResearch } from './lib/model_pill.mjs';
import { fillComposer, clickSend, isGenerating } from './lib/composer.mjs';

// ── Parse CLI args ──────────────────────────────────────────────
const args = process.argv.slice(2);
let projectUrl = '';
let port = 9222;
let timeout = 30000;
let promptFile = '';
let dryRun = false;
let deepResearch = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--timeout' && args[i + 1]) { timeout = parseInt(args[++i], 10); continue; }
  if (args[i] === '--dry-run') { dryRun = true; continue; }
  if (args[i] === '--deep-research') { deepResearch = true; continue; }
  if (args[i] === '--check-effort') { /* legacy no-op */ continue; }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node cdp_submit.mjs --project-url <URL> [--port <PORT>] [--deep-research] <prompt_file>');
    console.log('Default mode enforces Extended Pro. Pass --deep-research to use ChatGPT Deep Research instead.');
    process.exit(0);
  }
  promptFile = resolve(args[i]);
}

if (!projectUrl) { console.error('ERROR: --project-url required'); process.exit(1); }
if (!promptFile) { console.error('ERROR: prompt file path required'); process.exit(1); }

const promptText = readFileSync(promptFile, 'utf-8');
const mode = deepResearch ? 'Deep Research' : 'Extended Pro';
console.log(`Prompt: ${promptFile.split(/[\\/]/).pop()} (${promptText.length} chars)`);
console.log(`Project: ${projectUrl}`);
console.log(`CDP port: ${port}`);
console.log(`Mode: ${mode}`);

// ── Main ────────────────────────────────────────────────────────
let close = async () => {};
try {
  const att = await attachCDP({ port });
  close = att.close;
  const ctx = att.context;
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  const composerPill = await readPill(page);
  console.log('Model pill before submit:', composerPill);
  try {
    if (deepResearch) {
      await ensureDeepResearch(page);
      console.log('Model: Deep Research (confirmed at submission time)');
    } else {
      await ensureExtendedPro(page);
      console.log('Model: Pro + Extended (confirmed at submission time)');
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    await close();
    process.exit(1);
  }

  const composer = await fillComposer(page, promptText);
  console.log('Filled prompt');
  await new Promise(r => setTimeout(r, 1500));

  if (dryRun) {
    console.log('DRY RUN: prompt filled but NOT sent; clearing draft.');
    await composer.fill('');
    await close();
    process.exit(0);
  }

  const sent = await clickSend(page, composer);
  console.log(sent ? 'SENT' : 'WARNING: send fallback chain exhausted');

  await new Promise(r => setTimeout(r, 8000));
  console.log('Chat URL:', page.url());
  console.log('Generating:', (await isGenerating(page)) ? 'YES' : 'NO');
  if (deepResearch) {
    console.log('NOTE: Deep Research jobs run 5-30 min. Use wait_chat_done.mjs for polling.');
  }

  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  await close();
  process.exit(1);
}
