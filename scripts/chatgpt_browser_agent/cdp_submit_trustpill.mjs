#!/usr/bin/env node
/**
 * cdp_submit_trustpill.mjs — diagnostic submitter that trusts the visible pill.
 *
 * ## Status
 *
 * After the lib refactor (lib/model_pill.mjs + lib/composer.mjs), the
 * standard `cdp_submit.mjs` now also trusts a visible "Extended Pro"/"Pro"
 * pill (its `ensureExtendedPro` fast-paths on a correct pill without
 * probing the now-removed GPT submenu). This script is therefore
 * functionally close to redundant — kept as a diagnostic that refuses
 * outright if the pill is wrong, instead of trying to fix it.
 *
 * Difference from cdp_submit.mjs:
 *   - cdp_submit.mjs: calls ensureExtendedPro → tries to fix wrong pill,
 *     throws on failure. Suitable for production.
 *   - this script:    refuses to submit on a wrong pill with exit code 2.
 *     Useful when investigating "why did my submission use a weak model?"
 *
 * Usage: node cdp_submit_trustpill.mjs --project-url <URL> --port <PORT> <prompt_file>
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { attachCDP } from './lib/browser.mjs';
import { readPill, EXTENDED_PRO_LABELS } from './lib/model_pill.mjs';
import { fillComposer, clickSend, isGenerating } from './lib/composer.mjs';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222, promptFile = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url') { projectUrl = args[++i]; continue; }
  if (args[i] === '--port') { port = parseInt(args[++i], 10); continue; }
  promptFile = resolve(args[i]);
}
if (!projectUrl || !promptFile) { console.error('ERROR: --project-url and prompt file required'); process.exit(1); }
const promptText = readFileSync(promptFile, 'utf-8');
console.log(`Prompt: ${promptFile.split(/[\\/]/).pop()} (${promptText.length} chars)`);

let close = async () => {};
try {
  const att = await attachCDP({ port });
  close = att.close;
  const ctx = att.context;
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0] || await ctx.newPage();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  const pill = await readPill(page);
  console.log('Composer pill:', pill);
  if (!EXTENDED_PRO_LABELS.includes(pill)) {
    console.error(`ERROR: pill "${pill}" is not Extended Pro/Pro — refusing to submit on a weaker model.`);
    await close();
    process.exit(2);
  }
  console.log('Model: trusting pill (Extended Pro). Skipping fix attempt by design.');

  const composer = await fillComposer(page, promptText);
  console.log('Filled prompt');
  await new Promise(r => setTimeout(r, 1500));

  const sent = await clickSend(page, composer);
  console.log(sent ? 'SENT' : 'WARNING: send fallback chain exhausted');

  await new Promise(r => setTimeout(r, 8000));
  console.log('Chat URL:', page.url());
  console.log('Generating:', (await isGenerating(page)) ? 'YES' : 'NO');
  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  await close();
  process.exit(1);
}
