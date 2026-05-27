/**
 * lib/composer.mjs — ChatGPT composer interaction.
 *
 * Single source of truth for textarea detection, send-button clicking, and
 * "is the model currently generating?" checks. The composer DOM has several
 * candidate selectors that ChatGPT swaps between across UI revisions
 * (contenteditable role=textbox, named textarea, legacy id). This module
 * encapsulates the fallback chains. Both `cdp_submit.mjs` and
 * `chatgpt_browser_agent.mjs` consume these primitives.
 *
 * ## Public API
 *
 *   getComposer(page) -> locator
 *       Multi-candidate composer locator. Throws if none becomes visible.
 *
 *   fillComposer(page, text) -> locator
 *       Find the composer, click it, fill with `text`. Returns the locator
 *       so the caller can pass it to clickSend() without re-querying.
 *
 *   clickSend(page, composer) -> boolean
 *       Click Send via a fallback chain: role-name button → testid button →
 *       form.requestSubmit() → composer.press('Enter'). Returns true if
 *       any step appeared to succeed.
 *
 *   isGenerating(page) -> boolean
 *       Scan all buttons for stop/pause aria-labels or text. True iff the
 *       model is currently streaming a response.
 *
 *   COMPOSER_CANDIDATE_SELECTORS, SEND_BUTTON_FALLBACK_SELECTORS
 *       Exported for callers that do their own DOM scraping.
 */

export const COMPOSER_CANDIDATE_SELECTORS = [
  '[contenteditable="true"][role="textbox"]',
  'textarea[name="prompt-textarea"]',
  '[id="prompt-textarea"]', // legacy
];

export const SEND_BUTTON_FALLBACK_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label*="Send"]',
];

// Aria-label / innerText fragments that signal "model is generating right now".
// Lower-cased for case-insensitive substring matching.
const STOP_GENERATING_PATTERNS = [
  'stop streaming',
  'stop generating',
  'stop response',
  'pause generating',
  'pause streaming',
];

/**
 * Locate the composer with multi-candidate fallback.
 *
 * Tries Playwright role/locator APIs first (most resilient to text/aria
 * changes), then falls back to selectors. Each candidate waits up to 1s
 * for visibility — total worst case ~4s before throw.
 */
export async function getComposer(page) {
  const candidates = [
    page.locator('[contenteditable="true"][role="textbox"]').first(),
    page.getByRole('textbox').first(),
    page.locator('textarea[name="prompt-textarea"]').first(),
    page.locator('[id="prompt-textarea"]').first(),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) continue;
    try {
      await candidate.waitFor({ state: 'visible', timeout: 1000 });
      return candidate;
    } catch { /* try next */ }
  }
  throw new Error('Timed out waiting for the ChatGPT composer.');
}

/**
 * Find composer, click it (focus), fill it with `text`. Returns the
 * locator so the caller can chain clickSend(page, composer) without
 * re-querying the DOM.
 *
 * The 500ms post-click wait is empirical: ChatGPT's composer sometimes
 * resets its focus state immediately after click; fill-on-unfocused
 * leads to silent no-ops on some UI revisions.
 */
export async function fillComposer(page, text) {
  const composer = await getComposer(page);
  await composer.click();
  await new Promise(r => setTimeout(r, 500));
  await composer.fill(text);
  return composer;
}

/**
 * Click Send via a 4-step fallback chain.
 *
 * Step 1: role+name button ("Send prompt") — modern UI's preferred entry.
 * Step 2: data-testid="send-button" — older UI variants.
 * Step 3: form.requestSubmit() — bypasses button entirely if a form exists.
 * Step 4: composer.press('Enter') — last resort.
 *
 * Returns true if any step appeared to succeed; false if all four fall
 * through (rare; usually means the composer DOM has changed shape).
 */
export async function clickSend(page, composer) {
  const roleBtn = page.getByRole('button', { name: 'Send prompt', exact: true }).first();
  if ((await roleBtn.count()) > 0) {
    await roleBtn.click();
    return true;
  }
  const testidBtn = page.locator('[data-testid="send-button"]').first();
  if ((await testidBtn.count()) > 0) {
    await testidBtn.click();
    return true;
  }
  const submitted = await page.evaluate(() => {
    const form = document.querySelector('form[aria-label]');
    if (!form) return false;
    form.requestSubmit();
    return true;
  });
  if (submitted) return true;
  if (composer) {
    await composer.press('Enter');
    return true;
  }
  return false;
}

/**
 * Is the model currently generating?
 *
 * Scans every button for an aria-label or innerText fragment matching the
 * known stop/pause patterns. Robust to ChatGPT swapping out the stop-button
 * testid (which they have done multiple times).
 */
export async function isGenerating(page) {
  return await page.evaluate((patterns) => {
    return [...document.querySelectorAll('button')].some((button) => {
      const label = `${button.getAttribute('aria-label') || ''} ${(button.innerText || '').trim()}`.toLowerCase();
      return patterns.some((p) => label.includes(p));
    });
  }, STOP_GENERATING_PATTERNS);
}
