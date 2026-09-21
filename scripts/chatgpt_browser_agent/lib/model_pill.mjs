/**
 * lib/model_pill.mjs — Composer model-pill detection and Pro-target enforcement
 * (current target: GPT-6 Pro — "Latest" model family at the top Power level).
 *
 * Single source of truth for everything related to reading and setting the
 * ChatGPT composer's model+effort state. Both `cdp_submit.mjs` (the thin
 * orchestrator-driven entry point) and `chatgpt_browser_agent.mjs` (the
 * prepare/submit/recover/inspect CLI) import from here. Do not duplicate this
 * logic in other scripts; if the ChatGPT DOM changes again, this is the only
 * file that needs to be updated.
 *
 * ## UI history (short)
 *
 *   2026-05: reasoning radios ("Instant | Medium | High | Pro") in the pill menu.
 *   2026-06: "Intelligence" menu, lanes up to "Pro Extended", GPT-5.5 submenu row.
 *   2026-07: GPT-5.6 Sol; lanes "Instant | Medium | High | Extra High | Pro";
 *            pill read just "Pro". Pipeline target was called "Sol Pro"
 *            (legacy name "Extended Pro" — function names keep that name).
 *
 * ## Current UI (verified live 2026-09-21, GPT-6 era)
 *
 * The composer pill (`button.__composer-pill[aria-haspopup="menu"]`, tooltip
 * "Thinking effort", shortcut Ctrl+Shift+M) renders two spans: the model
 * family token and the power level, e.g. "6" + "Pro" (innerText "6\nPro";
 * textContent glues them to "6Pro", so always read innerText).
 *
 * Clicking the pill opens `[data-testid="composer-intelligence-picker-content"]`:
 *
 *   - `[role="menuitem"][aria-label="Select model"]` — header, reads "6 Pro".
 *   - `[role="menuitem"][aria-label="Power"]` — a 5-step slider (Radix;
 *     inner `[role="slider"]` has aria-valuemin=0, aria-valuemax=4,
 *     aria-valuenow; the slider root carries data-max="true" at the top step).
 *     The menuitem takes ArrowLeft/ArrowRight (aria-keyshortcuts) to move one
 *     step; screen-reader text reads e.g. "Pro, 5 of 5.". The top step is Pro.
 *   - `[role="menuitemradio"]` family radios: "Latest" (= GPT-6 today),
 *     "GPT-5.6 Sol", "GPT-5.5" ("Leaving on October 14").
 *
 * Pipeline target: family radio "Latest" + Power at max ⇒ pill "6 Pro".
 * The pill is the authoritative gate: tier must read "Pro" and the family
 * token must be a model version ≥ MPP_MIN_MODEL_VERSION (default 6), so a
 * future "6.1"/"7" passes while a silent fallback to 5.x is refused.
 *
 * Overrides (env):
 *   MPP_MODEL_FAMILY        family radio to select (default "Latest").
 *   MPP_MIN_MODEL_VERSION   minimum accepted pill family version (default 6).
 *
 * ## Public API
 *
 *   readPill(page) -> string
 *       Pill text normalized to one line ("6 Pro"). 'unknown' if it never
 *       resolves. Never throws.
 *
 *   parsePill(text) -> { family, tier }
 *   isTargetPill(text) -> boolean
 *       Pure helpers for the gate above.
 *
 *   readPickerState(page) -> { pill, family, powerNow, powerMax, familyRadio }
 *       Opens the picker read-only, reports its state, closes it.
 *
 *   ensureExtendedPro(page) -> void      (alias: ensureProTarget)
 *       Idempotent enforcement of the Pro target. Returns silently if the
 *       pill already passes the gate. Otherwise selects the family radio,
 *       pushes Power to max, and re-verifies. Throws if the pill cannot be
 *       brought to the target — callers must treat that as a hard
 *       "refuse to submit" gate.
 *
 *   ensureDeepResearch / isDeepResearchActive / isDeepResearchWorking
 *       Deep Research mode helpers (literature role only).
 *
 *   assertModeBeforeSend(page, { deepResearch }) -> void
 *       Final pre-send gate: DR chip present for DR submissions; pill on the
 *       Pro target and no DR chip otherwise. Throws if not.
 *
 *   PILL_SELECTOR, TARGET_TIER, BASE_MODEL_LABEL, EFFORT_LABEL, EFFORT_LABEL_DR
 *       Exported constants. BASE_MODEL_LABEL/EFFORT_LABEL feed the
 *       session-log JSON's `base_model` / `effort_mode` fields.
 */

