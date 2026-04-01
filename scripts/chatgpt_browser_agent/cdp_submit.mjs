import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const PROMPT_FILE = process.argv[2] || 'C:/tmp/npiv_phase1_g11_request.md';
const promptText = readFileSync(PROMPT_FILE, 'utf-8');

console.log(`Prompt length: ${promptText.length} chars`);

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
let page = pages.find(p => p.url().includes('npiv-proof-assistant'));

if (!page) {
  console.log('No NPIV project page found. Creating new tab...');
  page = await ctx.newPage();
  await page.goto('https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project');
  await page.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 5000));
}

console.log('Page URL:', page.url());

// Navigate to project page to ensure we start from the project view
if (!page.url().includes('/project')) {
  await page.goto('https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project');
  await page.waitForLoadState('domcontentloaded');
  await new Promise(r => setTimeout(r, 3000));
}

// Click "New chat in NPIV Proof Assistant" or the new chat button
try {
  // Try clicking on the new chat input area
  const newChatInput = page.locator('[id="prompt-textarea"]');
  if (await newChatInput.count() > 0) {
    console.log('Found prompt textarea, clicking...');
    await newChatInput.click();
  } else {
    // Try the "New chat" button
    const newChatBtn = page.getByText('New chat in NPIV Proof Assistant', { exact: false }).first();
    if (await newChatBtn.count() > 0) {
      await newChatBtn.click();
      console.log('Clicked new chat button');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
} catch (e) {
  console.log('Note: Could not find new chat element, will try textarea directly');
}

// Take a screenshot to see current state
await page.screenshot({ path: 'C:/tmp/npiv_before_submit.png' });
console.log('Pre-submit screenshot saved');

// Find and fill the prompt textarea
await new Promise(r => setTimeout(r, 2000));

const textarea = page.locator('[id="prompt-textarea"]');
if (await textarea.count() === 0) {
  console.error('ERROR: Could not find prompt textarea');
  await browser.close();
  process.exit(1);
}

// Click on textarea first
await textarea.click();
await new Promise(r => setTimeout(r, 500));

// Fill the prompt - use fill for contenteditable divs
try {
  await textarea.fill(promptText);
  console.log('Filled prompt text');
} catch (e) {
  // If fill doesn't work on contenteditable, use keyboard
  console.log('Fill failed, trying clipboard paste...');
  await page.evaluate((text) => {
    navigator.clipboard.writeText(text);
  }, promptText);
  await page.keyboard.down('Control');
  await page.keyboard.press('v');
  await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 1000));
  console.log('Pasted via clipboard');
}

await new Promise(r => setTimeout(r, 1000));

// Take screenshot before submitting
await page.screenshot({ path: 'C:/tmp/npiv_filled_prompt.png' });
console.log('Filled prompt screenshot saved');

// Click the send button
try {
  const sendBtn = page.locator('[data-testid="send-button"]');
  if (await sendBtn.count() > 0) {
    await sendBtn.click();
    console.log('Clicked send button');
  } else {
    // Try Enter key
    console.log('Send button not found, trying Enter...');
    // Don't use Enter as it adds newlines in the textarea
    // Look for alternative send button selectors
    const altSend = page.locator('button[aria-label="Send"]').first();
    if (await altSend.count() > 0) {
      await altSend.click();
      console.log('Clicked alternative send button');
    } else {
      console.log('WARNING: Could not find send button. Prompt is filled but not submitted.');
    }
  }
} catch (e) {
  console.log('Error clicking send:', e.message);
}

// Wait a bit and screenshot
await new Promise(r => setTimeout(r, 5000));
await page.screenshot({ path: 'C:/tmp/npiv_after_submit.png' });
console.log('Post-submit screenshot saved');

// Get the chat URL
const chatUrl = page.url();
console.log('Chat URL:', chatUrl);

await browser.close();
console.log('Done. Chat is now processing.');
