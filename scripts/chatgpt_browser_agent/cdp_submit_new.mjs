import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const PROMPT_FILE = process.argv[2] || 'C:/tmp/npiv_phase1_g12_prover_request.md';
const PROJECT_URL = 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project';
const promptText = readFileSync(PROMPT_FILE, 'utf-8');

console.log(`Prompt: ${PROMPT_FILE} (${promptText.length} chars)`);

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];

  if (!page) {
    page = await ctx.newPage();
  }

  // Navigate to project page to start a fresh chat
  console.log('Navigating to project page...');
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log('At:', page.url());

  // Check for Extended Pro
  const extProText = await page.evaluate(() => document.body.innerText);
  const hasExtPro = extProText.includes('Extended Pro');
  console.log('Extended Pro visible:', hasExtPro);

  if (!hasExtPro) {
    console.log('WARNING: Extended Pro not detected! Checking effort pill...');
    // Try to find and click the effort selector
    const effortBtn = page.locator('text=Extended Pro').first();
    if (await effortBtn.count() > 0) {
      console.log('Found Extended Pro button');
    } else {
      console.log('WARNING: Cannot confirm Extended Pro. Proceeding anyway - user set it manually.');
    }
  }

  // Find and fill the prompt textarea
  const textarea = page.locator('[id="prompt-textarea"]');
  await textarea.waitFor({ timeout: 10000 });
  await textarea.click();
  await new Promise(r => setTimeout(r, 500));

  // Fill the prompt
  await textarea.fill(promptText);
  console.log('Filled prompt');
  await new Promise(r => setTimeout(r, 1000));

  // Click send
  const sendBtn = page.locator('[data-testid="send-button"]');
  if (await sendBtn.count() > 0) {
    await sendBtn.click();
    console.log('Sent!');
  } else {
    console.log('WARNING: Send button not found');
  }

  await new Promise(r => setTimeout(r, 5000));

  // Get the chat URL
  const chatUrl = page.url();
  console.log('Chat URL:', chatUrl);

  // Take screenshot
  await page.screenshot({ path: 'C:/tmp/npiv_g12_submitted.png' });
  console.log('Screenshot saved');

  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
