/**
 * lib/model_pill.mjs — Composer model-pill detection and Sol Pro enforcement
 * (GPT-5.6 Sol, Pro intelligence lane — formerly "Extended Pro").
 *
 * Single source of truth for everything related to reading and setting the
 * ChatGPT composer's model+effort state. Both `cdp_submit.mjs` (the thin
 * orchestrator-driven entry point) and `chatgpt_browser_agent.mjs` (the
 * prepare/submit/recover/inspect CLI) import from here. Do not duplicate this
 * logic in other scripts; if the ChatGPT DOM changes again, this is the only
 * file that needs to be updated.
 *
 * ## Background: the 2026-05-21 / 2026-05-25 DOM changes
 *
 * ChatGPT removed the `model-switcher-gpt-5-5-pro` and
 * `model-switcher-gpt-5-5-pro-thinking-effort` data-testids. The new composer
 * pill menu carries `[role="menuitemradio"]` rows for reasoning
 * ("Instant | 5s" / "Medium | 5–30s" / "High | 15–60s" / "Pro | 5+ min")
 * with no stable testid; matched by role + innerText prefix.
 *
 * On 2026-05-25 the picker collapsed the separate GPT-5.x submenu into a
 * single combined reasoning radio "Pro | • Extended"; the composer pill then
 * reads either "Extended Pro" or simply "Pro". When the pill already reads
 * one of those two labels the state is correct AND the (now-absent) GPT
 * submenu must NOT be probed — hovering it hangs for 30s. Accept and skip.
 *
 * On 2026-06-12 the picker became an "Intelligence" menu with levels
 * "Instant | Medium | High | Extra High | Pro Extended" plus a separate
 * "GPT-5.5 >" model submenu row at the bottom (do NOT probe the submenu).
 * The composer pill reads the current level text (e.g. "Extra High").
 *
 * ## Current target: GPT 5.6 Sol Pro (UI verified live 2026-07-13)
 *
 * ChatGPT's flagship is now **GPT-5.6 Sol** and "Extended Pro" no longer
 * exists. The Intelligence picker levels are
 * "Instant | Medium | High | Extra High | Pro" with a "GPT-5.6 Sol"
 * model submenu row at the bottom (do NOT probe/click the submenu row —
 * hovering the model submenu has historically hung for ~30s). The
 * "Instant" row carries a "5.5" badge (Instant runs the older model);
 * every other lane runs the selected GPT-5.6 Sol.
 *
 * The pipeline target ("Sol Pro") is the **Pro** level on GPT-5.6 Sol;
 * after selection the composer pill reads "Pro". Rows are still
 * [role="menuitemradio"]; matching stays label-prefix-based. Legacy
 * labels "Pro Extended"/"Extended Pro" are kept as accepted pill states
 * for back-compat with any A/B'd or stale UI.
 *
 * ## Public API
 *
 *   readPill(page) -> string
 *       Best-effort pill text reader with retries. Returns 'unknown' if the
 *       pill never resolves. Never throws.
 *
 *   ensureExtendedPro(page) -> void
 *       Idempotent enforcement of the Sol Pro target (function keeps its
 *       legacy name so callers don't churn). Returns silently if the pill
 *       already reads Pro (or a legacy Pro variant). Otherwise opens the
 *       menu, selects the Pro lane, and re-verifies. Throws if the pill
 *       cannot be brought to the target state — callers should treat this
 *       as a hard "refuse to submit" gate.
 *
 *   PILL_SELECTOR, EXTENDED_PRO_LABELS, BASE_MODEL_LABEL, EFFORT_LABEL
 *       Exported constants. BASE_MODEL_LABEL/EFFORT_LABEL feed the
 *       session-log JSON's `base_model` / `effort_mode` fields — change
 *       their string values only if you also coordinate downstream consumers.
 */

export const PILL_SELECTOR = 'button.__composer-pill[aria-haspopup="menu"]';
// Accepted pill states for the Sol Pro target. "Pro" is the current
// (2026-07) label; the other two are legacy labels kept for back-compat.
export const EXTENDED_PRO_LABELS = ['Pro', 'Pro Extended', 'Extended Pro'];

// These two constants are the strings emitted into the session-log JSON
// (`base_model`, `effort_mode` fields). Updated 2026-07-13 for the
// GPT-5.6 Sol UI; downstream consumers treat them as informational.
export const BASE_MODEL_LABEL = 'GPT-5.6 Sol';
export const EFFORT_LABEL = 'Sol Pro';
// Heartbeat/log effort_mode value when the wrapper is told `--deep-research`.
// Used by both cdp_submit.mjs and chatgpt_browser_agent.mjs.
export const EFFORT_LABEL_DR = 'Deep Research';

