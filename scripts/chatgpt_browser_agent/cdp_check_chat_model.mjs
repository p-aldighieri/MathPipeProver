#!/usr/bin/env node
/**
 * Check which model was used in a specific (already-sent) chat.
 * Looks at chat page metadata + screenshot.
 *
 * Usage: node cdp_check_chat_model.mjs <chatUrl> [port]
 *   port defaults to 9222.
 */
import { chromium } from 'playwright';
const [,, chatUrl, portArg] = process.argv;
const port = parseInt(portArg || '9222', 10);
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 15000 });
} catch {}
await page.waitForTimeout(2000);
const state = await page.evaluate(() => {
  const out = { modelHints: [], thoughtCount: 0, assistantCount: 0 };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while (n = walker.nextNode()) {
    const t = (n.nodeValue || '').trim();
    if (/thought for .+/i.test(t) || /reasoned .+/i.test(t) || /thinking\.{0,3}$/i.test(t)) {
      out.thoughtCount += 1;
      out.modelHints.push(t.slice(0, 200));
    }
    if (/GPT[- ]?5\.4/i.test(t) || /extended pro/i.test(t) || /thinking.*heavy/i.test(t) || /standard pro/i.test(t)) {
      out.modelHints.push(t.slice(0, 200));
    }
  }
  out.assistantCount = document.querySelectorAll('[data-message-author-role="assistant"]').length;
  const pillBtn = document.querySelector('button.__composer-pill[aria-haspopup="menu"]');
  out.composerPill = pillBtn ? (pillBtn.textContent || '').trim() : null;
  return out;
});
console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: 'C:/tmp/chat_model_check.png', fullPage: false });
console.log('Screenshot: C:/tmp/chat_model_check.png');
await browser.close();
