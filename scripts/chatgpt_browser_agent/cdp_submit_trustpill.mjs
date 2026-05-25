#!/usr/bin/env node
/**
 * cdp_submit_trustpill.mjs — additive helper for the theory-problem-search project.
 *
 * Why this exists: the shared cdp_submit.mjs assumes the NEW split "Pro + GPT-5.5"
 * composer menu and tries to re-set the model via a GPT-5.5 submenu that DOES NOT
 * EXIST on this project's (legacy) UI, where the pill is directly "Extended Pro".
 * That re-set times out. This helper TRUSTS the visible pill (the authoritative
 * check per the project memory) and skips the submenu interaction entirely.
 *
 * Usage: node cdp_submit_trustpill.mjs --project-url <URL> --port <PORT> <prompt_file>
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0] || await ctx.newPage();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  const PILL = 'button.__composer-pill[aria-haspopup="menu"]';
  const pill = await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? (el.textContent || '').trim() : 'unknown';
  }, PILL);
  console.log('Composer pill:', pill);
  if (!/pro/i.test(pill)) {
    console.error(`ERROR: pill "${pill}" is not a Pro variant — refusing to submit on a weaker model.`);
    process.exit(2);
  }
  console.log('Model: trusting pill (Extended Pro). Skipping broken submenu re-set.');

  const textarea = page.locator('[id="prompt-textarea"]');
  await textarea.waitFor({ timeout: 10000 });
  await textarea.click();
  await new Promise(r => setTimeout(r, 500));
  await textarea.fill(promptText);
  console.log('Filled prompt');
  await new Promise(r => setTimeout(r, 1500));

  const sendBtn = page.locator('[data-testid="send-button"]');
  if (await sendBtn.count() > 0) { await sendBtn.click(); console.log('SENT'); }
  else { console.error('WARNING: send button not found'); }

  await new Promise(r => setTimeout(r, 8000));
  console.log('Chat URL:', page.url());
  const generating = await page.locator('[data-testid="stop-button"]').count() > 0;
  console.log('Generating:', generating ? 'YES' : 'NO');
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