// Acceptable target rows in preference order. "Pro" is the 2026-07
// "Intelligence" UI's top lane (GPT-5.6 Sol era); "Pro Extended" was the
// 2026-06-12 label, kept as fallback.
const DESIRED_REASONING_LABELS = ['Pro', 'Pro Extended'];

// Expected base-model text on the picker's bottom model-submenu row.
// Checked read-only (never clicked/hovered). If the row text stops
// matching, ensureExtendedPro logs a loud warning; set
// MPP_STRICT_BASE_MODEL=1 to make the mismatch fatal.
const EXPECTED_MODEL_ROW = /5\.6|sol/i;

/**
 * Read the composer pill text with retries.
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
      return el ? (el.textContent || '').trim() : 'unknown';
    }, PILL_SELECTOR);
    if (txt && txt !== 'unknown') return txt;
    await new Promise(r => setTimeout(r, 1500));
  }
  return 'unknown';
}

function isPillOk(pillText) {
  return EXTENDED_PRO_LABELS.includes(pillText);
}

async function isMenuOpen(page) {
  return await page.evaluate((sel) =>
    document.querySelector(sel)?.getAttribute('aria-expanded') === 'true', PILL_SELECTOR);
}

async function closeMenu(page) {
  if (await isMenuOpen(page)) {
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise(r => setTimeout(r, 250));
  }
}

async function openMenu(page) {
  await closeMenu(page);
  await page.locator(PILL_SELECTOR).first().click();
  // wait for the reasoning radios to appear
  await page.locator('[role="menuitemradio"]').first()
    .waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Read the picker's current state: the checked reasoning radio label
 * (e.g. "Pro", "High") and the bottom model-submenu row text (e.g.
 * "GPT-5.6 Sol"). The model row is read from innerText only — NEVER
 * clicked or hovered (probing the submenu hangs ~30s). Best-effort;
 * fields are null if not found or the menu cannot be opened.
 */
async function readMenuState(page) {
  await openMenu(page);
  const state = await page.evaluate(() => {
    let reasoning = null;
    for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
      if (r.getAttribute('aria-checked') === 'true') {
        const t = (r.innerText || '').trim();
        // Text shape: "Pro\n5+ min" or "Pro | • Extended"; first segment is the label.
        reasoning = t.split(/[\n|]/)[0].trim();
        break;
      }
    }
    // The model submenu is the [role="menuitem"] row (radios are the
    // reasoning lanes). Current UI has exactly one, reading "GPT-5.6 Sol".
    let modelRow = null;
    for (const m of document.querySelectorAll('[role="menuitem"]')) {
      const t = (m.innerText || '').trim();
      if (/^GPT/i.test(t)) { modelRow = t.split(/\n/)[0].trim(); break; }
    }
    return { reasoning, modelRow };
  });
  await closeMenu(page);
  return state;
}

/**
 * Idempotent: ensure the composer pill reads Pro (Sol Pro target).
 *
 * Fast path: if `readPill` already returns Pro (or a legacy Pro variant),
 * return. Otherwise open the menu, click the Pro reasoning radio, close,
 * and re-verify via the pill. Throws if the final pill state is not OK —
 * the caller MUST refuse to submit on throw, since silently proceeding
 * would use a weaker model.
 */
