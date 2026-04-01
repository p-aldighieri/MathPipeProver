import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];

  // Refresh the page first
  console.log('Refreshing page...');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Navigate to project
  console.log('Going to project...');
  await page.goto('https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project',
    { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Click on the G1.2 chat
  console.log('Clicking G1.2 chat...');
  const chatLink = page.getByText('Rewrite Lemma', { exact: false }).first();
  if (await chatLink.count() > 0) {
    await chatLink.click();
    await new Promise(r => setTimeout(r, 8000));
  } else {
    console.log('ERROR: G1.2 chat not found in sidebar');
    await browser.close();
    process.exit(1);
  }

  console.log('URL:', page.url());

  // Get full page text to check for errors
  const fullText = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    return main.innerText.slice(0, 3000);
  });
  console.log('--- Page content ---');
  console.log(fullText);

  // Check for assistant messages
  const msgCount = await page.evaluate(() => {
    return {
      user: document.querySelectorAll('[data-message-author-role="user"]').length,
      assistant: document.querySelectorAll('[data-message-author-role="assistant"]').length
    };
  });
  console.log('Messages - user:', msgCount.user, 'assistant:', msgCount.assistant);

  // Check for error indicators
  const hasError = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes('error') || text.includes('Something went wrong') ||
           text.includes('unable to') || text.includes('try again');
  });
  console.log('Error indicators:', hasError);

  await page.screenshot({ path: 'C:/tmp/npiv_g12_recover.png' });
  console.log('Screenshot saved');
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
