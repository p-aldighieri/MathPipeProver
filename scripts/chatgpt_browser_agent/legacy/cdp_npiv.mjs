// NPIV-dedicated CDP helper — port 9224
// Usage: node cdp_npiv.mjs submit <prompt_file>
//        node cdp_npiv.mjs check <chat_id> <output_file>
//        node cdp_npiv.mjs list

import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'fs';

const CDP_PORT = 9224;
const CDP_URL = `http://localhost:${CDP_PORT}`;
const PROJECT_URL = 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project';

const cmd = process.argv[2];

async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();
  return { browser, page };
}

if (cmd === 'submit') {
  const promptFile = process.argv[3];
  if (!promptFile) { console.log('Usage: node cdp_npiv.mjs submit <prompt_file>'); process.exit(1); }
  const promptText = readFileSync(promptFile, 'utf-8');
  console.log(`Prompt: ${promptFile} (${promptText.length} chars)`);

  const { browser, page } = await connect();
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const textarea = page.locator('[id="prompt-textarea"]');
  await textarea.waitFor({ timeout: 10000 });
  await textarea.click();
  await new Promise(r => setTimeout(r, 500));
  await textarea.fill(promptText);
  await new Promise(r => setTimeout(r, 1000));

  const sendBtn = page.locator('[data-testid="send-button"]');
  if (await sendBtn.count() > 0) { await sendBtn.click(); console.log('Sent!'); }
  await new Promise(r => setTimeout(r, 5000));

  console.log('Chat URL:', page.url());
  await browser.close();

} else if (cmd === 'check') {
  const chatId = process.argv[3];
  const outFile = process.argv[4] || '/tmp/npiv_response.md';

  const { browser, page } = await connect();

  // Try direct URL first
  if (chatId) {
    await page.goto(`https://chatgpt.com/c/${chatId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 12000));
  }

  let responseText = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    let t = '';
    msgs.forEach((m, i) => { if (i > 0) t += '\n\n---\n\n'; t += m.innerText; });
    return t;
  });

  // Fallback: project click
  if (responseText.length === 0 && chatId) {
    await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
    const link = page.locator(`a[href*="${chatId}"]`).first();
    if (await link.count() > 0) { await link.click(); await new Promise(r => setTimeout(r, 10000)); }
    responseText = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      let t = '';
      msgs.forEach((m, i) => { if (i > 0) t += '\n\n---\n\n'; t += m.innerText; });
      return t;
    });
  }

  const stopBtn = await page.locator('[data-testid="stop-button"]').count();
  console.log('Generating:', stopBtn > 0, 'Length:', responseText.length);

  if (stopBtn === 0 && responseText.length > 500) {
    writeFileSync(outFile, responseText, 'utf-8');
    console.log('SAVED:', outFile);
  } else if (stopBtn > 0) {
    console.log('STATUS: GENERATING');
  } else {
    console.log('STATUS: EMPTY/STALLED');
  }

  await browser.close();

} else if (cmd === 'list') {
  const { browser, page } = await connect();
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  const mainText = await page.evaluate(() => {
    const main = document.querySelector('main');
    return main ? main.innerText : '';
  });
  const lines = mainText.split('\n');
  const chatLines = [];
  for (let i = 0; i < lines.length && chatLines.length < 10; i++) {
    if (lines[i].match(/Mar \d|Apr \d|Feb \d/)) {
      chatLines.push((lines[i - 1] || '').trim().slice(0, 55) + ' | ' + lines[i].trim());
    }
  }
  console.log('Project chats:');
  chatLines.forEach(l => console.log(' ', l));

  await browser.close();
} else {
  console.log('Usage: node cdp_npiv.mjs <submit|check|list> [args]');
}
