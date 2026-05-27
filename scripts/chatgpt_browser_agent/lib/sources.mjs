/**
 * lib/sources.mjs — ChatGPT project Sources tab management.
 *
 * Durable project sources (the "Sources" tab on a project page) are the
 * stable context shared across every chat in the project. They differ
 * from per-prompt composer attachments (see lib/attachments.mjs) in
 * lifecycle: durable sources persist until explicitly removed; composer
 * attachments live only inside the single submission.
 *
 * This module is the single source of truth for durable-source DOM:
 * opening the Sources/Chats tabs, listing what's there, adding, removing,
 * and the confirmation-dialog handling. Every script that touched the
 * Sources tab used to carry its own (subtly different) copy of this
 * logic; consolidating fixes two real divergences:
 *
 *   1. wrapper's removeSource lacked confirmation-dialog handling that
 *      cdp_remove_source_v2.mjs had — would silently fail if ChatGPT
 *      enabled the confirm-remove dialog. Lib adopts v2's behavior.
 *
 *   2. wrapper threw on duplicate upload; cdp_add_source.mjs clicked
 *      "Replace" in the duplicate modal. Lib exposes the choice via
 *      addSource(..., { onDuplicate: 'throw' | 'replace' }).
 *
 * ## Public API
 *
 *   openSourcesTab(page) -> void
 *   openChatsTab(page)   -> void
 *       Switch tabs. Sources throws if the tab is missing; Chats is
 *       silently a no-op if absent (some flows want best-effort).
 *
 *   listSources(page) -> string[]
 *       Visible source file names, sorted. Uses two heuristics: body-text
 *       "File" marker, then per-button "Source actions" parent scrape.
 *
 *   sourceExists(page, name) -> boolean
 *       Cheap-then-thorough probe (text match → list scrape).
 *
 *   addSource(page, filePath, opts?) -> void
 *       Upload via the hidden file input. opts.onDuplicate defaults to
 *       'throw' (matches wrapper); pass 'replace' for cdp_add_source
 *       semantics (click the Replace button if a duplicate modal appears).
 *
 *   removeSource(page, name) -> void
 *       Click "Source actions" → "Remove" → confirm dialog if present.
 *       No-op if the source isn't present.
 */

import path from 'node:path';

export async function openSourcesTab(page) {
  const sourcesTab = page.getByRole('tab', { name: 'Sources', exact: true });
  if ((await sourcesTab.count()) === 0) {
    throw new Error('Could not find the Sources tab on the project page.');
  }
  await sourcesTab.click();
  await page.waitForTimeout(500);
}

export async function openChatsTab(page) {
  const chatsTab = page.getByRole('tab', { name: 'Chats', exact: true });
  if ((await chatsTab.count()) > 0) {
    await chatsTab.click();
  }
}

/**
 * List visible source file names, sorted.
 *
 * Two-pass scrape: ChatGPT's source list DOM varies between UI
 * revisions, so both heuristics run; whichever yields names wins.
 *   Pass 1: body innerText scan, looking for the "File"/"Files" line
 *           that ChatGPT places under each source row.
 *   Pass 2: per-button climb from each "Source actions" button up to
 *           6 ancestors, picking the most filename-shaped line.
 */
