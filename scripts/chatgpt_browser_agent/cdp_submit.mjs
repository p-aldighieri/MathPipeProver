#!/usr/bin/env node
/**
 * cdp_submit.mjs - Lower-level CDP submit helper.
 *
 * Preferred proof workflow: scripts/chatgpt_browser_agent.sh submit ...
 *
 * This script remains as a compact manual/CDP helper for submitting a raw
 * prompt file. It shares the canonical composer/model helpers and supports
 * the same page/draft safety knobs used by the browser agent.
 */

import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { attachCDP } from './lib/browser.mjs';
import { ensureChatReady } from './lib/auth.mjs';
import { readPill, ensureExtendedPro, ensureDeepResearch } from './lib/model_pill.mjs';
import {
  fillComposer, clickSend, isGenerating,
  clearComposerText, clearStoredComposerDrafts, composerTextLength,
} from './lib/composer.mjs';
import { clearComposerAttachments } from './lib/attachments.mjs';

function usage() {
  return `Usage: node cdp_submit.mjs --project-url URL [--port PORT] [options] PROMPT_FILE

Options:
  --port PORT                 CDP remote-debugging port, default: 9222.
  --timeout MS                Navigation timeout, default: 30000.
  --page new|reuse            Submit in a fresh tab or reuse a tab, default: new.
  --clear-draft safe|storage|off
                              safe clears visible text and attachments.
                              storage also clears ChatGPT draft storage keys.
                              off leaves any existing draft alone.
  --chat-url-file PATH        Write the submitted chat URL to PATH.
  --dry-run                   Fill the composer but do not send.
  --deep-research             Use Deep Research instead of Extended Pro.
  --check-effort              Legacy no-op kept for back-compat.
`;
}

const rawArgs = process.argv.slice(2);
let projectUrl = '';
let port = 9222;
let timeout = 30000;
let promptFile = '';
let pageMode = 'new';
let clearDraft = 'safe';
let chatUrlFile = '';
let dryRun = false;
let deepResearch = false;

for (let index = 0; index < rawArgs.length; index += 1) {
  const token = rawArgs[index];
  if (token === '--project-url' && rawArgs[index + 1]) { projectUrl = rawArgs[++index]; continue; }
  if (token === '--port' && rawArgs[index + 1]) { port = parseInt(rawArgs[++index], 10); continue; }
  if (token === '--timeout' && rawArgs[index + 1]) { timeout = parseInt(rawArgs[++index], 10); continue; }
  if (token === '--page' && rawArgs[index + 1]) {
    pageMode = rawArgs[++index];
    if (!['new', 'reuse'].includes(pageMode)) throw new Error("--page must be 'new' or 'reuse'.");
    continue;
  }
  if (token === '--clear-draft' && rawArgs[index + 1]) {
    clearDraft = rawArgs[++index];
    if (!['safe', 'storage', 'off'].includes(clearDraft)) {
      throw new Error("--clear-draft must be 'safe', 'storage', or 'off'.");
    }
    continue;
  }
  if (token === '--chat-url-file' && rawArgs[index + 1]) { chatUrlFile = rawArgs[++index]; continue; }
  if (token === '--dry-run') { dryRun = true; continue; }
  if (token === '--deep-research') { deepResearch = true; continue; }
  if (token === '--check-effort') { continue; }
  if (token === '--help' || token === '-h') {
    console.log(usage());
    process.exit(0);
  }
  promptFile = resolve(token);
}

if (!projectUrl) { console.error('ERROR: --project-url required'); process.exit(1); }
if (!promptFile) { console.error('ERROR: prompt file path required'); process.exit(1); }

const promptText = readFileSync(promptFile, 'utf-8');
const mode = deepResearch ? 'Deep Research' : 'Extended Pro';
console.log(`Prompt: ${promptFile.split(/[\\/]/).pop()} (${promptText.length} chars)`);
console.log(`Project: ${projectUrl}`);
console.log(`CDP port: ${port}`);
console.log(`Mode: ${mode}`);
console.log(`Page: ${pageMode}`);
console.log(`Clear draft: ${clearDraft}`);

async function writeChatUrl(filePath, chatUrl) {
  if (!filePath) return;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${chatUrl}\n`, 'utf8');
}

async function clearDraftState(page) {
  if (clearDraft === 'storage') {
    const removed = await clearStoredComposerDrafts(page);
    if (removed.length > 0) {
      console.log(`Cleared ${removed.length} stored draft key(s); reloading project.`);
      await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
      await ensureChatReady(page, 300);
    }
  }

  if (clearDraft !== 'off') {
    await clearComposerAttachments(page);
    await clearComposerText(page);
    const length = await composerTextLength(page);
    if (length > 2) {
      throw new Error(`Composer still contains ${length} characters after draft cleanup.`);
    }
  }
}

async function waitForChatUrl(page) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (/\/c\/[0-9a-f-]{8,}/i.test(page.url())) return page.url();
    await page.waitForTimeout(2000);
  }
  return page.url();
}

let close = async () => {};
try {
  const att = await attachCDP({ port });
  close = att.close;
  const context = att.context;
  const page = pageMode === 'new'
    ? await context.newPage()
    : context.pages().find((candidate) => candidate.url().includes('chatgpt.com')) ||
      context.pages()[0] ||
      await context.newPage();

  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout });
  await ensureChatReady(page, 300);
  await page.waitForTimeout(3000);
  console.log('At:', page.url());

  await clearDraftState(page);

  const composerPill = await readPill(page);
  console.log('Model pill before submit:', composerPill);
  if (deepResearch) {
    await ensureDeepResearch(page);
    console.log('Model: Deep Research (confirmed at submission time)');
  } else {
    await ensureExtendedPro(page);
    console.log('Model: Pro + Extended (confirmed at submission time)');
  }

  const composer = await fillComposer(page, promptText, { verify: true });
  console.log('Filled prompt');
  await page.waitForTimeout(1500);

  if (dryRun) {
    console.log('DRY RUN: prompt filled but NOT sent; clearing draft.');
    await composer.fill('');
    await close();
    process.exit(0);
  }

  const sent = await clickSend(page, composer);
  console.log(sent ? 'SENT' : 'WARNING: send fallback chain exhausted');

  const chatUrl = await waitForChatUrl(page);
  await writeChatUrl(chatUrlFile, chatUrl);
  console.log('Chat URL:', chatUrl);
  console.log('Generating:', (await isGenerating(page)) ? 'YES' : 'NO');
  if (chatUrlFile) console.log(`Chat URL file: ${chatUrlFile}`);
  if (deepResearch) {
    console.log('NOTE: Deep Research jobs run 5-30 min. Use wait_chat_done.mjs for polling.');
  }

  await close();
} catch (error) {
  console.error('ERROR:', error.message);
  await close();
  process.exit(1);
}
