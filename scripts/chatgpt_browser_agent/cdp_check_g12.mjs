import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const CHAT_URL = 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/c/69c601d2-8128-8333-8ce9-ba4d6581b724';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) { console.log('No page'); process.exit(1); }

  console.log('Current URL:', page.url());
  console.log('Navigating to G1.2 chat...');
  await page.goto(CHAT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  console.log('Final URL:', page.url());

  // Check stop button
  const stopBtnCount = await page.locator('[data-testid="stop-button"]').count();
  console.log('Stop button:', stopBtnCount > 0 ? 'YES (generating)' : 'NO (done)');

  // Get response
  const responseText = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (msgs.length === 0) return '';
    const lastMsg = msgs[msgs.length - 1];
    return lastMsg.innerText || '';
  });
  console.log('Response length:', responseText.length);

  if (responseText.length > 500) {
    writeFileSync('C:/tmp/npiv_phase1_g12_response.md', responseText, 'utf-8');
    console.log('SAVED to C:/tmp/npiv_phase1_g12_response.md');
  } else if (responseText.length > 0) {
    console.log('PREVIEW:', responseText.slice(0, 500));
  }

  await page.screenshot({ path: 'C:/tmp/npiv_g12_check.png' });
  console.log('Screenshot saved');
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
