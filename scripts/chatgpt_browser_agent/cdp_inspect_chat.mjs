import { chromium } from 'playwright';
const args = process.argv.slice(2);
let chatUrl='', port=9222;
for (let i=0;i<args.length;i++){
  if(args[i]==='--chat-url')chatUrl=args[++i];
  if(args[i]==='--port')port=parseInt(args[++i],10);
}
const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('chatgpt.com')) || ctx.pages()[0];
await page.bringToFront();
await page.goto(chatUrl,{waitUntil:'domcontentloaded'});
await new Promise(r=>setTimeout(r,6000));
try { await page.waitForSelector('[data-message-author-role="assistant"]', { timeout: 12000 }); } catch {}
await new Promise(r=>setTimeout(r,2500));
const state = await page.evaluate(()=>{
  const out = {};
  out.url = location.href;
  const stop = document.querySelector('[data-testid="composer-speech-button"], button[aria-label*="Stop"]');
  out.stopButton = !!stop;
  const sendBtn = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send"]');
  out.sendButtonEnabled = sendBtn ? !sendBtn.disabled : null;
  // Look for "Thinking" or "Generating" indicators
  const bw = document.body.innerText;
  out.hasThinking = /thinking\.{0,3}|generating|reasoning/i.test(bw.slice(0,5000));
  out.hasThoughtFor = /thought for/i.test(bw);
  // Count assistant messages
  out.assistantMessages = document.querySelectorAll('[data-message-author-role="assistant"]').length;
  // Last assistant message length
  const arr = document.querySelectorAll('[data-message-author-role="assistant"]');
  if(arr.length){
    const last = arr[arr.length-1];
    out.lastAssistantLen = (last.innerText||'').length;
    out.lastAssistantTail = (last.innerText||'').slice(-300);
  }
  return out;
});
console.log(JSON.stringify(state,null,2));
await page.screenshot({path:'C:/tmp/chat_inspect.png'});
await browser.close();
