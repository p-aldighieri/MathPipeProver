#!/usr/bin/env node
/**
 * cdp_remove_source_v2.mjs — Robust source removal: handles confirmation dialog.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222;
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  names.push(args[i]);
}

async function clickActions(page, sourceName) {
  return await page.evaluate((name) => {
    const nodes = [...document.querySelectorAll('*')];
    for (const node of nodes) {
      if ((node.textContent || '').trim() !== name) continue;
      let current = node;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const button = current.querySelector('button[aria-label="Source actions"]');
        if (button) { button.click(); return true; }
        current = current.parentElement;
      }
    }
    return false;
  }, sourceName);
}

async function listVisibleSourceNames(page) {
  return await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button[aria-label="Source actions"]')];
    const names = new Set();
    for (const btn of buttons) {
      let cur = btn.parentElement;
      for (let d = 0; d < 6 && cur; d++) {
        const text = (cur.innerText || '').trim();
        const m = text.match(/([A-Za-z0-9_\-\.]+\.[A-Za-z0-9]{1,8})/);
        if (m) { names.add(m[1]); break; }
        cur = cur.parentElement;
      }
    }
    return [...names];
  });
}

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);
await page.getByRole('tab', { name: 'Sources', exact: true }).click();
await page.waitForTimeout(1500);

console.log('Initial sources:', JSON.stringify(await listVisibleSourceNames(page)));

const removed = [], skipped = [];
for (const name of names) {
  const before = await listVisibleSourceNames(page);
  if (!before.includes(name)) { skipped.push(name + ' (not present)'); continue; }

  const ok = await clickActions(page, name);
  if (!ok) { skipped.push(name + ' (no actions button)'); continue; }
  await page.waitForTimeout(800);

  try {
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click({ timeout: 8000 });
  } catch (e) {
    skipped.push(name + ' (no Remove menuitem)');
    await page.keyboard.press('Escape').catch(() => {});
    continue;
  }
  await page.waitForTimeout(500);

  // Handle a possible confirmation dialog
  for (let attempt = 0; attempt < 3; attempt++) {
    const confirmBtn = page.getByRole('button', { name: /^(Remove|Confirm|Delete)$/ }).first();
    if (await confirmBtn.count() > 0 && await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      console.log(`  -> confirmed dialog for ${name}`);
      await page.waitForTimeout(800);
    } else break;
  }

  // Verify by re-listing source names from action buttons (not getByText)
  const deadline = Date.now() + 10000;
  let gone = false;
  while (Date.now() < deadline) {
    const after = await listVisibleSourceNames(page);
    if (!after.includes(name)) { gone = true; break; }
    await page.waitForTimeout(500);
  }
  if (gone) removed.push(name); else skipped.push(name + ' (still present)');
}

console.log(JSON.stringify({ removed, skipped }, null, 2));
console.log('Final sources:', JSON.stringify(await listVisibleSourceNames(page)));
await browser.close();
