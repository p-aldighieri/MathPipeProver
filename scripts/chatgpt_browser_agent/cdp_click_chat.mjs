import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];

  // Click on the "Rewrite Lemma C.3 W Based" chat
  console.log('Looking for G1.2 chat...');
  const chatLink = page.getByText('Rewrite Lemma C.3 W Based', { exact: false }).first();
  if (await chatLink.count() > 0) {
    await chatLink.click();
    console.log('Clicked G1.2 chat');
    await new Promise(r => setTimeout(r, 8000));
  } else {
    console.log('Chat not found in sidebar, trying broader search...');
    const alt = page.getByText('Rewrite Lemma', { exact: false }).first();
    if (await alt.count() > 0) {
      await alt.click();
      console.log('Clicked alternative match');
      await new Promise(r => setTimeout(r, 8000));
    }
  }

  console.log('URL:', page.url());

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
    console.log('SAVED');
  } else {
    console.log('TEXT:', responseText.slice(0, 500));
  }

  await page.screenshot({ path: 'C:/tmp/npiv_g12_chat.png' });
  console.log('Screenshot saved');
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
