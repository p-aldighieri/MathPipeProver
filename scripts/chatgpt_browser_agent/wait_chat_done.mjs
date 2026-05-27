#!/usr/bin/env node
/**
 * wait_chat_done.mjs — poll a ChatGPT chat URL until generation completes,
 * then dump the last assistant message to disk.
 *
 * Uses lib/poll.mjs's waitForStableAssistantReply with the chat-ID-pin
 * and re-navigation hardening (added 2026-05-23 PIOTR session, bug
 * where parallel pollers grabbed each other's chat content).
 *
 * Usage:
 *   node wait_chat_done.mjs --chat-url URL [--port PORT] --out PATH \
 *     [--poll-secs N] [--max-mins N] [--min-stable-length N]
 *
 * Polls every --poll-secs (default 60). Generation is "done" when the
 * assistant text stays stable across 2 polls AND no stop button is
 * present AND text length >= --min-stable-length (default 200, blocks
 * premature triggers on short interim outputs).
 *
 * Exits 0 on success, 1 on transport/auth/URL-drift errors, 2 on timeout.
 */
import fs from 'fs';
import { attachCDP } from './lib/browser.mjs';
import { waitForStableAssistantReply, extractChatId, latestAssistantText } from './lib/poll.mjs';

const args = process.argv.slice(2);
let chatUrl = '', port = 9222, outPath = '', pollSecs = 60, maxMins = 180, minStableLength = 200;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  else if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--out') outPath = args[++i];
  else if (args[i] === '--poll-secs') pollSecs = parseInt(args[++i], 10);
  else if (args[i] === '--max-mins') maxMins = parseInt(args[++i], 10);
  else if (args[i] === '--min-stable-length') minStableLength = parseInt(args[++i], 10);
}
if (!chatUrl || !outPath) { console.error('Need --chat-url and --out'); process.exit(1); }

const chatId = extractChatId(chatUrl);
if (!chatId) {
  console.error(`Could not extract chat ID from URL: ${chatUrl}`);
  process.exit(1);
}

const startMs = Date.now();
let pollIdx = 0;

try {
  const { context, close } = await attachCDP({ port });

  // Prefer a page already loaded on THIS chat; else open a new page.
  let page = context.pages().find(p => p.url().includes(chatId));
  if (!page) page = await context.newPage();

  await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));
  if (!page.url().includes(chatId)) {
    console.error(`Navigation drifted off target chat ${chatId}; current URL: ${page.url()}`);
    await close();
    process.exit(1);
  }

  try {
    const stableText = await waitForStableAssistantReply(page, {
      pollSeconds: pollSecs,
      maxWaitSeconds: maxMins * 60,
      requireCopyButton: false,    // legacy wait_chat_done semantics: trust length-stability
      minStableLength,
      chatIdPin: chatId,
      chatUrl,
      renavigateEveryNPolls: 5,
      onPoll: ({ chatUrl: u, currentTextLength, generating }) => {
        pollIdx += 1;
        const elapsedMin = Math.round((Date.now() - startMs) / 60000);
        console.log(`[poll ${pollIdx} @ ${elapsedMin}min] generating=${generating} lastLen=${currentTextLength}`);
      },
    });
    fs.writeFileSync(outPath, stableText, 'utf-8');
    console.log(`DONE: wrote ${stableText.length} chars to ${outPath}`);
    await close();
    process.exit(0);
  } catch (e) {
    if (/Timed out/i.test(e.message)) {
      // Best-effort: still write whatever's visible, then exit 2.
      const tail = (await latestAssistantText(page)).trim();
      if (tail) {
        fs.writeFileSync(outPath, tail, 'utf-8');
        console.log(`TIMEOUT: ${maxMins} min reached. Wrote partial ${tail.length} chars to ${outPath}.`);
      } else {
        console.log(`TIMEOUT: ${maxMins} min reached without completion.`);
      }
      await close();
      process.exit(2);
    }
    throw e;
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
