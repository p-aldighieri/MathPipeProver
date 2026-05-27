/**
 * lib/auth.mjs — ChatGPT login readiness and account chooser handling.
 *
 * Two concerns, packaged together because they share the readiness loop:
 *
 *   - Composer readiness: poll until the composer DOM appears, treat its
 *     presence as proof we're past login + redirects + any chrome loading
 *     state. Useful for both persistent-launch (where login may be needed)
 *     and CDP-attach (where the user's session is usually already valid).
 *
 *   - Account chooser: when Google/etc. shows "Choose an account" with a
 *     single visible non-decoy option, click it automatically. Avoids
 *     wasting login-wait budget on a screen the user clearly does not need
 *     to see. Multiple-option pickers are NOT auto-resolved — those need a
 *     human choice.
 *
 * ## Public API
 *
 *   ensureChatReady(page, waitForLoginSeconds) -> void
 *       Block until the composer is visible. Auto-clicks single-option
 *       account choosers along the way. Prints a one-time stderr notice
 *       when a login screen is detected. Throws on timeout.
 *
 *   maybeSelectSingleAccountChoice(page) -> { clicked, ...details }
 *       One-shot probe: detects the account chooser via body text, picks
 *       the unique "account-like" button, returns { clicked: true, label }
 *       on success or { clicked: false, reason } on no-match / ambiguity.
 *       Safe to call repeatedly.
 */

import { getComposer } from './composer.mjs';

/**
 * Block until the composer appears, polling and auto-resolving account
 * choosers. Throws if the deadline passes without a visible composer.
 */
export async function ensureChatReady(page, waitForLoginSeconds) {
  const deadline = Date.now() + waitForLoginSeconds * 1000;
  let noticeShown = false;
  while (Date.now() < deadline) {
    try {
      await getComposer(page);
      return;
    } catch {
      // Fall through to login wait logic.
    }

    const bodyText = await page.locator('body').innerText().catch(() => '');
    const accountChoice = await maybeSelectSingleAccountChoice(page).catch(() => ({ clicked: false }));
    if (accountChoice.clicked) {
      console.error(`Selected account chooser entry automatically: ${accountChoice.label}`);
      await page.waitForTimeout(1500);
      continue;
    }
    if (!noticeShown && /log in|sign up|continue with/i.test(bodyText)) {
      console.error('ChatGPT login required in the persistent browser profile. Complete login in the opened browser window.');
      noticeShown = true;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error('Timed out waiting for the ChatGPT composer. If this is the first run, log into chatgpt.com in the opened browser profile.');
}

/**
 * If the page is showing an account chooser ("Choose an account",
 * "Continue as ..."), and exactly one visible non-decoy account-like
 * button exists, click it. Returns a discriminated outcome object
 * (caller decides whether to retry).
 */
export async function maybeSelectSingleAccountChoice(page) {
  return await page.evaluate(() => {
    const bodyText = (document.body.innerText || '').toLowerCase();
    if (!/(choose|select|pick)\s+an\s+account|continue as/i.test(bodyText)) {
      return { clicked: false, reason: 'not_account_chooser' };
    }

    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const excluded = [
      /use another account/i, /use a different account/i,
      /another account/i, /different account/i,
      /cancel/i, /back/i, /learn more/i,
      /privacy/i, /terms/i, /help/i,
    ];
    const preferred = [
      /continue as/i, /@/, /\.com\b/i,
      /gmail/i, /google/i, /openai/i,
    ];

    const elements = [...document.querySelectorAll("button, a, [role='button']")]
      .filter(isVisible)
      .map((element) => {
        const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
        return { element, text };
      })
      .filter(({ text }) => text.length > 0)
      .filter(({ text }) => !excluded.some((pattern) => pattern.test(text)));

    const accountLike = elements.filter(({ element, text }) => {
      if (preferred.some((pattern) => pattern.test(text))) return true;
      const parentText = (element.parentElement?.innerText || '').trim();
      return /@/.test(parentText) || /(choose|select|pick)\s+an\s+account/i.test(parentText);
    });

    if (accountLike.length !== 1) {
      return {
        clicked: false,
        reason: 'ambiguous_account_chooser',
        candidates: accountLike.slice(0, 5).map(({ text }) => text),
      };
    }

    accountLike[0].element.click();
    return { clicked: true, label: accountLike[0].text };
  });
}