export const PILL_SELECTOR = 'button.__composer-pill[aria-haspopup="menu"]';
const PICKER_SELECTOR = '[data-testid="composer-intelligence-picker-content"]';

export const TARGET_TIER = 'Pro';
const FAMILY_RADIO_LABEL = process.env.MPP_MODEL_FAMILY || 'Latest';
const MIN_MODEL_VERSION = Number(process.env.MPP_MIN_MODEL_VERSION || '6');

// Strings emitted into the session-log JSON (`base_model`, `effort_mode`).
// Informational for downstream consumers.
export const BASE_MODEL_LABEL = 'GPT-6';
export const EFFORT_LABEL = 'GPT-6 Pro';
// Heartbeat/log effort_mode value when the wrapper is told `--deep-research`.
export const EFFORT_LABEL_DR = 'Deep Research';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Split pill text into its family token and power tier.
 * "6 Pro" -> { family: "6", tier: "Pro" }; "6 Extra High" -> { "6", "Extra High" };
 * a bare "Pro" (2026-07 UI) -> { family: null, tier: "Pro" }.
 */
export function parsePill(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
  if (m) return { family: m[1], tier: m[2] };
  return { family: null, tier: t };
}

/** Gate: Pro tier on a model family at or above MIN_MODEL_VERSION. */
export function isTargetPill(text) {
  const { family, tier } = parsePill(text);
  if (tier !== TARGET_TIER) return false;
  const version = Number.parseFloat(family);
  return Number.isFinite(version) && version >= MIN_MODEL_VERSION;
}

/**
 * Read the composer pill text with retries, normalized to one line.
 *
 * The pill can lag several seconds behind navigation/domcontentloaded;
 * retry up to 5 times (~30s total) before giving up.
 */
export async function readPill(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.locator(PILL_SELECTOR).first().waitFor({ state: 'visible', timeout: 6000 });
    } catch { /* keep trying */ }
    const txt = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'unknown';
      return (el.innerText || el.textContent || '')
        .split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
    }, PILL_SELECTOR).catch(() => 'unknown');
    if (txt && txt !== 'unknown') return txt;
    await sleep(1500);
  }
  return 'unknown';
}

async function isMenuOpen(page) {
  return await page.evaluate((sel) =>
    document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', PILL_SELECTOR);
}

async function closeMenu(page) {
  if (await isMenuOpen(page)) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
  }
}

async function openMenu(page) {
  await closeMenu(page);
  await page.locator(PILL_SELECTOR).first().click();
  await page.locator(`${PICKER_SELECTOR}, [role="menuitemradio"]`).first()
    .waitFor({ state: 'visible', timeout: 5000 });
  await sleep(300);
}

/** Snapshot of the open picker. Caller must have opened it. */
async function snapshotOpenPicker(page) {
  return await page.evaluate(() => {
    const slider = document.querySelector('[role="slider"]');
    const now = slider ? Number(slider.getAttribute('aria-valuenow')) : null;
    const max = slider ? Number(slider.getAttribute('aria-valuemax')) : null;
    let familyRadio = null;
    const radios = [];
    for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
      const label = (r.innerText || '').split('\n')[0].trim();
      radios.push(label);
      if (r.getAttribute('aria-checked') === 'true') familyRadio = label;
    }
    return { powerNow: now, powerMax: max, familyRadio, radios };
  });
}

/**
 * Open the picker read-only, report its state, close it. Best-effort:
 * fields are null if the picker cannot be opened.
 */
export async function readPickerState(page) {
  const pill = await readPill(page);
  let snap = { powerNow: null, powerMax: null, familyRadio: null, radios: [] };
  try {
    await openMenu(page);
    snap = await snapshotOpenPicker(page);
  } catch { /* leave nulls */ } finally {
    await closeMenu(page).catch(() => {});
  }
  const { family, tier } = parsePill(pill);
  return { pill, family, tier, ...snap };
}

