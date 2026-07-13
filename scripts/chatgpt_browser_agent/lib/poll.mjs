/**
 * lib/poll.mjs — assistant-text reading, stability polling, clipboard extraction.
 *
 * Three concerns, related but distinct:
 *
 *   1. DOM reading: latestAssistantText, assistantTurnHasCopyButton,
 *      dumpAllMessages — pull what's on screen right now.
 *
 *   2. Stability polling: waitForStableAssistantReply — block until the
 *      latest assistant turn stops changing under various criteria
 *      (configurable via opts to cover both the wrapper's submit-flow
 *      needs and wait_chat_done.mjs's URL-pinned polling needs).
 *
 *   3. Clean extraction: extractAssistantResponse — copy-button + clipboard
 *      sniffing, used after stability is reached to get clean markdown
 *      (innerText loses bold, etc.). macOS-only (uses pbcopy/pbpaste);
 *      gracefully falls back to innerText elsewhere.
 *
 * ## Reconciliation note (2026-05-23 PIOTR hardening)
 *
 * `wait_chat_done.mjs` was hardened to pin its polling to a specific
 * chat ID extracted from the URL, after a bug where parallel pollers
 * grabbed content from each other's chats when multiple were open.
 * That hardening is preserved here as the `chatIdPin` + `renavigateEveryNPolls`
 * opts on `waitForStableAssistantReply` — opt-in, so the wrapper's
 * in-session submit flow (which polls its own freshly-created chat
 * page) doesn't pay the re-navigation overhead.
 *
 * ## Assistant text extraction strategy
 *
 * Primary selector: `[data-message-author-role="assistant"]` — ChatGPT's
 * stable data attribute, used by wait_chat_done and cdp_dump_chat.
 * Fallback: article+"ChatGPT said:" innerText filter — the wrapper's
 * older approach, kept for robustness against attribute removal. The
 * "Thought for X" reasoning-preamble filter applies in both paths.
 *
 * ## Public API
 *
 *   latestAssistantText(page) -> string
 *   dumpAllMessages(page) -> Array<{role, id, text}>
 *   assistantTurnHasCopyButton(page) -> boolean
 *   isInterimAssistantText(text) -> boolean
 *   extractChatId(url) -> string | null
 *   extractAssistantResponse(page, fallbackOverride?) -> string
 *   waitForStableAssistantReply(page, opts) -> string
 */

import { execFileSync } from 'node:child_process';

// ── DOM reading ────────────────────────────────────────────────────────

/**
 * Latest assistant message text. Strips "ChatGPT said:" prefix and
 * "Thought for X" reasoning preambles. Falls back to article scan
 * then body-text scrape if the data-attribute selector misses.
 */
export async function latestAssistantText(page) {
  return await page.evaluate(() => {
    // Strategy 1 (preferred): ChatGPT's data-attribute marker. Matches
    // wait_chat_done.mjs / cdp_dump_chat.mjs conventions.
    const dataNodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (dataNodes.length > 0) {
      const last = dataNodes[dataNodes.length - 1];
      const clone = last.cloneNode(true);
      clone.querySelectorAll('button').forEach((b) => b.remove());
      let text = (clone.innerText || '').trim();
      // Drop the "Thought for X" reasoning preamble if present at the start.
      text = text.replace(/^Thought for[^\n]*\n+/i, '').trim();
      if (text) return text;
    }

    // Strategy 2 (fallback): article scan + "ChatGPT said:" filter.
    const articles = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const assistantTexts = [];
    for (const article of articles) {
      const clone = article.cloneNode(true);
      clone.querySelectorAll('button').forEach((b) => b.remove());
      const raw = (clone.innerText || '').trim();
      if (!raw || !/^ChatGPT said:/i.test(raw)) continue;
      const cleaned = raw.replace(/^ChatGPT said:\s*/i, '').trim();
      if (!cleaned || /^Thought for\b/i.test(cleaned)) continue;
      assistantTexts.push(cleaned);
    }
    if (assistantTexts.length > 0) return assistantTexts[assistantTexts.length - 1];

    // Strategy 3 (last resort): body-text scrape, trimming known footer markers.
    const body = (document.body.innerText || '').trim();
    const marker = 'ChatGPT said:';
    const start = body.lastIndexOf(marker);
    if (start === -1) return '';
    let tail = body.slice(start + marker.length).trim();
    for (const stopMarker of [
      '\n\nExtended Pro',
      '\n\nPro Extended',
      '\n\nSol Pro',
      '\n\nChatGPT can make mistakes.',
      '\n\nAdd files and more',
      '\n\nStart Voice',
    ]) {
      const stop = tail.indexOf(stopMarker);
      if (stop !== -1) tail = tail.slice(0, stop).trim();
    }
    // 2026-07 UI: the composer pill reads just "Pro". A substring stop
    // marker for it would false-match content like "Proof." or
    // "Proposition 2" after a blank line, so only strip "Pro" when it is
    // the exact final line of the scrape.
    tail = tail.replace(/\n\nPro$/, '').trim();
    return tail;
  });
}

