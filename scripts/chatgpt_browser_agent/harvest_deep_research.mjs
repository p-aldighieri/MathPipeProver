#!/usr/bin/env node
/**
 * harvest_deep_research.mjs — harvest a completed Deep Research chat.
 *
 * ## Why this exists (investigated live 2026-05-27)
 *
 * A heavy Deep Research job does NOT return its report as chat text. It returns
 * a CANVAS / artifact "document" (a collapsed card titled by the report's first
 * heading, with download + expand icons, e.g. "Research completed in 19m ·
 * 12 citations · 131 searches"). While collapsed, the report markdown is not in
 * the chat DOM, so `latestAssistantText` / `wait_chat_done.mjs` see nothing and
 * time out even though the report is done. The copy button does not write the OS
 * clipboard under CDP (even with permissions granted), so clipboard extraction is
 * a dead end on this transport. The DR canvas DOM is also heavily virtualized and
 * flaky across reloads.
 *
 * The robust workaround, validated live (8.4 KB packet harvested clean): turn DR
 * OFF and ask the model to reproduce the finished packet INLINE as a plain-markdown
 * message. That renders as a normal assistant turn which `latestAssistantText`
 * harvests cleanly (headings, sources, quoted passages, citations, final marker).
 *
 * ## Modes
 *
 *   --repost-now   RECOMMENDED. The operator has already confirmed (by looking at
 *                  the chat — the canvas card / "Research completed" line is shown)
 *                  that research finished. Skip waiting, send the repost, poll the
 *                  inline answer, write it. Most reliable, because DR-completion
 *                  detection is unreliable to automate (the canvas UI is virtualized
 *                  and the plan checklist does not match live-activity phrases).
 *   --auto-wait    EXPERIMENTAL. Poll for DR research to go quiet, then repost.
 *                  Detection is best-effort and can over-wait or misfire; use only
 *                  unattended and prefer --repost-now when you can watch the chat.
 *   --no-repost    Just harvest the current inline answer. For a trivial DR query
 *                  (which answers inline, no canvas) or a chat already reposted.
 *   (no flag)      SAFE default: harvest the inline answer if one is already present;
 *                  otherwise refuse (so it never reposts a half-finished report) and
 *                  tell you to re-run with --repost-now once research is done.
 *
 * ## Faithfulness caveat
 *
 * The repost is a model reproduction, not the byte-identical canvas. The model is
 * instructed to copy verbatim and did so in testing, but for citation-critical use
 * spot-check against the open canvas document.
 *
 * Usage:
 *   node harvest_deep_research.mjs --chat-url URL --port PORT --out PATH \
 *     [--repost-now | --no-repost] [--max-mins N] [--poll-secs N]
 *
 * Exits 0 on success, 1 on transport/URL errors, 2 on timeout.
 */
import fs from 'fs';
import { attachCDP } from './lib/browser.mjs';
import { latestAssistantText, extractChatId } from './lib/poll.mjs';
import { isGenerating, fillComposer, clickSend } from './lib/composer.mjs';
import { ensureExtendedPro } from './lib/model_pill.mjs';

const REPOST_PROMPT =
  'Reproduce the COMPLETE Deep Research report you just produced as a single ' +
  'plain-markdown message directly in THIS chat. Do NOT use the canvas/document ' +
  'tool — write it inline as your reply. Copy every section verbatim (headings, ' +
  'sources, quoted passages, citations) without summarizing, shortening, or ' +
  'omitting anything. If the report ended with a specific final marker line, ' +
  'reproduce that exact line last.';

// Live-DR activity phrases. Scoped to strings DR shows WHILE researching; kept
// narrow to avoid matching a user prompt that happens to contain "search".
const DR_ACTIVITY_RE = /(Searching the web|Reading sources?|Researching|Searched \d|Browsing|Thinking longer|Reasoned for|Working on it)/i;

