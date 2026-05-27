#!/usr/bin/env node
/**
 * cdp_dump_chat.mjs — Dump every message (user + assistant) of a chat to disk.
 *
 * Diagnostic helper for when wait_chat_done has saved the last assistant
 * message but you want the full transcript for context. Uses lib/poll.mjs's
 * dumpAllMessages which is the single source of truth for the
 * `[data-message-author-role]` data-attribute selector.
 *
 * Usage:
 *   node cdp_dump_chat.mjs --chat-url URL [--port PORT] [--out PATH]
 */
import fs from 'fs';
import { attachCDP } from './lib/browser.mjs';
import { dumpAllMessages } from './lib/poll.mjs';

const args = process.argv.slice(2);
let chatUrl = '', port = 9222, outPath = '/tmp/chat_dump.md';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  else if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--out') outPath = args[++i];
}
if (!chatUrl) { console.error('Need --chat-url'); process.exit(1); }

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find(p => p.url().includes('chatgpt.com')) || context.pages()[0];
  await page.bringToFront();
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 6000));
  try {
    await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 15000 });
  } catch { /* fall through; dumpAllMessages will return [] */ }
  // Ensure DOM fully populated by scrolling to bottom.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 2000));

  const messages = await dumpAllMessages(page);
  fs.writeFileSync(
    outPath,
    messages.map(m => `\n========\nROLE: ${m.role} (id=${m.id})\n========\n${m.text}\n`).join(''),
  );
  console.log(`Wrote ${messages.length} messages to ${outPath}`);
  messages.forEach((m, i) => console.log(`[${i}] ${m.role} len=${m.text.length} id=${m.id}`));
  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