/**
 * Dump every message (user + assistant) in the current chat as
 * structured objects. Used by cdp_dump_chat.mjs for full transcript
 * export.
 */
export async function dumpAllMessages(page) {
  return await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-message-author-role]')];
    return nodes.map((n) => ({
      role: n.getAttribute('data-message-author-role'),
      id: n.getAttribute('data-message-id'),
      text: (n.innerText || ''),
    }));
  });
}

/** True iff the latest assistant turn shows the copy-message button. */
export async function assistantTurnHasCopyButton(page) {
  return await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const assistantArticle = [...articles].reverse().find((article) =>
      /^ChatGPT said:/i.test((article.innerText || '').trim())
    );
    if (!assistantArticle) {
      return [...document.querySelectorAll('button')].some((button) =>
        (button.getAttribute('aria-label') || '').toLowerCase().includes('copy response')
      );
    }
    return Boolean(assistantArticle.querySelector('[data-testid="copy-turn-action-button"]'));
  });
}

/**
 * Is this likely an interim/streaming state rather than the final answer?
 *
 * Heuristic: short text (<400 chars) containing words like "thinking",
 * "reading documents", "searching the web", or "analyzing". Long text
 * always wins (false), even if it contains those words mid-answer.
 */
export function isInterimAssistantText(text) {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > 400) return false;
  return (
    normalized.includes('reading documents') ||
    normalized.includes('searching the web') ||
    normalized.includes('thinking') ||
    normalized.includes('analyzing')
  );
}

// ── URL helpers ────────────────────────────────────────────────────────

/**
 * Extract the chat ID (UUID-shaped segment after /c/) from a ChatGPT URL.
 * Used for pinning a poller to a specific chat across re-navigations.
 */
export function extractChatId(url) {
  const m = String(url || '').match(/\/c\/([a-f0-9-]+)/);
  return m ? m[1] : null;
}

// ── Clipboard extraction (macOS only) ──────────────────────────────────
//
// Deliberately macOS-only. A Windows path was tried 2026-05-27 (PowerShell
// Get-Clipboard/clip) but ABANDONED: ChatGPT's copy button writes via the async
// Clipboard API, which does NOT reach the OS clipboard under CDP automation even
// with clipboard-read/write permissions granted — the JS-clicked copy is a no-op,
// so reading the OS clipboard returns STALE content and extractAssistantResponse
// would hand back junk instead of the answer. On non-darwin the safe behaviour is
// to return null here and let callers fall back to innerText.

function readClipboardText() {
  if (process.platform !== 'darwin') return null;
  try { return execFileSync('pbpaste', { encoding: 'utf8' }); } catch { return null; }
}

function restoreClipboardText(text) {
  if (process.platform !== 'darwin' || text == null) return;
  try { execFileSync('pbcopy', { input: text, encoding: 'utf8' }); } catch { /* best-effort */ }
}

/**
 * Get the clean markdown text of the latest assistant turn by clicking
 * its copy-button and reading the clipboard.
 *
 * Preserves formatting (bold, lists, code blocks) that innerText loses.
 * Falls back to the passed-in fallback (or DOM scrape) on macOS-non-
 * Darwin, copy-button missing, or short/empty clipboard.
 */
export async function extractAssistantResponse(page, fallbackOverride = '') {
  const fallbackText = (fallbackOverride || await latestAssistantText(page)).trim();
  const previousClipboard = readClipboardText();

  try {
    const copied = await page.evaluate(() => {
      const articles = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
      const assistantArticle = [...articles].reverse().find((article) =>
        /^ChatGPT said:/i.test((article.innerText || '').trim())
      );
      if (!assistantArticle) {
        const pageButton = [...document.querySelectorAll('button')].find((button) =>
          (button.getAttribute('aria-label') || '').toLowerCase().includes('copy response')
        );
        if (!pageButton) return false;
        pageButton.click();
        return true;
      }
      const button = assistantArticle.querySelector('[data-testid="copy-turn-action-button"]');
      if (!button) return false;
      button.click();
      return true;
    });

    if (copied) {
      await page.waitForTimeout(1200);
      const copiedText = (readClipboardText() || '').trim();
      if (copiedText && !copiedText.includes('[TRUNCATED]')) {
        if (!fallbackText) return copiedText;
        if (copiedText === fallbackText) return copiedText;
        // Accept if clipboard text is at least 60% of fallback or 200 chars,
        // whichever is greater (reject obviously bad captures like a single URL).
        if (copiedText.length >= Math.max(200, Math.floor(fallbackText.length * 0.6))) {
          return copiedText;
        }
      }
    }
  } finally {
    restoreClipboardText(previousClipboard);
  }
  return fallbackText;
}

// ── Stability polling ──────────────────────────────────────────────────

import { isGenerating } from './composer.mjs';
import { isDeepResearchWorking } from './model_pill.mjs';

