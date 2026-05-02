#!/usr/bin/env node
/**
 * Diagnostic: open the source-actions menu for a given source and list its menuitems.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222, sourceName = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) { projectUrl = args[++i]; continue; }
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--name' && args[i + 1]) { sourceName = args[++i]; continue; }
}

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(3000);

await page.getByRole('tab', { name: 'Sources', exact: true }).click();
await page.waitForTimeout(1500);

const clicked = await page.evaluate((name) => {
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

console.log('Action button clicked:', clicked);
await page.waitForTimeout(800);

const items = await page.getByRole('menuitem').allTextContents();
console.log('Menu items:', JSON.stringify(items));

await page.screenshot({ path: 'C:/tmp/actions_menu.png' });
console.log('Screenshot: C:/tmp/actions_menu.png');
await browser.close();
