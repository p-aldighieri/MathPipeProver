#!/usr/bin/env node
/**
 * cg_create_project.mjs — create a ChatGPT project with PROJECT-ONLY memory.
 *
 * Usage: node cg_create_project.mjs --port 9228 --name "Project Name" [--shot path.png]
 *
 * Flow (verified 2026-05-25 UI; entry point re-verified 2026-06-12): go to
 * /projects -> "New project" (icon-only button, aria-label; text fallback for
 * the pre-06-12 UI) -> fill projectName -> gear "Project settings" -> select
 * "Project-only" memory radio -> VERIFY checked (memory setting is IMMUTABLE
 * after creation, so abort if not confirmed) -> Create project.
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
  await page.goto('https://chatgpt.com/projects', { waitUntil: 'domcontentloaded' });
  await sleep(6000);

  // Robust helpers. The popover open/close used to be a single blind click + fixed
  // sleep, which races against slow popover rendering: re-clicking the gear while the
  // popover is mid-open TOGGLES it shut. These helpers click once then POLL, and only
  // re-click after a full poll window with nothing rendered.
  const countRadios = async () => page.evaluate(() => document.querySelectorAll('[role="menuitemradio"]').length);
  const clickLabel = async (label) => page.evaluate((l) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === l);
    if (b) { b.click(); return true; } return false;
  }, label);
  const openGear = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await countRadios()) > 0) return true;
      await clickLabel('Project settings');
      for (let t = 0; t < 16; t++) { await sleep(300); if ((await countRadios()) > 0) return true; }
    }
    return (await countRadios()) > 0;
  };
  const closePopover = async () => {
    // Close the gear/memory popover WITHOUT pressing Escape. A stray Escape landing after
    // the popover has already closed bubbles up to the parent "Create project" dialog and
    // dismisses it — which is exactly what made the later Create-project click time out for
    // the full 30s. Prefer toggling the gear shut, with a neutral in-modal click as fallback.
    for (let attempt = 0; attempt < 4 && (await countRadios()) > 0; attempt++) {
      await clickLabel('Project settings');
      for (let t = 0; t < 8; t++) { await sleep(200); if ((await countRadios()) === 0) return true; }
      await page.evaluate(() => {
        const lbl = [...document.querySelectorAll('label, h1, h2')]
          .find(e => /Project name|Create project/i.test(e.textContent || ''));
        if (lbl) lbl.click();
      });
      for (let t = 0; t < 8; t++) { await sleep(200); if ((await countRadios()) === 0) return true; }
    }
    return (await countRadios()) === 0;
  };

  // 2026-06-12 UI: "New project" is an icon-only button (aria-label only). It may
  // live in a sidebar Playwright deems "not visible", so click via JS and poll for
  // the dialog. Older UI used a visible-text sidebar entry — keep it as a fallback.
  const nameInput = page.locator('input[name="projectName"]');
  let opened = false;
  for (let i = 0; i < 8 && !opened; i++) {
    if (!(await clickLabel('New project'))) {
      try { await page.getByText('New project', { exact: true }).first().click({ timeout: 2000 }); } catch {}
    }
    await sleep(1500);
    if ((await nameInput.count()) > 0) opened = true;
  }
  if (!opened) { console.error('ABORT: could not open New project dialog.'); process.exit(5); }

  await nameInput.waitFor({ timeout: 8000 });
  await nameInput.fill(name);
  await sleep(400);

  // Open the "Project settings" gear (the memory menu)
  if (!(await openGear())) { console.error('ABORT: could not open Project settings popover.'); process.exit(6); }

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
  if (!(await openGear())) { console.error('ABORT: could not reopen gear to verify memory setting.'); process.exit(7); }
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

  // Close the memory popover before clicking Create (overlay blocks the Create button).
  if (!(await closePopover())) { console.error('ABORT: could not close memory popover before Create.'); process.exit(4); }

  // Create — poll for the enabled "Create project" button and click via the DOM. The old
  // getByRole(...).click() used the 30s default timeout, so a modal that had been dismissed
  // (e.g. by a stray Escape) silently burned the whole timeout before throwing. This fails
  // fast/loud and tolerates the button living in a portal sibling of [role="dialog"].
  let created = false;
  for (let t = 0; t < 20 && !created; t++) {
    created = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => /^create project$/i.test((x.textContent || '').trim()) && !x.disabled && x.offsetParent !== null);
      if (b) { b.click(); return true; }
      return false;
    });
    if (!created) await sleep(400);
  }
  if (!created) { console.error('ABORT: "Create project" button not found/enabled — modal may have been dismissed.'); process.exit(8); }
  await sleep(5500);
  const url = page.url();
  console.log('PROJECT_URL:', url);
  if (!/\/g\/g-p-[^/]+/.test(url)) console.error('WARN: URL does not look like a project URL — verify manually.');
} finally {
  await browser.close();
}