const args = process.argv.slice(2);
let chatUrl = '', port = 9222, outPath = '', maxMins = 30, pollSecs = 30;
let repostNow = false, noRepost = false, autoWait = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  else if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--out') outPath = args[++i];
  else if (args[i] === '--max-mins') maxMins = parseInt(args[++i], 10);
  else if (args[i] === '--poll-secs') pollSecs = parseInt(args[++i], 10);
  else if (args[i] === '--repost-now') repostNow = true;
  else if (args[i] === '--no-repost') noRepost = true;
  else if (args[i] === '--auto-wait') autoWait = true;
}
if (!chatUrl || !outPath) { console.error('Need --chat-url and --out'); process.exit(1); }
const chatId = extractChatId(chatUrl);
if (!chatId) { console.error(`Could not extract chat ID from URL: ${chatUrl}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startMs = Date.now();
const deadline = () => Date.now() > startMs + maxMins * 60 * 1000;

async function drActivityVisible(page) {
  return await page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const main = document.querySelector('main');
    if (!main) return false;
    const t1 = main.querySelector('[data-testid="conversation-turn-1"]');
    // Only short status lines inside the conversation area (NOT the sidebar nav,
    // NOT the user prompt turn). innerText length is bounded so we don't match a
    // container that happens to enclose chrome text.
    for (const el of main.querySelectorAll('span,p,div')) {
      const txt = (el.innerText || '').trim();
      if (!txt || txt.length > 160) continue;
      if (t1 && t1.contains(el)) continue;
      if (re.test(txt)) return true;
    }
    return false;
  }, DR_ACTIVITY_RE.source);
}

/** Poll the inline assistant answer until it stabilizes. Returns the text. */
async function pollInline(page, { minLen = 600, label = 'harvest' } = {}) {
  let last = '', stable = 0;
  while (!deadline()) {
    await sleep(pollSecs * 1000);
    if (!page.url().includes(chatId)) {
      await page.goto(chatUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await sleep(3000);
    }
    const txt = await latestAssistantText(page).catch(() => '');
    const gen = await isGenerating(page).catch(() => false);
    if (txt && txt === last && !gen && txt.length >= minLen) stable += 1; else stable = 0;
    last = txt || last;
    const elapsed = Math.round((Date.now() - startMs) / 60000);
    console.log(`[${label} @ ${elapsed}min] gen=${gen} len=${(txt || '').length} stable=${stable}`);
    if (stable >= 2) return last;
  }
  return last;
}

try {
  const { context, close } = await attachCDP({ port });
  let page = context.pages().find((p) => p.url().includes(chatId)) || await context.newPage();
  await page.bringToFront();
  await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });
  await sleep(5000);
  if (!page.url().includes(chatId)) {
    console.error(`Navigation drifted off target chat ${chatId}; current URL: ${page.url()}`);
    await close(); process.exit(1);
  }

  // ── Phase 1 (--auto-wait, EXPERIMENTAL): wait for research to go quiet ──
  if (autoWait && !repostNow && !noRepost) {
    let observedActivity = false, quiet = 0;
    while (!deadline()) {
      const active = await drActivityVisible(page);
      const gen = await isGenerating(page).catch(() => false);
      const inline = (await latestAssistantText(page).catch(() => '')).length;
      if (active || gen) { observedActivity = true; quiet = 0; }
      else quiet += 1;
      const elapsed = Math.round((Date.now() - startMs) / 60000);
      console.log(`[wait @ ${elapsed}min] drActivity=${active} gen=${gen} inlineLen=${inline} quiet=${quiet}`);
      // If a substantial inline answer is already present, this was a trivial DR
      // (no canvas) — harvest it directly, no repost needed.
      if (inline > 1500 && !active && !gen) break;
      // Research considered finished after sustained quiet, having seen activity.
      if (observedActivity && quiet >= 4) break;
      await sleep(pollSecs * 1000);
    }
  }

  // ── Decide whether to repost ──
  const inlineNow = (await latestAssistantText(page).catch(() => '')).length;
  let shouldRepost;
  if (noRepost) shouldRepost = false;
  else if (inlineNow > 1500) shouldRepost = false;          // inline answer already there
  else if (repostNow || autoWait) shouldRepost = true;
  else {
    // SAFE default: no inline answer and no mode flag — refuse rather than risk
    // reposting a half-finished report.
    console.error(
      'No inline answer present and no mode flag given. If Deep Research has FINISHED ' +
      '(canvas card / "Research completed" line shown), re-run with --repost-now. ' +
      'To harvest an already-inline answer use --no-repost; to poll automatically ' +
      '(best-effort) use --auto-wait.');
    await close(); process.exit(2);
  }

  // ── Phase 2: repost inline ──
  if (shouldRepost) {
    try { await ensureExtendedPro(page); } catch (e) { console.log('ensureExtendedPro warn:', e.message); }
    const composer = await fillComposer(page, REPOST_PROMPT);
    await sleep(1200);
    const sent = await clickSend(page, composer);
    console.log('repost sent:', sent);
    await sleep(6000);
  } else {
    console.log('Skipping repost (inline answer already present or --no-repost).');
  }

  // ── Phase 3: harvest the inline answer ──
  const text = await pollInline(page, { minLen: 600, label: 'harvest' });
  if (!text) {
    console.log('No inline text harvested before deadline.');
    await close(); process.exit(2);
  }
  fs.writeFileSync(outPath, text, 'utf-8');
  console.log(`DONE: wrote ${text.length} chars to ${outPath}`);
  await close();
  process.exit(0);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}