/**
 * Deep Research mode — DOM re-verified live 2026-06-26 on chatgpt.com
 * (the 2026-05-26 UI it was originally written against has since drifted).
 *
 * ## How ChatGPT exposes DR (current UI, 2026-06)
 *
 *   - DR is toggled from the composer "+" button menu (the same button
 *     whose aria-label is "Add files and more"). The menu rows are now bare
 *     `<div>`s inside a `.popover` (grouped under role="group" sections) —
 *     there is NO `[role="menuitemradio"]` anymore. Find the row by its text
 *     "Deep research" and click it with a REAL Playwright click (a raw JS
 *     `.click()` on the bare div does not reliably fire React's handler).
 *
 *   - When DR is active, the active tool renders as an inline accent-coloured
 *     CHIP at the start of the ProseMirror composer:
 *     `<span class="...text-token-text-accent...">Deep research</span>` living
 *     inside `[role="textbox"].ProseMirror`. The old toolbar chip button with
 *     `aria-label="Deep research, click to remove"` is GONE. `isDeepResearchActive`
 *     detects the inline accent chip (with a legacy fallback to the old button).
 *     To turn DR off, re-click the "Deep research" row in the "+" menu (toggle).
 *
 *   - The composer pill STAYS on the intelligence-lane label while DR is
 *     active ("Pro Extended" in the 2026-06 UI; "Pro" in the 2026-07
 *     GPT-5.6 Sol UI). So the pill cannot distinguish DR from plain Sol
 *     Pro; `ensureExtendedPro` must still explicitly disable DR (via
 *     the inline-chip detection) before trusting its pill fast-path.
 *
 *   - The "+" button itself does NOT respond to JS `.click()` — it needs
 *     a real input event. Playwright's `locator.click()` dispatches the
 *     right events, so the lib code works in production; only ad-hoc JS
 *     `document.querySelector(...).click()` fails on the "+" button.
 *
 * ## DR semantics differ from Extended Pro
 *
 *   - Submissions take 5–30 min (vs Extended Pro's 8–20 min). The
 *     existing `wait_chat_done.mjs` `--max-mins 180` default is generous.
 *   - DR uses its own "thinking phase" UI ("Researching...", "Reading
 *     sources..."). The existing `isInterimAssistantText` filter catches
 *     these along with "Thinking", "Analyzing", etc.
 *   - DR cannot be combined with explicit Pro effort — they're
 *     mutually exclusive modes on the composer.
 */

const DR_MENUITEM_TEXT_PATTERN = /^\s*Deep research\s*$/i;

/**
 * Is Deep Research currently active on the composer?
 *
 * Looks for the toolbar chip whose aria-label contains both
 * "deep research" and "click to remove". This is ChatGPT's only
 * reliable DOM signal — the menuitemradio's aria-checked lies.
 */
