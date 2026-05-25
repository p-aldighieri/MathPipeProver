#!/usr/bin/env node
/**
 * cg_create_project.mjs — create a ChatGPT project with PROJECT-ONLY memory.
 *
 * Usage: node cg_create_project.mjs --port 9228 --name "Project Name" [--shot path.png]
 *
 * Flow (verified 2026-05-25 UI): sidebar "New project" -> fill projectName ->
 * gear "Project settings" -> select "Project-only" memory radio -> VERIFY checked
 * (memory setting is IMMUTABLE after creation, so abort if not confirmed) -> Create project.
 * Prints "PROJECT_URL: <url>" on success.
 */
import { chromium } from 'playwright';
const args = process.argv.slice(2);
let port = 9228, name = '', shot = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--name') name = args[++i];
  else if (args[i] === '--shot') shot = args[++i];
}
if (!name) { console.error('ERROR: --name required'); process.exit(1); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
try {
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
  await page.bringToFront();
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  await page.getByText('New project', { exact: true }).first().click();
  await sleep(1800);

  const nameInput = page.locator('input[name="projectName"]');
  await nameInput.waitFor({ timeout: 8000 });
  await nameInput.fill(name);
  await sleep(400);

  // Open the "Project settings" gear (the memory menu)
  await page.locator('button[aria-label="Project settings"]').click();
  await sleep(1200);

  // Click the "Project-only" memory radio
  const clicked = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('[role="menuitemradio"]')];
    const po = rs.find(r => /Project-only/i.test(r.innerText || ''));
    if (po) { po.click(); return true; }
    return false;
  });
  if (!clicked) { console.error('ABORT: "Project-only" radio not found — not creating.'); process.exit(2); }
  await sleep(800);

  // Selecting the radio CLOSES the popover. Re-open the gear to verify the choice stuck.
  const countRadios = async () => page.evaluate(() => document.querySelectorAll('[role="menuitemradio"]').length);
  if (await countRadios() === 0) {
    await page.locator('button[aria-label="Project settings"]').click();
    await sleep(1100);
  }
  const state = await page.evaluate(() => {
    const rs = [...document.querySelectorAll('[role="menuitemradio"]')];
    const get = (re) => { const r = rs.find(x => re.test(x.innerText || '')); return r ? r.getAttribute('aria-checked') : 'absent'; };
    return { projectOnly: get(/Project-only/i), def: get(/Default/i), n: rs.length };
  });
  if (shot) await page.screenshot({ path: shot });
  console.log('Memory radio state (re-opened gear):', JSON.stringify(state));
  if (state.projectOnly !== 'true') {
    console.error(`ABORT: Project-only NOT confirmed checked (got ${state.projectOnly}). Not creating (setting is immutable).`);
    process.exit(3);
  }

  // Close the memory popover by toggling the gear (clicking the name field is blocked by the overlay)
  await page.locator('button[aria-label="Project settings"]').click();
  await sleep(700);
  if (await countRadios() !== 0) { await page.keyboard.press('Escape'); await sleep(500); }
  if (await countRadios() !== 0) { console.error('ABORT: could not close memory popover before Create.'); process.exit(4); }

  // Create
  await page.getByRole('button', { name: 'Create project' }).click();
  await sleep(5500);
  const url = page.url();
  console.log('PROJECT_URL:', url);
  if (!/\/g\/g-p-[^/]+/.test(url)) console.error('WARN: URL does not look like a project URL — verify manually.');
} finally {
  await browser.close();
}
