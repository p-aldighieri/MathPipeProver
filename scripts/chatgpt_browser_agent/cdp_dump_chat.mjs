import { chromium } from 'playwright';
import fs from 'fs';
const args = process.argv.slice(2);
let chatUrl='', port=9222, outPath='C:/tmp/chat_dump.md';
for (let i=0;i<args.length;i++){
  if(args[i]==='--chat-url')chatUrl=args[++i];
  if(args[i]==='--port')port=parseInt(args[++i],10);
  if(args[i]==='--out')outPath=args[++i];
}
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(chatUrl,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,6000));
try { await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 15000 }); } catch {}
// Scroll to ensure DOM is fully populated
await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
await new Promise(r=>setTimeout(r,2000));
const out = await page.evaluate(()=>{
  const arr = Array.from(document.querySelectorAll('[data-message-author-role]'));
  return arr.map(n => ({
    role: n.getAttribute('data-message-author-role'),
    id: n.getAttribute('data-message-id'),
    text: n.innerText
  }));
});
fs.writeFileSync(outPath, out.map(m=>`\n========\nROLE: ${m.role} (id=${m.id})\n========\n${m.text}\n`).join(''));
console.log(`Wrote ${out.length} messages to ${outPath}`);
out.forEach((m,i)=>console.log(`[${i}] ${m.role} len=${m.text.length} id=${m.id}`));
await browser.close();
