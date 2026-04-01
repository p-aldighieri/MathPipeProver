import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];

  // Get ALL assistant message text
  const fullResponse = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    let allText = '';
    msgs.forEach((msg, i) => {
      allText += `\n=== Assistant message ${i+1} ===\n`;
      allText += msg.innerText + '\n';
    });
    return allText;
  });

  console.log('Total response length:', fullResponse.length);
  writeFileSync('C:/tmp/npiv_phase1_g12_response.md', fullResponse, 'utf-8');
  console.log('SAVED to C:/tmp/npiv_phase1_g12_response.md');

  // Also get the full page main content
  const mainContent = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return main.innerText;
  });
  writeFileSync('C:/tmp/npiv_phase1_g12_full_page.md', mainContent, 'utf-8');
  console.log('Full page saved:', mainContent.length, 'chars');

  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
