#!/usr/bin/env node
/**
 * wait_chat_done.mjs — poll a ChatGPT chat URL until generation completes, then dump.
 *
 * Usage:
 *   node wait_chat_done.mjs --chat-url URL --port PORT --out PATH [--poll-secs N] [--max-mins N]
 *
 * Polls every --poll-secs (default 60). Generation is "done" when:
 *   - no stop button in the DOM
 *   - at least one assistant message present
 *   - the last assistant message's length has been stable across two consecutive polls
 *
 * When done: dumps the LAST assistant message body to the --out path (markdown),
 * prints a one-line summary, exits 0. Exits 2 if --max-mins (default 180) reached.
 * Exits 1 on transport/auth errors.
 */

import { chromium } from 'playwright';
import fs from 'fs';

const args = process.argv.slice(2);
let chatUrl = '', port = 9222, outPath = '', pollSecs = 60, maxMins = 180;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  else if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--out') outPath = args[++i];
  else if (args[i] === '--poll-secs') pollSecs = parseInt(args[++i], 10);
  else if (args[i] === '--max-mins') maxMins = parseInt(args[++i], 10);
}
if (!chatUrl || !outPath) { console.error('Need --chat-url and --out'); process.exit(1); }

const startMs = Date.now();
const deadlineMs = startMs + maxMins * 60 * 1000;
let lastLen = -1;
let stableCount = 0;
let pollIdx = 0;

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];

// Extract the chat ID segment of the URL so we pin polling to THIS chat,
// not whichever chatgpt.com tab happens to be first in ctx.pages(). Bug found
// 2026-05-23 PIOTR session: parallel pollers grabbed content from each
// other's chats when multiple were open simultaneously.
const chatIdMatch = chatUrl.match(/\/c\/([a-f0-9-]+)/);
const chatId = chatIdMatch ? chatIdMatch[1] : null;
if (!chatId) {
  console.error(`Could not extract chat ID from URL: ${chatUrl}`);
  await browser.close();
  process.exit(1);
}

// Prefer a page already loaded on THIS chat; else open a new page.
let page = ctx.pages().find(p => p.url().includes(chatId));
if (!page) {
  page = await ctx.newPage();
}

// Initial navigation — always force-load the chat URL so we know we're on
// the target chat (not a stale tab still showing some other chat).
await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 4000));

// Verify we landed on the right chat. Bail if URL was redirected (e.g., to
// the project page because the chat was deleted or auth lapsed).
if (!page.url().includes(chatId)) {
  console.error(`Navigation drifted off target chat ${chatId}; current URL: ${page.url()}`);
  await browser.close();
  process.exit(1);
}

while (Date.now() < deadlineMs) {
  pollIdx++;
  try {
    // Re-navigate occasionally to keep the page fresh (every 5 polls)
    if (pollIdx > 1 && pollIdx % 5 === 0) {
      await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 3000));
      // Re-verify chat-ID pin survived the navigation.
      if (!page.url().includes(chatId)) {
        console.error(`[poll ${pollIdx}] navigation drifted off chat ${chatId}: ${page.url()}`);
        await browser.close();
        process.exit(1);
      }
    }
    const state = await page.evaluate(() => {
      const stop = document.querySelector('[data-testid="composer-speech-button"], button[aria-label*="Stop"]');
      const assistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      const last = assistants[assistants.length - 1];
      return {
        stopButton: !!stop,
        assistantCount: assistants.length,
        lastLen: last ? (last.innerText || '').length : 0,
        lastText: last ? (last.innerText || '') : '',
      };
    });
    const elapsedMin = Math.round((Date.now() - startMs) / 60000);
    console.log(`[poll ${pollIdx} @ ${elapsedMin}min] stop=${state.stopButton} assistants=${state.assistantCount} lastLen=${state.lastLen}`);

    // Generation done check
    if (!state.stopButton && state.assistantCount > 0 && state.lastLen > 200) {
      if (state.lastLen === lastLen) {
        stableCount++;
        if (stableCount >= 2) {
          // Done: dump and exit.
          fs.writeFileSync(outPath, state.lastText, 'utf-8');
          console.log(`DONE: wrote ${state.lastLen} chars to ${outPath}`);
          await browser.close();
          process.exit(0);
        }
      } else {
        stableCount = 0;
        lastLen = state.lastLen;
      }
    } else {
      stableCount = 0;
      lastLen = state.lastLen;
    }
  } catch (e) {
    console.log(`[poll ${pollIdx}] error: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, pollSecs * 1000));
}

console.log(`TIMEOUT: ${maxMins} min reached without completion`);
await browser.close();
process.exit(2);
