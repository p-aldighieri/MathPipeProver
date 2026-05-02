import { chromium } from 'playwright';

const args = process.argv.slice(2);
let projectUrl = '', port = 9222;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--project-url' && args[i + 1]) projectUrl = args[++i];
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
}

const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

const sourcesTab = page.getByText('Sources', { exact: true }).first();
if (await sourcesTab.count() > 0) {
  await sourcesTab.click();
  await new Promise(r => setTimeout(r, 2000));
}

// Try to extract visible file names from the sources panel
const names = await page.evaluate(() => {
  // Look for elements that look like file list entries
  const candidates = Array.from(document.querySelectorAll('[class*="source"], [data-testid*="source"], div[class*="file"], li'));
  const seen = new Set();
  const results = [];
  candidates.forEach(el => {
    const txt = (el.innerText || '').trim();
    // Heuristic: file-like names with extension
    const match = txt.match(/([a-zA-Z0-9_\-]+\.(?:tex|md|pdf|txt))/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      results.push(match[1]);
    }
  });
  return results;
});

console.log('Detected sources:');
names.forEach(n => console.log('  ', n));
await page.screenshot({ path: 'C:/tmp/sources_listing.png' });
console.log('Screenshot: C:/tmp/sources_listing.png');
await browser.close();