/**
 * Click the configured family radio unless it is already checked.
 *
 * The picker has two panels: a simple view (header "6 Pro ›" + the Power
 * slider) and an advanced view holding the family radios. The radios stay
 * in the DOM while hidden behind the simple view, so clicking them directly
 * fails ("subtree intercepts pointer events"); the "Select model" header
 * slides the advanced view in first. Picking a radio slides back to the
 * simple view with the menu still open.
 */
async function selectFamily(page) {
  const idx = await page.evaluate((label) => {
    const rows = [...document.querySelectorAll('[role="menuitemradio"]')];
    return rows.findIndex((r) => (r.innerText || '').split('\n')[0].trim() === label);
  }, FAMILY_RADIO_LABEL);
  if (idx < 0) {
    const { radios } = await snapshotOpenPicker(page);
    throw new Error(`No model-family radio "${FAMILY_RADIO_LABEL}" in picker (saw ${JSON.stringify(radios)}).`);
  }
  const radio = page.locator('[role="menuitemradio"]').nth(idx);
  if ((await radio.getAttribute('aria-checked')) === 'true') return;

  const advancedActive = async () => page.evaluate(() =>
    document.querySelector('[data-testid="composer-model-picker-slider-advanced-view"]')
      ?.getAttribute('data-active') === 'true');
  if (!(await advancedActive())) {
    await page.locator('[role="menuitem"][aria-label="Select model"]').first().click();
    await sleep(700);
  }
  await radio.click({ timeout: 8000 });
  await sleep(700);
  if ((await radio.getAttribute('aria-checked').catch(() => null)) !== 'true' && await isMenuOpen(page)) {
    throw new Error(`Clicked family radio "${FAMILY_RADIO_LABEL}" but it did not become checked.`);
  }
  // Selecting a radio may close the menu; reopen so Power can be set.
  if (!(await isMenuOpen(page))) await openMenu(page);
}

/** Push the Power slider to its top step (Pro) via the menuitem's arrow keys. */
async function maxOutPower(page) {
  const power = page.locator('[role="menuitem"][aria-label="Power"]').first();
  if ((await power.count()) === 0) throw new Error('Power slider not found in picker.');
  await power.focus();
  for (let i = 0; i < 8; i++) {
    const { powerNow, powerMax } = await snapshotOpenPicker(page);
    if (powerNow != null && powerMax != null && powerNow >= powerMax) return;
    await page.keyboard.press('ArrowRight');
    await sleep(250);
  }
  const { powerNow, powerMax } = await snapshotOpenPicker(page);
  if (!(powerNow != null && powerMax != null && powerNow >= powerMax)) {
    throw new Error(`Power slider stuck at ${powerNow}/${powerMax} after ArrowRight presses.`);
  }
}

/**
 * Deep Research mode — DOM re-verified live 2026-06-26 on chatgpt.com.
 * (2026-09-21: the "+" menu still lists "Deep research | Get a detailed
 * report" among bare-div rows; the chip/removal behaviour below is
 * unchanged unless noted.)
 *
 * ## How ChatGPT exposes DR
 *
 *   - DR is toggled from the composer "+" button menu (aria-label "Add files
 *     and more"). The menu rows are bare `<div>`s inside a `.popover` —
 *     there is NO `[role="menuitemradio"]`. Find the row by its text
 *     "Deep research" and click it with a REAL Playwright click (a raw JS
 *     `.click()` on the bare div does not reliably fire React's handler).
 *
 *   - When DR is active, the active tool renders as an inline accent-coloured
 *     CHIP at the start of the ProseMirror composer:
 *     `<span class="...text-token-text-accent...">Deep research</span>`.
 *     `isDeepResearchActive` detects that chip (with a legacy fallback to the
 *     old `aria-label="Deep research, click to remove"` button).
 *
 *   - The composer pill STAYS on the power label while DR is active, so the
 *     pill cannot distinguish DR from plain Pro; `ensureExtendedPro` must
 *     explicitly disable DR (via the chip detection) before trusting its
 *     pill fast-path.
 *
 *   - The "+" button itself does NOT respond to JS `.click()` — it needs
 *     a real input event (Playwright's `locator.click()` is fine).
 *
 * ## DR semantics differ from Pro
 *
 *   - Submissions take 5–30 min. DR shows its own research-phase UI with no
 *     stop button; see isDeepResearchWorking.
 *   - DR cannot be combined with an explicit Power level — they're mutually
 *     exclusive modes on the composer.
 */

