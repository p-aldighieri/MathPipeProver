#!/usr/bin/env node
/**
 * wait_chat_done.mjs — watch a ChatGPT chat until the model finishes, then
 * write the answer to disk and EXIT. Built to run as a background job whose
 * exit is the wake-up signal for the orchestrator (e.g. Claude Code's Bash
 * `run_in_background`, which re-invokes the session when the process exits),
 * replacing fixed-interval heartbeat loops.
 *
 * Usage:
 *   node wait_chat_done.mjs --chat-url URL --out PATH [--port PORT]
 *     [--poll-secs N] [--max-mins N] [--min-stable-length N]
 *     [--deep-research] [--keep-tab] [--verbose]
 *
 * Done means: no stop button, the last turn is an assistant turn with a
 * non-empty message, its copy button is shown, and the answer text is
 * unchanged across two consecutive polls (length >= --min-stable-length,
 * default 200). The answer is written as markdown rebuilt from the rendered
 * DOM with math restored to TeX (lib/poll.mjs assistantMarkdown); plain
 * innerText is the fallback.
 *
 * Exit codes (the orchestrator branches on these):
 *   0  answer written to --out
 *   1  transport/auth/URL-drift error (nothing written)
 *   2  timeout (whatever is visible is written to --out, marked partial)
 *   3  the chat itself failed: error banner, stopped response, or rate limit
 *   4  (--deep-research) research finished but the report is a canvas card,
 *      not chat text — harvest with harvest_deep_research.mjs --repost-now
 *
 * Output is deliberately quiet — one line per state change plus a final
 * DONE/TIMEOUT/CHAT_ERROR line — so a background job's captured stdout
 * stays small. --verbose prints every poll.
 *
 * --deep-research: DR's research phase shows no stop button, so a DR chat is
 * treated as still working while DR is active with no answer yet (via
 * isDeepResearchWorking). Heavy DR reports land in a canvas that is not in
 * the chat DOM; harvest those with harvest_deep_research.mjs --repost-now.
 *
 * Tab hygiene: the watcher opens its own tab on the chat and closes it on
 * every exit path (generation is server-side; closing never kills a job).
 * A tab it merely found already on the chat is left open. --keep-tab opts out.
 */
import fs from 'fs';
import { attachCDP } from './lib/browser.mjs';
import { extractChatId, latestAssistantText, chatTurnState, assistantMarkdown } from './lib/poll.mjs';
import { isDeepResearchWorking } from './lib/model_pill.mjs';

const args = process.argv.slice(2);
let chatUrl = '', port = 9222, outPath = '', pollSecs = 45, maxMins = 180, minStableLength = 200;
let deepResearch = false, keepTab = false, verbose = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  else if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--out') outPath = args[++i];
  else if (args[i] === '--poll-secs') pollSecs = parseInt(args[++i], 10);
  else if (args[i] === '--max-mins') maxMins = parseInt(args[++i], 10);
  else if (args[i] === '--min-stable-length') minStableLength = parseInt(args[++i], 10);
  else if (args[i] === '--deep-research') deepResearch = true;
  else if (args[i] === '--keep-tab') keepTab = true;
  else if (args[i] === '--verbose') verbose = true;
}
if (!chatUrl || !outPath) { console.error('Need --chat-url and --out'); process.exit(1); }

const chatId = extractChatId(chatUrl);
if (!chatId) {
  console.error(`Could not extract chat ID from URL: ${chatUrl}`);
  process.exit(1);
}

const startMs = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const elapsed = () => `${Math.round((Date.now() - startMs) / 60000)}min`;
const RENAVIGATE_EVERY = 6;   // polls; refreshes a background tab's stale DOM
const ERROR_CONFIRMATIONS = 2; // consecutive polls showing an error banner

let close = async () => {};
let context = null;
let page = null;
let createdPage = false;
const disposeTab = async () => {
  if (keepTab || !createdPage || !page) return;
  try { await page.close(); } catch { /* tab already gone */ }
};
const finish = async (code) => { await disposeTab(); await close(); process.exit(code); };

