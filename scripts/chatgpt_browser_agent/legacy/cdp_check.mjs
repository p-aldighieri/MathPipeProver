import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
let page = pages.find(p => p.url().includes('69c5f451'));
if (!page) { console.log('No chat page'); process.exit(1); }

await page.screenshot({ path: 'C:/tmp/npiv_chat_progress.png', fullPage: false });
console.log('Screenshot saved');

// Check for stop button (still generating)
const stopBtnCount = await page.locator('[data-testid="stop-button"]').count();
console.log('Stop button visible:', stopBtnCount > 0 ? 'YES (still generating)' : 'NO (done or error)');

// Get visible text length
const responseLen = await page.evaluate(() => {
  const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
  if (msgs.length === 0) return 0;
  return msgs[msgs.length - 1].innerText.length;
});
console.log('Response text length:', responseLen);

await browser.close();