const DR_MENUITEM_TEXT_PATTERN = /^\s*Deep research\s*$/i;

/**
 * Is Deep Research currently active on the composer?
 *
 * Looks for the inline accent chip reading "Deep research" inside the
 * ProseMirror editor (legacy fallback: the removable chip button).
 */
export async function isDeepResearchActive(page) {
  return await page.evaluate(() => {
    const editor = document.querySelector(
      '[role="textbox"].ProseMirror, .ProseMirror[contenteditable="true"], #prompt-textarea'
    );
    if (editor) {
      const chip = [...editor.querySelectorAll('span, a, button')].some((el) =>
        /^\s*Deep research\s*$/i.test(el.textContent || '') &&
        /text-token-text-accent/.test((el.className || '').toString())
      );
      if (chip) return true;
    }
    return [...document.querySelectorAll('button')].some((b) => {
      const al = (b.getAttribute('aria-label') || '').toLowerCase();
      return al.includes('deep research') && al.includes('click to remove');
    });
  });
}

/**
 * Is a Deep Research job still in flight (research phase, no answer yet)?
 *
 * DR's research phase shows a plan/activity UI but NO stop button, so
 * isGenerating (composer.mjs) reads false the entire time it works — verified
 * live 2026-05-27. The reliable discriminator is the assistant-role message
 * node: the plan UI is not one, whereas the final DR report is. So "still
 * working" = DR active AND no assistant-role node has any text yet.
 */
export async function isDeepResearchWorking(page) {
  if (!(await isDeepResearchActive(page))) return false;
  const hasAssistantText = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    if (nodes.length === 0) return false;
    return (nodes[nodes.length - 1].innerText || '').trim().length > 0;
  });
  return !hasAssistantText;
}

/**
 * Turn Deep Research off. No-op if DR isn't currently active.
 * Internal helper — callers must re-verify via isDeepResearchActive.
 *
 * 2026-07 UI (verified live 2026-07-13): the DR chip is a ProseMirror atom
 * node at the start of the composer; clicking it or re-clicking the menu row
 * does nothing. The only working removal is keyboard deletion inside the
 * editor. Safe in the submit flow because mode enforcement always runs
 * BEFORE the prompt is filled; any pre-existing composer text is captured
 * and re-typed as a belt-and-braces safety. Key chords are platform-aware
 * (macOS has no Control+Home / Control+a select-all in text fields).
 */
async function disableDeepResearch(page) {
  if (!(await isDeepResearchActive(page))) return;

  const legacyClicked = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => {
      const al = (b.getAttribute('aria-label') || '').toLowerCase();
      return al.includes('deep research') && al.includes('click to remove');
    });
    if (!chip) return false;
    chip.click();
    return true;
  });
  if (legacyClicked) {
    await sleep(500);
    if (!(await isDeepResearchActive(page))) return;
  }

  const editor = page.locator(
    '[role="textbox"].ProseMirror, .ProseMirror[contenteditable="true"], #prompt-textarea'
  ).first();
  if ((await editor.count()) === 0) return;

  const preText = await page.evaluate(() => {
    const ed = document.querySelector(
      '[role="textbox"].ProseMirror, .ProseMirror[contenteditable="true"], #prompt-textarea'
    );
    if (!ed) return '';
    const clone = ed.cloneNode(true);
    for (const el of clone.querySelectorAll('span')) {
      if (/text-token-text-accent/.test((el.className || '').toString())) el.remove();
    }
    return (clone.innerText || '').trim();
  });

  await editor.click();

  // Targeted: cursor to start (chip is the first node), forward-delete it.
  const docStart = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
  await page.keyboard.press(docStart).catch(() => {});
  await page.keyboard.press('Delete').catch(() => {});
  await sleep(500);
  if (!(await isDeepResearchActive(page))) return;

  // Fallback: select-all + backspace (nukes the composer), then restore text.
  await page.keyboard.press('ControlOrMeta+a').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await sleep(500);
  if (preText && !(await isDeepResearchActive(page))) {
    await page.keyboard.insertText(preText).catch(() => {});
  }
}