export async function listSources(page) {
  return await page.evaluate(() => {
    const ignoredLines = new Set([
      'Source actions', 'Remove', 'File', 'Files',
      'Source', 'Sources', 'Add sources', 'Uploads',
    ]);
    const filenamePattern = /\.[A-Za-z0-9]{1,8}$/;
    const pickLikelyName = (lines) => {
      for (const line of lines) if (filenamePattern.test(line)) return line;
      for (const line of lines) {
        if (!ignoredLines.has(line) && !/^uploaded\b/i.test(line) && !/^added\b/i.test(line)) return line;
      }
      return '';
    };
    const bodyLines = (document.body.innerText || '')
      .split('\n').map((line) => line.trim()).filter(Boolean);

    const names = new Set();
    for (let i = 0; i < bodyLines.length - 1; i += 1) {
      if (bodyLines[i + 1].startsWith('File')) names.add(bodyLines[i]);
    }
    if (names.size > 0) return [...names].sort((a, b) => a.localeCompare(b));

    const actionButtons = [...document.querySelectorAll('button[aria-label="Source actions"]')];
    for (const button of actionButtons) {
      let current = button.parentElement;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const lines = (current.innerText || '')
          .split('\n').map((line) => line.trim()).filter(Boolean)
          .filter((line) => !ignoredLines.has(line));
        const candidate = pickLikelyName(lines);
        if (candidate) { names.add(candidate); break; }
        current = current.parentElement;
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  });
}

export async function sourceExists(page, sourceName) {
  if ((await page.getByText(sourceName, { exact: true }).count()) > 0) return true;
  if ((await page.getByText(sourceName, { exact: false }).count()) > 0) return true;
  const names = await listSources(page);
  return names.includes(sourceName);
}

/**
 * Upload a file as a durable project source.
 *
 * Strategy: locate the hidden `<input type="file">` (excluding the
 * image-only composer input) and call setInputFiles. This bypasses the
 * "Add sources" → "Upload" button cascade, which was UI-fragile.
 *
 * @param {object} opts
 * @param {'throw'|'replace'} [opts.onDuplicate='throw']
 *   'throw'   — raise Error when the duplicate-file modal appears
 *               (wrapper default; pairs with explicit refresh that
 *               removes first).
 *   'replace' — click the Replace button repeatedly to overwrite
 *               (cdp_add_source semantics).
 */
export async function addSource(page, filePath, opts = {}) {
  const { onDuplicate = 'throw' } = opts;
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved);
  if (await sourceExists(page, baseName)) return;

  const fileInputs = page.locator('input[type="file"]:not([accept="image/*"])');
  if ((await fileInputs.count()) === 0) {
    throw new Error('Could not find a project source file input on the Sources tab.');
  }

  const inputCount = await fileInputs.count();
  for (let index = 0; index < inputCount; index += 1) {
    await fileInputs.nth(index).setInputFiles(resolved);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await openSourcesTab(page).catch(() => {});
      if (await sourceExists(page, baseName)) return;
      const duplicateModal = page.getByTestId('modal-file-already-exists');
      if ((await duplicateModal.count()) > 0) {
        if (onDuplicate === 'replace') {
          // Up to 5 attempts to click Replace (ChatGPT sometimes re-shows the modal)
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const replaceBtn = page.getByRole('button', { name: /Replace/i }).first();
            if ((await replaceBtn.count()) > 0 && await replaceBtn.isVisible().catch(() => false)) {
              await replaceBtn.click();
              await page.waitForTimeout(800);
            } else break;
          }
          // Continue waiting for the source to appear
        } else {
          throw new Error(`Project source '${baseName}' already exists and was not removed before refresh.`);
        }
      }
      await page.waitForTimeout(250);
    }
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await openSourcesTab(page).catch(() => {});
    if (await sourceExists(page, baseName)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for project source '${baseName}' to appear.`);
}

/**
 * Click the "Source actions" (...) button next to the named source.
 * Internal helper.
 */
async function clickSourceActionsByName(page, sourceName) {
  const clicked = await page.evaluate((name) => {
    const nodes = [...document.querySelectorAll('*')];
    for (const node of nodes) {
      if ((node.textContent || '').trim() !== name) continue;
      let current = node;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const button = current.querySelector('button[aria-label="Source actions"]');
        if (button) { button.click(); return true; }
        current = current.parentElement;
      }
    }
    return false;
  }, sourceName);
  if (!clicked) throw new Error(`Could not locate source actions for '${sourceName}'.`);
}

/**
 * Remove a durable project source by visible name.
 *
 * Flow: actions menu → Remove menuitem → (optional) confirmation dialog.
 * The confirmation step handles a Remove/Confirm/Delete button that
 * ChatGPT shows in some account configurations — silently no-ops when
 * no dialog appears. Behavior is "remove if present; quiet success if
 * already absent". Throws on actual failure to remove.
 */
export async function removeSource(page, sourceName) {
  if (!(await sourceExists(page, sourceName))) return;

  await clickSourceActionsByName(page, sourceName);
  await page.waitForTimeout(400);
  try {
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click({ timeout: 8000 });
  } catch (e) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error(`No Remove menuitem found for '${sourceName}': ${e.message}`);
  }
  await page.waitForTimeout(500);

  // Optional confirmation dialog (varies by account config).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const confirmBtn = page.getByRole('button', { name: /^(Remove|Confirm|Delete)$/ }).first();
    if ((await confirmBtn.count()) > 0 && await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(800);
    } else break;
  }

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!(await sourceExists(page, sourceName))) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for project source '${sourceName}' to be removed.`);
}
