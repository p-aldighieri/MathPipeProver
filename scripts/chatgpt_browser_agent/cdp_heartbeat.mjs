import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const CHAT_TITLE = process.argv[2] || 'Rewrite Lemma';
const OUTPUT_FILE = process.argv[3] || 'C:/tmp/npiv_phase1_g12_response.md';
const PROJECT_URL = 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) { console.log('STATUS: NO_PAGE'); process.exit(1); }

  // Ensure we're on the project page first
  if (!page.url().includes('npiv-proof-assistant')) {
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
  }

  // Click on the target chat from the sidebar
  const chatLink = page.getByText(CHAT_TITLE, { exact: false }).first();
  if (await chatLink.count() > 0) {
    await chatLink.click();
    await new Promise(r => setTimeout(r, 8000));
  } else {
    console.log('STATUS: CHAT_NOT_FOUND title=' + CHAT_TITLE);
    await browser.close();
    process.exit(1);
  }

  console.log('URL:', page.url());

  // Check stop button
  const stopBtnCount = await page.locator('[data-testid="stop-button"]').count();
  const isGenerating = stopBtnCount > 0;

  // Get response
  const responseText = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (msgs.length === 0) return '';
    const lastMsg = msgs[msgs.length - 1];
    return lastMsg.innerText || '';
  });

  const status = isGenerating ? 'GENERATING' : (responseText.length > 500 ? 'COMPLETE' : 'WAITING');
  console.log('STATUS:', status);
  console.log('RESPONSE_LENGTH:', responseText.length);

  if (status === 'COMPLETE') {
    writeFileSync(OUTPUT_FILE, responseText, 'utf-8');
    console.log('SAVED:', OUTPUT_FILE);
  }

  if (responseText.length > 0 && responseText.length <= 500) {
    console.log('PREVIEW:', responseText.slice(0, 300));
  }

  await page.screenshot({ path: 'C:/tmp/npiv_heartbeat_latest.png' });
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
