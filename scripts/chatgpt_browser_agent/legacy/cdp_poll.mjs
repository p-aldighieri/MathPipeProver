import { chromium } from 'playwright';

const CHAT_URL = process.argv[2] || 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/c/69c5f451-5bdc-8326-9f3f-e3193144dfa4';
const OUTPUT_FILE = process.argv[3] || 'C:/tmp/npiv_phase1_g11_response.md';
const MAX_POLLS = parseInt(process.argv[4]) || 120;  // 120 polls * 30s = 60 min max
const POLL_INTERVAL = 30000; // 30 seconds

import { writeFileSync } from 'fs';

async function poll() {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  let page = pages.find(p => p.url().includes('69c5f451'));

  if (!page) {
    console.log('Chat page not found');
    await browser.close();
    return { status: 'not_found', length: 0 };
  }

  // Check if there's a "Stop" button (still generating) or "Follow up" input (done)
  const stopBtn = page.locator('[data-testid="stop-button"]');
  const isGenerating = await stopBtn.count() > 0;

  // Get the response text
  const responseText = await page.evaluate(() => {
    const assistantMsgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (assistantMsgs.length === 0) return '';
    const lastMsg = assistantMsgs[assistantMsgs.length - 1];
    return lastMsg.innerText || '';
  });

  await browser.close();

  return {
    status: isGenerating ? 'generating' : (responseText.length > 100 ? 'completed' : 'waiting'),
    length: responseText.length,
    text: responseText
  };
}

console.log(`Polling chat: ${CHAT_URL}`);
console.log(`Max polls: ${MAX_POLLS}, interval: ${POLL_INTERVAL/1000}s`);

for (let i = 0; i < MAX_POLLS; i++) {
  try {
    const result = await poll();
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] Poll ${i+1}/${MAX_POLLS}: status=${result.status}, length=${result.length}`);

    if (result.status === 'completed' && result.length > 200) {
      console.log('\n=== RESPONSE READY ===');
      console.log(`Response length: ${result.length} chars`);
      writeFileSync(OUTPUT_FILE, result.text, 'utf-8');
      console.log(`Saved to: ${OUTPUT_FILE}`);
      process.exit(0);
    }

    if (result.status === 'not_found') {
      console.log('Chat page lost. Exiting.');
      process.exit(1);
    }
  } catch (e) {
    console.log(`Poll ${i+1} error: ${e.message}`);
  }

  await new Promise(r => setTimeout(r, POLL_INTERVAL));
}

console.log('Max polls reached. Check manually.');
process.exit(2);