/**
 * Poll a chat until the assistant turn stabilizes.
 *
 * @param {object} opts
 * @param {number} opts.pollSeconds          poll interval (e.g. 10 or 60)
 * @param {number} opts.maxWaitSeconds       deadline from now
 * @param {function?} opts.onPoll            optional async callback per poll;
 *                                           receives { chatUrl, currentTextLength,
 *                                           generating, readyToCopy, stableCycles,
 *                                           deadlineAt }. Used for status snapshots.
 * @param {boolean} opts.requireCopyButton   default true. submit-flow needs the
 *                                           copy button for clipboard extraction;
 *                                           wait_chat_done sets false (lighter check).
 * @param {number} opts.minStableLength      default 0. wait_chat_done sets 200 to
 *                                           avoid declaring stable on short interim
 *                                           outputs.
 * @param {string?} opts.chatIdPin           if set, throws on URL drift off this
 *                                           chat ID. Use with renavigateEveryNPolls
 *                                           for resilient long polls of an existing
 *                                           chat URL.
 * @param {string?} opts.chatUrl             must be set when chatIdPin is set; used
 *                                           as the re-navigation target.
 * @param {number?} opts.renavigateEveryNPolls  re-goto chatUrl every N polls. Opt-in
 *                                              hardening from wait_chat_done.
 * @param {boolean} opts.deepResearch        default false. Set for Deep Research
 *                                           chats: DR's research phase has no stop
 *                                           button so isGenerating reads false the
 *                                           whole time; this ORs in isDeepResearchWorking
 *                                           so the poller keeps waiting through the
 *                                           research phase instead of finalizing early.
 *                                           Keep requireCopyButton false (DR's copy
 *                                           button is unreliable — see wait_chat_done);
 *                                           DR completion rides on stable report text
 *                                           plus minStableLength.
 *
 * @returns the stable assistant text. Throws on deadline or URL drift.
 */
export async function waitForStableAssistantReply(page, opts) {
  const {
    pollSeconds, maxWaitSeconds,
    onPoll = null,
    requireCopyButton = true,
    minStableLength = 0,
    chatIdPin = null,
    chatUrl = null,
    renavigateEveryNPolls = null,
    deepResearch = false,
  } = opts;

  if (chatIdPin && !chatUrl) {
    throw new Error('waitForStableAssistantReply: chatIdPin requires chatUrl for re-navigation.');
  }

  const deadline = Date.now() + maxWaitSeconds * 1000;
  let lastText = '';
  let stableCycles = 0;
  let unchangedCycles = 0;
  let pollIdx = 0;

  while (Date.now() < deadline) {
    pollIdx += 1;

    // Optional periodic re-navigation to keep page state fresh. A transient
    // goto timeout must NOT kill the poll (observed repeatedly 2026-07-13:
    // ChatGPT chat pages intermittently exceed 30s on reload, especially with
    // concurrent pollers on one Chrome; generation continues server-side).
    // On failure, skip this cycle's refresh — the existing DOM still polls,
    // and the next scheduled re-navigation retries.
    if (renavigateEveryNPolls && pollIdx > 1 && pollIdx % renavigateEveryNPolls === 0) {
      try {
        await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      } catch (e) {
        if (onPoll) onPoll({ note: `re-navigation failed (${String(e.message).split('\n')[0]}); retrying next cycle` });
      }
    }

    // URL drift detection (only when chatIdPin set).
    if (chatIdPin && !page.url().includes(chatIdPin)) {
      throw new Error(`Navigation drifted off target chat ${chatIdPin}; current URL: ${page.url()}`);
    }

    const currentText = await latestAssistantText(page);
    // DR's research phase shows no stop button (isGenerating blind), so OR in
    // the DR-working signal when polling a Deep Research chat.
    const generating = (await isGenerating(page))
      || (deepResearch && await isDeepResearchWorking(page));
    const readyToCopy = requireCopyButton ? await assistantTurnHasCopyButton(page) : true;

    if (currentText && currentText === lastText) unchangedCycles += 1;
    else unchangedCycles = 0;

    if (currentText && currentText === lastText && !generating) stableCycles += 1;
    else stableCycles = 0;

    if (currentText) lastText = currentText;

    if (onPoll) {
      await onPoll({
        chatUrl: page.url(),
        currentTextLength: currentText.length,
        lastTextLength: lastText.length,
        generating,
        readyToCopy,
        stableCycles,
        deadlineAt: new Date(deadline).toISOString(),
      });
    }

    const longEnough = lastText.length >= minStableLength;
    if (longEnough && lastText && stableCycles >= 2 && readyToCopy && !isInterimAssistantText(lastText)) {
      return lastText;
    }
    // Fallback: ChatGPT can leave a stale stop-button behind after text stabilizes.
    // If the text stops changing for long enough, trust the stable text.
    if (longEnough && lastText && unchangedCycles >= 4 && readyToCopy && !isInterimAssistantText(lastText)) {
      return lastText;
    }

    await page.waitForTimeout(pollSeconds * 1000);
  }

  throw new Error('Timed out waiting for a stable assistant reply.');
}
