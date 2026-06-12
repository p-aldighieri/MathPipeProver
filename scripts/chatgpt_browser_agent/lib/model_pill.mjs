/**
 * lib/model_pill.mjs — Composer model-pill detection and Extended Pro enforcement.
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
 * The Extended Pro target in this UI is the "Pro Extended" level; after
 * selection the pill reads "Pro Extended". Rows are still
 * [role="menuitemradio"]; matching stays label-prefix-based.
 *
 * ## Public API
 *
 *   readPill(page) -> string
 *       Best-effort pill text reader with retries. Returns 'unknown' if the
 *       pill never resolves. Never throws.
 *
 *   ensureExtendedPro(page) -> void
 *       Idempotent enforcement. Returns silently if the pill already reads
 *       Extended Pro/Pro. Otherwise opens the menu, selects Pro reasoning,
 *       and re-verifies. Throws if the pill cannot be brought to the target
 *       state — callers should treat this as a hard "refuse to submit" gate.
 *
 *   PILL_SELECTOR, EXTENDED_PRO_LABELS, BASE_MODEL_LABEL, EFFORT_LABEL
 *       Exported constants. BASE_MODEL_LABEL/EFFORT_LABEL feed the
 *       session-log JSON's `base_model` / `effort_mode` fields — change
 *       their string values only if you also coordinate downstream consumers.
 */

export const PILL_SELECTOR = 'button.__composer-pill[aria-haspopup="menu"]';
export const EXTENDED_PRO_LABELS = ['Extended Pro', 'Pro', 'Pro Extended'];

// These two constants are the strings emitted into the session-log JSON
// (`base_model`, `effort_mode` fields). Stability matters more than precision:
// keep "Pro" + "Extended Pro" even if the UI label drifts, unless you are
// coordinating a schema change.
export const BASE_MODEL_LABEL = 'Pro';
export const EFFORT_LABEL = 'Extended Pro';
// Heartbeat/log effort_mode value when the wrapper is told `--deep-research`.
// Used by both cdp_submit.mjs and chatgpt_browser_agent.mjs.
export const EFFORT_LABEL_DR = 'Deep Research';

// Acceptable target rows in preference order. "Pro Extended" is the
// 2026-06-12 "Intelligence" UI's top lane; "Pro" is the pre-06-12 label.
const DESIRED_REASONING_LABELS = ['Pro Extended', 'Pro'];

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
 * Read the currently-checked reasoning radio label (e.g. "Pro", "High").
 * Best-effort; returns null if no menuitemradio is checked or the menu
 * cannot be opened.
 */
async function readCurrentReasoning(page) {
  await openMenu(page);
  const reasoning = await page.evaluate(() => {
    for (const r of document.querySelectorAll('[role="menuitemradio"]')) {
      if (r.getAttribute('aria-checked') === 'true') {
        const t = (r.innerText || '').trim();
        // Text shape: "Pro\n5+ min" or "Pro | • Extended"; first segment is the label.
        return t.split(/[\n|]/)[0].trim();
      }
    }
    return null;
  });
  await closeMenu(page);
  return reasoning;
}

/**
 * Idempotent: ensure the composer pill reads Extended Pro / Pro.
 *
 * Fast path: if `readPill` already returns Extended Pro/Pro, return.
 * Otherwise open the menu, click the Pro reasoning radio, close, and
 * re-verify via the pill. Throws if the final pill state is not OK —
 * the caller MUST refuse to submit on throw, since silently proceeding
 * would use a weaker model.
 */
/**
 * Deep Research mode — DOM verified live 2026-05-26 on chatgpt.com.
 *
 * ## How ChatGPT exposes DR (current UI)
 *
 *   - DR is toggled from the composer "+" button menu (the same button
 *     whose aria-label is "Add files and more"). Inside the popup is a
 *     `[role="menuitemradio"]` whose innerText is exactly "Deep research".
 *     Clicking it turns DR on.
 *
 *   - When DR is active, the composer toolbar shows a chip button with
 *     `aria-label="Deep research, click to remove"` and innerText
 *     "Deep research". Clicking that chip toggles DR off.
 *
 *   - Note: the menuitemradio's `aria-checked` attribute is unreliable —
 *     ChatGPT renders the visual check + highlight but leaves
 *     `aria-checked="false"`. Do NOT use aria-checked for state detection.
 *     The chip is the authoritative signal.
 *
 *   - The composer pill reads "Pro" (NOT "Extended Pro") while DR is
 *     active. The pill alone cannot distinguish DR mode from plain Pro
 *     reasoning; this is why `ensureExtendedPro` must explicitly toggle
 *     DR off if active (chip detection) before its existing fast-path
 *     check kicks in.
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
 * Click the "Deep research, click to remove" chip to turn DR off.
 * No-op if DR isn't currently active. Internal helper.
 */
async function disableDeepResearch(page) {
  const clicked = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('button')].find((b) => {
      const al = (b.getAttribute('aria-label') || '').toLowerCase();
      return al.includes('deep research') && al.includes('click to remove');
    });
    if (!chip) return false;
    chip.click();
    return true;
  });
  if (clicked) await new Promise((r) => setTimeout(r, 500));
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

  // Wait for the menu to populate (any menuitemradio appears).
  try {
    await page.locator('[role="menuitemradio"]').first().waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('Composer "+" menu did not open within 5s after click.');
  }

  const clicked = await page.evaluate((pattern) => {
    const re = new RegExp(pattern.source, pattern.flags);
    const dr = [...document.querySelectorAll('[role="menuitemradio"]')].find((el) =>
      re.test((el.innerText || '').trim())
    );
    if (!dr) return false;
    dr.click();
    return true;
  }, { source: DR_MENUITEM_TEXT_PATTERN.source, flags: DR_MENUITEM_TEXT_PATTERN.flags });

  if (!clicked) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('"Deep research" option not found in composer "+" menu.');
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
  // silently submit a DR job when the caller wanted Extended Pro.
  if (await isDeepResearchActive(page)) {
    await disableDeepResearch(page);
  }

  let pillText = await readPill(page);
  if (isPillOk(pillText)) return;

  // Read current selection to confirm what needs changing.
  const currentReasoning = await readCurrentReasoning(page).catch(() => null);

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
      `Composer pill is "${pillText}" after fix attempt, not "Extended Pro"/"Pro". ` +
      `Refusing to proceed (would silently use a weaker model). ` +
      `Set Extended Pro manually in the composer and retry.`
    );
  }
}