async function goToChat() {
  try {
    await page.goto(chatUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    // Chat pages intermittently exceed goto timeouts; the next poll retries.
    return `navigation failed (${String(e.message).split('\n')[0]})`;
  }
  await sleep(4000);
  return null;
}

async function readAnswer() {
  const md = (await assistantMarkdown(page).catch(() => '')).trim();
  if (md) return md;
  return (await latestAssistantText(page)).trim();
}

try {
  const att = await attachCDP({ port });
  close = att.close;
  context = att.context;
  page = context.pages().find((p) => p.url().includes(chatId)) || null;
  createdPage = !page;
  if (!page) page = await context.newPage();
  const navNote = await goToChat();
  if (navNote) {
    await sleep(5000);
    const retry = await goToChat();
    if (retry) { console.error(`ERROR: ${retry}`); await finish(1); }
  }
  if (!page.url().includes(chatId)) {
    console.error(`Navigation drifted off target chat ${chatId}; current URL: ${page.url()}`);
    await finish(1);
  }

  const deadline = startMs + maxMins * 60000;
  let pollIdx = 0;
  let lastText = '';
  let stableCycles = 0;
  let errorCycles = 0;
  let driftCycles = 0;
  let lastPhase = '';

  while (Date.now() < deadline) {
    pollIdx += 1;
    if (page.isClosed()) {
      // Someone closed our tab; generation is server-side, so just reopen.
      console.log(`[${elapsed()}] watcher tab was closed; reopening`);
      page = await context.newPage();
      createdPage = true;
      await goToChat();
    }
    if (pollIdx > 1 && pollIdx % RENAVIGATE_EVERY === 0) {
      const note = await goToChat();
      if (note && verbose) console.log(`[${elapsed()}] ${note}; retrying next cycle`);
    }
    // Another script may navigate this tab away (a tab-reusing command). Go
    // back rather than dying; give up only if the drift keeps recurring.
    if (!page.url().includes(chatId)) {
      driftCycles += 1;
      console.log(`[${elapsed()}] tab drifted to ${page.url()}; returning to the chat (${driftCycles}/3)`);
      if (driftCycles >= 3) {
        console.error(`Navigation keeps drifting off target chat ${chatId}; giving up.`);
        await finish(1);
      }
      await goToChat();
      continue;
    }
    driftCycles = 0;

    let state;
    try {
      state = await chatTurnState(page);
      if (deepResearch && !state.generating) {
        state.generating = await isDeepResearchWorking(page);
      }
    } catch (e) {
      const msg = String(e.message).split('\n')[0];
      if (/context was destroyed|navigation|Target closed|has been closed/i.test(msg)) {
        await sleep(3000);
        continue;
      }
      throw e;
    }

    const phase = state.generating ? 'generating'
      : state.errorText ? 'error'
        : state.messageCount > 0 ? 'answer-visible'
          : 'waiting';
    if (phase !== lastPhase || verbose) {
      const detail = phase === 'generating' ? (state.statusText ? ` (${state.statusText})` : '')
        : phase === 'answer-visible' ? ` (${state.textLength} chars)`
          : phase === 'error' ? ` (${state.errorText})` : '';
      console.log(`[${elapsed()}] ${phase}${detail}`);
      lastPhase = phase;
    }

    if (phase === 'error') {
      errorCycles += 1;
      if (errorCycles >= ERROR_CONFIRMATIONS) {
        console.log(`CHAT_ERROR after ${elapsed()}: ${state.errorText}`);
        await finish(3);
      }
    } else {
      errorCycles = 0;
    }

    if (deepResearch && state.researchCompleted && state.textLength < minStableLength) {
      console.log(`DR_REPORT_IN_CANVAS after ${elapsed()}: research finished but the report is a canvas ` +
        'card, not chat text. Harvest with harvest_deep_research.mjs --repost-now.');
      await finish(4);
    }

    if (phase === 'answer-visible') {
      const text = await readAnswer();
      stableCycles = (text && text === lastText) ? stableCycles + 1 : 0;
      lastText = text || lastText;
      const ready = state.hasCopyButton || deepResearch;
      if (stableCycles >= 1 && ready && lastText.length >= minStableLength) {
        fs.writeFileSync(outPath, `${lastText}\n`, 'utf-8');
        console.log(`DONE after ${elapsed()}: wrote ${lastText.length} chars to ${outPath}`);
        await finish(0);
      }
      // Answer visible but not yet settled: re-check sooner than a full poll.
      await sleep(Math.min(pollSecs, 15) * 1000);
      continue;
    }
    stableCycles = 0;
    await sleep(pollSecs * 1000);
  }

  const tail = await readAnswer().catch(() => '');
  if (tail) {
    fs.writeFileSync(outPath, `<!-- PARTIAL: watcher timed out after ${maxMins} min -->\n${tail}\n`, 'utf-8');
    console.log(`TIMEOUT after ${maxMins} min: wrote partial ${tail.length} chars to ${outPath}`);
  } else {
    console.log(`TIMEOUT after ${maxMins} min without an answer.`);
  }
  await finish(2);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  await finish(1);
}