export async function isDeepResearchActive(page) {
  return await page.evaluate(() => {
    // 2026-06 UI: an active composer tool (Deep research) renders as an inline
    // accent-coloured chip at the START of the ProseMirror composer, e.g.
    // <span class="...text-token-text-accent...">Deep research</span>. The old
    // aria-label="Deep research, click to remove" button no longer exists, and
    // the composer pill stays "Pro Extended" (it no longer drops to "Pro").
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
    // Legacy fallback: the old removable chip button.
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
 * live 2026-05-27. The copy button is NOT a usable signal either: the
 * research-plan turn carries its own copy button while nAssistant is still 0.
 * The reliable discriminator is the assistant-role message node: the plan UI
 * is not one (no [data-message-author-role="assistant"] text during research),
 * whereas the final DR report is. So "still working" = DR active AND no
 * assistant-role node has any text yet. poll.mjs ORs this into its generating
 * signal so it doesn't declare the (empty) research phase "stable & done".
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
 * 2026-07 UI (verified live 2026-07-13): the DR chip is a ProseMirror
 * atom node at the start of the composer. Clicking the chip, its svg, or
 * re-clicking the "Deep research" row in the "+" menu all do NOTHING.
 * The only working removal is keyboard deletion inside the editor.
 * Safe in the submit flow because mode enforcement always runs BEFORE
 * the prompt is filled; any pre-existing composer text is captured and
 * re-typed as a belt-and-braces safety.
 */
async function disableDeepResearch(page) {
  if (!(await isDeepResearchActive(page))) return;

  // Legacy fast path: the old removable-chip button, if this UI still has it.
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
    await new Promise((r) => setTimeout(r, 500));
    if (!(await isDeepResearchActive(page))) return;
  }

  const editor = page.locator(
    '[role="textbox"].ProseMirror, .ProseMirror[contenteditable="true"], #prompt-textarea'
  ).first();
  if ((await editor.count()) === 0) return;

  // Capture any non-chip composer text so we can restore it if we have to
  // nuke the whole composer. (Normally empty: enforcement precedes fill.)
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
  await page.keyboard.press('Control+Home').catch(() => {});
  await page.keyboard.press('Delete').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  if (!(await isDeepResearchActive(page))) return;

  // Fallback: select-all + backspace (nukes the composer), then restore text.
  await page.keyboard.press('Control+a').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  if (preText && !(await isDeepResearchActive(page))) {
    await page.keyboard.insertText(preText).catch(() => {});
  }
}

/**
 * Idempotent: switch the composer into Deep Research mode.
 *
 * Flow: if not already active, open the composer "+" menu via Playwright
 * (real click — JS click does not work on this button), click the
 * "Deep research" menuitemradio, verify the chip appears, succeed.
 * Throws if the "+" button is missing, the menuitem is missing, or the
 * chip never appears.
 */
export async function ensureDeepResearch(page) {
  if (await isDeepResearchActive(page)) return;

  const addBtn = page.getByRole('button', { name: 'Add files and more', exact: true }).first();
  if ((await addBtn.count()) === 0) {
    throw new Error('Composer "+" button ("Add files and more") not found — cannot open DR menu.');
  }
  await addBtn.click();

  // Wait for the menu to populate. As of the 2026-06 composer UI the "+" menu
  // rows are bare <div>s inside a `.popover` (role="group" sections) — there is
  // NO [role="menuitemradio"] anymore, so the old role-based wait timed out even
  // though the menu was open. Wait for the "Deep research" row text instead.
  const drRow = page.getByText(DR_MENUITEM_TEXT_PATTERN).first();
  try {
    await drRow.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('Composer "+" menu did not open within 6s after click (no "Deep research" row).');
  }

  // Click the row via a real Playwright click so React's delegated handler fires
  // (a raw JS .click() on the bare <div> is unreliable). The anchored regex keeps
  // us off the ancestor group div whose text concatenates several row labels.
  try {
    await drRow.click({ timeout: 3000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('"Deep research" option found but could not be clicked in composer "+" menu.');
  }
  await new Promise((r) => setTimeout(r, 800));

  // Verify by polling the chip up to ~2s.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await isDeepResearchActive(page)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Deep Research mode toggle failed — composer chip did not appear after click.');
}

export async function ensureExtendedPro(page) {
  // DR also shows pill "Pro" — chip is the only discriminator. If DR is
  // active, toggle it off before the pill fast-path; otherwise we'd
  // silently submit a DR job when the caller wanted Sol Pro. This must be
  // a hard gate: on the 2026-07 UI several plausible removal paths are
  // silent no-ops, so re-verify and throw rather than trust the attempt.
  if (await isDeepResearchActive(page)) {
    await disableDeepResearch(page);
    if (await isDeepResearchActive(page)) {
      throw new Error(
        'Deep Research is active on the composer and could not be turned off. ' +
        'Refusing to proceed (the prompt would submit as a DR job, not Sol Pro). ' +
        'Remove the "Deep research" chip manually and retry.'
      );
    }
  }

  let pillText = await readPill(page);
  if (isPillOk(pillText)) return;

  // Read current selection to confirm what needs changing, and check the
  // base-model row (read-only) while the menu is open.
  const menuState = await readMenuState(page).catch(() => ({ reasoning: null, modelRow: null }));
  const currentReasoning = menuState.reasoning;
  if (menuState.modelRow && !EXPECTED_MODEL_ROW.test(menuState.modelRow)) {
    const msg = `Model picker's base-model row reads "${menuState.modelRow}", expected GPT-5.6 Sol. ` +
      `ChatGPT may have changed/downgraded the default model — verify manually.`;
    if (process.env.MPP_STRICT_BASE_MODEL === '1') throw new Error(msg);
    console.error(`WARNING: ${msg}`);
  }

  if (!DESIRED_REASONING_LABELS.includes(currentReasoning)) {
    try {
      await openMenu(page);
      const clicked = await page.evaluate((targets) => {
        // menuitem fallback covers UI drift; exact label match keeps the
        // "GPT-5.5 >" model-submenu row from ever being clicked.
        const rows = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
        for (const target of targets) {
          for (const r of rows) {
            const label = (r.innerText || '').split(/[\n|]/)[0].trim();
            if (label === target) { r.click(); return target; }
          }
        }
        return null;
      }, DESIRED_REASONING_LABELS);
      if (!clicked) throw new Error(`No reasoning radio matching ${JSON.stringify(DESIRED_REASONING_LABELS)} found in pill menu`);
      await new Promise(r => setTimeout(r, 600));
      await closeMenu(page);
    } catch (e) {
      await closeMenu(page).catch(() => {});
      throw new Error(`Failed to set reasoning to ${DESIRED_REASONING_LABELS[0]}: ${e.message}`);
    }
  }

  // Authoritative recheck via pill — this is the gate.
  pillText = await readPill(page);
  if (!isPillOk(pillText)) {
    throw new Error(
      `Composer pill is "${pillText}" after fix attempt, not "Pro" (Sol Pro target). ` +
      `Refusing to proceed (would silently use a weaker model). ` +
      `Set the Pro intelligence lane manually in the composer and retry.`
    );
  }
}
