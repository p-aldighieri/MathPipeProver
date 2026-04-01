import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FILE_PATH = process.argv[2];
if (!FILE_PATH) { console.log('Usage: node cdp_add_source.mjs <file_path>'); process.exit(1); }

const PROJECT_URL = 'https://chatgpt.com/g/g-p-698522a548248191a7bd031cabaee48a-npiv-proof-assistant/project';

try {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];

  // Navigate to project
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));

  // Click Sources tab
  const sourcesTab = page.getByText('Sources', { exact: true }).first();
  if (await sourcesTab.count() > 0) {
    await sourcesTab.click();
    await new Promise(r => setTimeout(r, 2000));
    console.log('Clicked Sources tab');
  }

  // Click "Add sources" button
  const addBtn = page.getByText('Add sources', { exact: false }).first();
  if (await addBtn.count() > 0) {
    await addBtn.click();
    await new Promise(r => setTimeout(r, 2000));
    console.log('Clicked Add sources');
  }

  // Look for file upload input
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    const absPath = resolve(FILE_PATH);
    await fileInput.setInputFiles(absPath);
    console.log('Uploaded:', absPath);
    await new Promise(r => setTimeout(r, 5000));
  } else {
    console.log('WARNING: File input not found');
  }

  await page.screenshot({ path: 'C:/tmp/npiv_source_upload.png' });
  console.log('Screenshot saved');
  await browser.close();
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
