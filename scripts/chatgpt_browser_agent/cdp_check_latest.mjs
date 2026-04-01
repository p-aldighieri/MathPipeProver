import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const CHAT_TITLE = process.argv[2] || 'Phase 1 Assembly';
const OUTPUT_FILE = process.argv[3] || 'C:/tmp/npiv_phase1_consolidator_response.md';
const PROJECT_URL = 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) { console.log('STATUS: NO_PAGE'); process.exit(1); }

  // Go to project first
  if (!page.url().includes('npiv-proof-assistant')) {
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
  }

  // Try clicking the chat - try multiple title variants
  const titles = [CHAT_TITLE, 'Consolidator', 'Assembly', 'Complete Theta'];
  let found = false;
  for (const t of titles) {
    const link = page.getByText(t, { exact: false }).first();
    if (await link.count() > 0) {
      await link.click();
      console.log('Clicked chat:', t);
      found = true;
      break;
    }
  }

  if (!found) {
    // Try the most recent chat (first in sidebar)
    console.log('Title not found, trying most recent chat...');
    const recentChats = page.locator('[data-testid^="history-item"]').first();
    if (await recentChats.count() > 0) {
      await recentChats.click();
      console.log('Clicked most recent chat');
      found = true;
    }
  }

  await new Promise(r => setTimeout(r, 8000));
  console.log('URL:', page.url());

  // Check stop button
  const stopBtnCount = await page.locator('[data-testid="stop-button"]').count();
  const isGenerating = stopBtnCount > 0;

  // Get ALL assistant messages
  const responseText = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    let allText = '';
    msgs.forEach((msg, i) => {
      if (i > 0) allText += '\n\n---\n\n'; // Skip thinking messages, use separator
      allText += msg.innerText;
    });
    return allText;
  });

  const status = isGenerating ? 'GENERATING' : (responseText.length > 500 ? 'COMPLETE' : 'WAITING');
  console.log('STATUS:', status);
  console.log('RESPONSE_LENGTH:', responseText.length);

  if (status === 'COMPLETE') {
    writeFileSync(OUTPUT_FILE, responseText, 'utf-8');
    console.log('SAVED:', OUTPUT_FILE);
  } else if (responseText.length > 0) {
    console.log('PREVIEW:', responseText.slice(0, 400));
  }

  await page.screenshot({ path: 'C:/tmp/npiv_heartbeat_latest.png' });
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