/**
 * Idempotent: switch the composer into Deep Research mode.
 *
 * Flow: if not already active, open the composer "+" menu via Playwright
 * (real click — JS click does not work on this button), click the
 * "Deep research" row, verify the chip appears, succeed.
 * Throws if the "+" button is missing, the row is missing, or the
 * chip never appears.
 */
export async function ensureDeepResearch(page) {
  if (await isDeepResearchActive(page)) return;

  const addBtn = page.getByRole('button', { name: 'Add files and more', exact: true }).first();
  if ((await addBtn.count()) === 0) {
    throw new Error('Composer "+" button ("Add files and more") not found — cannot open DR menu.');
  }
  await addBtn.click();

  const drRow = page.getByText(DR_MENUITEM_TEXT_PATTERN).first();
  try {
    await drRow.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('Composer "+" menu did not open within 6s after click (no "Deep research" row).');
  }

  try {
    await drRow.click({ timeout: 3000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('"Deep research" option found but could not be clicked in composer "+" menu.');
  }
  await sleep(800);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isDeepResearchActive(page)) return;
    await sleep(400);
  }
  throw new Error('Deep Research mode toggle failed — composer chip did not appear after click.');
}

/**
 * Idempotent: ensure the composer is on the Pro target (pill "6 Pro").
 *
 * Fast path: pill already passes isTargetPill → return. Otherwise open the
 * picker, select the family radio, push Power to max, close, and re-verify
 * via the pill. Throws if the final pill state is not the target — the
 * caller MUST refuse to submit on throw, since silently proceeding would
 * use a weaker model.
 */
export async function ensureExtendedPro(page) {
  // DR keeps the power label on the pill — the chip is the only
  // discriminator. Turn DR off first, and treat failure as fatal.
  if (await isDeepResearchActive(page)) {
    await disableDeepResearch(page);
    if (await isDeepResearchActive(page)) {
      throw new Error(
        'Deep Research is active on the composer and could not be turned off. ' +
        'Refusing to proceed (the prompt would submit as a DR job, not Pro). ' +
        'Remove the "Deep research" chip manually and retry.'
      );
    }
  }

  let pillText = await readPill(page);
  if (isTargetPill(pillText)) return;

  try {
    await openMenu(page);
    await selectFamily(page);
    await maxOutPower(page);
  } catch (e) {
    await closeMenu(page).catch(() => {});
    throw new Error(`Failed to set the Pro target (was "${pillText}"): ${e.message}`);
  }
  await closeMenu(page);

  // Authoritative recheck via pill — this is the gate.
  pillText = await readPill(page);
  if (!isTargetPill(pillText)) {
    throw new Error(
      `Composer pill is "${pillText}" after fix attempt, not the Pro target ` +
      `(tier "${TARGET_TIER}" on model family >= ${MIN_MODEL_VERSION}). ` +
      `Refusing to proceed (would silently use a weaker model). ` +
      `Set "${FAMILY_RADIO_LABEL}" + Power "Pro" manually in the composer and retry.`
    );
  }
}

export const ensureProTarget = ensureExtendedPro;

/**
 * Last gate before clicking Send, after attachments and prompt text are in
 * place. Filling the composer can silently undo mode selection (select-all +
 * replace deletes the inline Deep research chip), so the mode chosen at the
 * start of the submit flow must be re-verified here. Throws — the caller must
 * not send — when the composer is not in the requested mode.
 */
export async function assertModeBeforeSend(page, { deepResearch = false } = {}) {
  const drActive = await isDeepResearchActive(page);
  if (deepResearch) {
    if (!drActive) {
      throw new Error('Deep research chip is not in the composer right before send; ' +
        'refusing to submit (the prompt would run as a plain Pro chat).');
    }
    return;
  }
  if (drActive) {
    throw new Error('Deep research is active right before send; refusing to submit a Pro role as a DR job.');
  }
  const pill = await readPill(page);
  if (!isTargetPill(pill)) {
    throw new Error(`Composer pill reads "${pill}" right before send, not the Pro target; refusing to submit.`);
  }
}
