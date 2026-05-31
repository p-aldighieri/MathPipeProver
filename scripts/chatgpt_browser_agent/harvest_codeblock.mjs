// Harvest the largest code block's textContent (newlines preserved) from a chat's latest assistant turn.
import { attachCDP } from './lib/browser.mjs';
import { clipLatexDocumentVerbose } from './lib/tex_clip.mjs';
import fs from 'node:fs';
const chatUrl = process.argv[2];
const outPath = process.argv[3];
const port = parseInt(process.argv[4] || '9237', 10);
const { browser } = await attachCDP({ port });
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(chatUrl, { waitUntil:'domcontentloaded', timeout:45000 });
await new Promise(r=>setTimeout(r,4000));
const res = await page.evaluate(() => {
  // collect all <code> blocks; textContent preserves newlines
  const codes = Array.from(document.querySelectorAll('pre code, pre'));
  let best = '', bestLen = 0, count = codes.length;
  for (const c of codes) {
    const t = c.textContent || '';
    if (t.length > bestLen) { bestLen = t.length; best = t; }
  }
  return { best, bestLen, count };
});
console.log('code blocks found:', res.count, '| largest chars:', res.bestLen);
console.log('newlines in largest:', (res.best.match(/\n/g)||[]).length);
// If the harvested block is a LaTeX document, strip any model chatter that crept
// in before \documentclass or after \end{document} (LaTeX ignores it, so it
// would otherwise silently pollute the submission source). No-op for non-tex.
const { clipped, removedBefore, removedAfter } = clipLatexDocumentVerbose(res.best);
if (removedBefore || removedAfter) {
  console.log(`tex-clip: removed ${removedBefore} line(s) before \\documentclass, ${removedAfter} line(s) after \\end{document}`);
}
fs.writeFileSync(outPath, clipped, 'utf8');
console.log('wrote', outPath);
await browser.close();
