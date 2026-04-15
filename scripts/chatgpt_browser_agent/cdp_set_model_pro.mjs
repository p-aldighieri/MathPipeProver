#!/usr/bin/env node
/**
 * cdp_set_model_pro.mjs — Verify and set ChatGPT to "Extended Pro" via CDP.
 *
 * "Extended Pro" requires TWO settings:
 *   1. Model = "Pro" (via the ChatGPT header dropdown — NOT the same as "Thinking")
 *   2. Effort = "Extended" (via the Pro pill dropdown in the composer)
 *
 * The composer pill must show "Extended Pro" when correctly configured.
 *
 * Usage:
 *   node cdp_set_model_pro.mjs [--port <PORT>] [--check-only]
 *
 * Options:
 *   --port <PORT>   CDP remote-debugging port (default: 9222)
 *   --check-only    Only check, don't switch. Exit 0 if Extended Pro, 1 otherwise.
 *
 * Exit codes:
 *   0 — Extended Pro confirmed active
 *   1 — Error or not Extended Pro
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
let port = 9222;
let checkOnly = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) { port = parseInt(args[++i], 10); continue; }
  if (args[i] === '--check-only') { checkOnly = true; continue; }
}

// Helper: get the composer pill text (the button near the textarea showing model/effort)
async function getComposerPill(page) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      const text = btn.textContent.trim();
      if (rect.y > 150 && rect.y < 800 &&
          (text === 'Extended Pro' || text === 'Pro' ||
           text.includes('thinking') || text.includes('Thinking') || text === 'Standard Pro')) {
        return text;
      }
    }
    return 'unknown';
  });
}

try {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('chatgpt.com'));
  if (!page) page = ctx.pages()[0];
  if (!page) page = await ctx.newPage();

  if (!page.url().includes('chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));
  }

  // Step 0: Check current state
  const currentPill = await getComposerPill(page);
  console.log('Current pill:', currentPill);

  if (currentPill === 'Extended Pro') {
    console.log('MODEL: Extended Pro (already active)');
    await browser.close();
    process.exit(0);
  }

  if (checkOnly) {
    console.log('MODEL: NOT Extended Pro (current: ' + currentPill + ')');
    await browser.close();
    process.exit(1);
  }

  // Step 1: Select Pro model via header dropdown
  console.log('Step 1: Selecting Pro model...');
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
      break;
    }
  }
  if (!opened) {
    console.error('ERROR: Could not find model dropdown');
    await browser.close();
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 1500));

  // Click "Pro" in the dropdown
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
    console.error('ERROR: Pro option not found in dropdown');
    await browser.close();
    process.exit(1);
  }

  const target = proElements.find(e => e.h > 15 && e.h < 80) || proElements[0];
  await page.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
  console.log('Selected Pro model');
  await new Promise(r => setTimeout(r, 3000));

  // Step 2: Set effort to Extended via the Pro pill in the composer
  console.log('Step 2: Setting Extended effort...');

  // Find the Pro pill in the composer
  const proPill = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const rect = btn.getBoundingClientRect();
      const text = btn.textContent.trim();
      if ((text === 'Pro' || text === 'Standard Pro' || text === 'Extended Pro') &&
          rect.y > 150) {
        return { text, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      }
    }
    return null;
  });

  if (proPill) {
    await page.mouse.click(proPill.x + proPill.w / 2, proPill.y + proPill.h / 2);
    console.log('Opened Pro effort dropdown');
    await new Promise(r => setTimeout(r, 1500));

    // Click "Extended"
    const extOption = page.getByText('Extended', { exact: true }).first();
    if (await extOption.count() > 0) {
      await extOption.click();
      console.log('Selected Extended');
      await new Promise(r => setTimeout(r, 2000));
    } else {
      console.error('ERROR: Extended option not found in Pro dropdown');
    }
  } else {
    console.error('ERROR: Pro pill not found in composer');
  }

  // Verify final state
  const finalPill = await getComposerPill(page);
  console.log('Final pill:', finalPill);

  if (finalPill === 'Extended Pro') {
    console.log('MODEL: Extended Pro (confirmed)');
    await page.screenshot({ path: 'C:/tmp/cdp_extended_pro_confirmed.png' });
    await browser.close();
    process.exit(0);
  } else {
    console.error('ERROR: Expected "Extended Pro", got:', finalPill);
    await page.screenshot({ path: 'C:/tmp/cdp_extended_pro_failed.png' });
    await browser.close();
    process.exit(1);
  }

} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
