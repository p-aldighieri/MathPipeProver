#!/usr/bin/env node
/**
 * cdp_inspect_chat.mjs — Read-only one-shot inspection of a chat's current state.
 *
 * Outputs a JSON snapshot: URL, generating flag, assistant turn count,
 * last assistant message length and tail text. Used by /inspect-chat to
 * answer "is this chat still working or done?" without harvesting.
 *
 * Uses lib/composer.mjs (isGenerating) and lib/poll.mjs (latestAssistantText)
 * — single source of truth for the underlying selectors.
 */
import { attachCDP } from './lib/browser.mjs';
import { isGenerating } from './lib/composer.mjs';
import { latestAssistantText, dumpAllMessages } from './lib/poll.mjs';

const args = process.argv.slice(2);
let chatUrl = '', port = 9222;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  if (args[i] === '--port') port = parseInt(args[++i], 10);
}
if (!chatUrl) { console.error('Need --chat-url'); process.exit(1); }

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find(p => p.url().includes('chatgpt.com')) || context.pages()[0];
  await page.bringToFront();
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 6000));
  try {
    await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 12000 });
  } catch { /* may still be generating */ }
  await new Promise(r => setTimeout(r, 2500));

  const messages = await dumpAllMessages(page);
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  const lastText = lastAssistant ? (lastAssistant.text || '') : '';
  const fullText = (await latestAssistantText(page)).trim();
  const generating = await isGenerating(page);

  const out = {
    url: page.url(),
    generating,
    assistantMessages: messages.filter(m => m.role === 'assistant').length,
    lastAssistantLen: lastText.length,
    lastAssistantTail: lastText.slice(-300),
    cleanedLastTextLen: fullText.length,
  };
  console.log(JSON.stringify(out, null, 2));
  await close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
