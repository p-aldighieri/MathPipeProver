#!/usr/bin/env node
/**
 * cdp_set_model_pro.mjs — Verify and set the ChatGPT model to "Pro" via CDP.
 *
 * IMPORTANT: "Pro" (Research-grade intelligence) is a DIFFERENT MODEL from
 * "Thinking" (which has effort sub-levels: Light/Standard/Extended/Heavy).
 * The model is selected via the ChatGPT header dropdown, NOT the effort pill.
 *
 * Usage:
 *   node cdp_set_model_pro.mjs [--port <PORT>]
 *
 * Options:
 *   --port <PORT>   CDP remote-debugging port (default: 9222)
 *   --check-only    Only check current model, don't switch
 *
 * What it does:
 *   1. Connects to Chrome via CDP
 *   2. Navigates to chatgpt.com
 *   3. Checks current model by looking at composer pill
 *   4. If not Pro, opens model dropdown and clicks "Pro"
 *   5. Verifies the switch
 *
 * Exit codes:
 *   0 — Pro model confirmed active
 *   1 — Error or could not switch to Pro
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
let port = 9222;
let checkOnly = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-only') { checkOnly = true; continue; }
}

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  // Navigate to chatgpt.com if not already there
  if (!page.url().includes('chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
  }

  // Check if Pro is already active by looking at the composer pill
  const currentPill = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      // Composer area buttons (y > 300)
      if (rect.y > 300) {
        const text = btn.textContent.trim();
        if (text.includes('Pro') || text.includes('thinking') || text.includes('Extended')) {
          return text;
        }
      }
    }
    return 'unknown';
  });

  console.log('Current composer pill:', currentPill);

  if (currentPill.includes('Pro')) {
    console.log('MODEL: Pro (already active)');
    await browser.close();
    process.exit(0);
  }

  if (checkOnly) {
    console.log('MODEL: NOT Pro (current:', currentPill, ')');
    await browser.close();
    process.exit(1);
  }

  console.log('Switching to Pro...');

  // Find and click the ChatGPT header dropdown
  const allBtns = page.locator('button');
  const btnCount = await allBtns.count();
  let opened = false;
  for (let i = 0; i < btnCount; i++) {
    const btn = allBtns.nth(i);
    const box = await btn.boundingBox();
    const text = await btn.textContent();
    if (box && box.y < 50 && text && text.includes('ChatGPT')) {
      await btn.click();
      opened = true;
      console.log('Opened model dropdown');
      break;
    }
  }

  if (!opened) {
    console.error('ERROR: Could not find model dropdown');
    await browser.close();
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 1500));

  // Find the "Pro" option by locating the SPAN with text "Pro" in the dropdown area
  const proElements = await page.evaluate(() => {
    const allEls = document.querySelectorAll('*');
    const results = [];
    for (const el of allEls) {
      const text = el.textContent?.trim();
      const rect = el.getBoundingClientRect();
      if (text === 'Pro' && rect.width > 20 && rect.width < 300 && rect.y > 40 && rect.y < 300) {
        results.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
      }
    }
    return results;
  });

  if (proElements.length === 0) {
    console.error('ERROR: Could not find Pro option in dropdown');
    await browser.close();
    process.exit(1);
  }

  // Click the Pro element
  const target = proElements.find(e => e.h > 15 && e.h < 80) || proElements[0];
  await page.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
  console.log('Clicked Pro');
  await new Promise(r => setTimeout(r, 3000));

  // Verify
  const newPill = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      if (rect.y > 300) {
        const text = btn.textContent.trim();
        if (text.includes('Pro') || text.includes('thinking') || text.includes('Extended')) {
          return text;
        }
      }
    }
    return 'unknown';
  });

  if (newPill.includes('Pro')) {
    console.log('MODEL: Pro (confirmed active)');
    await page.screenshot({ path: 'C:/tmp/cdp_model_pro_confirmed.png' });
    await browser.close();
    process.exit(0);
  } else {
    console.error('ERROR: Switch failed. Pill shows:', newPill);
    await page.screenshot({ path: 'C:/tmp/cdp_model_pro_failed.png' });
    await browser.close();
    process.exit(1);
  }

} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
