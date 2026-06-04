/**
 * lib/sources.mjs - ChatGPT project Sources tab management.
 *
 * Durable project sources are stable project-level context. They are
 * different from per-prompt composer attachments, which live only on one
 * submitted chat turn. Keep all Sources-tab DOM handling here so wrappers,
 * diagnostics, and refresh flows do not drift apart.
 *
 * Public API:
 *   openSourcesTab(page) -> void
 *   openChatsTab(page) -> void
 *   listSources(page) -> string[]
 *   sourceExists(page, name) -> boolean
 *   addSource(page, filePath, opts?) -> void
 *   removeSource(page, name) -> void
 */

import path from 'node:path';

const TAB_TIMEOUT_MS = 15000;
const TAB_POLL_MS = 500;
const SOURCE_UPLOAD_TIMEOUT_MS = 30000;
const SOURCE_REMOVE_TIMEOUT_MS = 10000;

async function locatorCount(locator) {
  return await locator.count().catch(() => 0);
}

async function clickIfPresent(page, locator, { timeout = 4000, settleMs = 500 } = {}) {
  const count = await locatorCount(locator);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;
    await candidate.click({ timeout });
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    return true;
  }
  return false;
}

async function openProjectSection(page, name, { required = false } = {}) {
  const deadline = Date.now() + TAB_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    const candidates = [
      page.getByRole('tab', { name, exact: true }),
      page.getByRole('button', { name, exact: true }),
      page.getByText(name, { exact: true }),
    ];

    for (const candidate of candidates) {
      try {
        if (await clickIfPresent(page, candidate, { settleMs: name === 'Sources' ? 700 : 500 })) return true;
      } catch (error) {
        lastError = error;
      }
    }

    await page.waitForTimeout(TAB_POLL_MS);
  }

  if (required) {
    const detail = lastError ? ` Last error: ${lastError.message}` : '';
    throw new Error(`Could not find the ${name} tab on the project page.${detail}`);
  }
  return false;
}

export async function openSourcesTab(page) {
  await openProjectSection(page, 'Sources', { required: true });
}

export async function openChatsTab(page) {
  await openProjectSection(page, 'Chats', { required: false });
}

/**
 * List visible source file names, sorted.
 *
 * ChatGPT's source-list DOM has had at least two shapes:
 *   1. Body text rows: "<filename>" followed by "File / PDF / ... <date>".
 *   2. A row with a "Source actions" button near the filename.
 *
 * Run both scrapes and return the best non-empty result.
 */
export async function listSources(page) {
  return await page.evaluate(() => {
    const ignoredLines = new Set([
      'Source actions',
      'Remove',
      'File',
      'Files',
      'Source',
      'Sources',
      'Add sources',
      'Uploads',
    ]);
    const filenamePattern = /\.[A-Za-z0-9]{1,8}$/;
    const metadataPattern = /^(File|Files|PDF|Image|Text|Document|Spreadsheet|Presentation|Code|CSV|TXT|Markdown)\b/i;
    const datedMetadataPattern = /\s[\u00b7\u2022-]\s/;

    const isIgnored = (line) => {
      return (
        ignoredLines.has(line) ||
        /^uploaded\b/i.test(line) ||
        /^added\b/i.test(line)
      );
    };

    const pickLikelyName = (lines) => {
      for (const line of lines) {
        if (!isIgnored(line) && filenamePattern.test(line)) return line;
      }
      for (const line of lines) {
        if (!isIgnored(line)) return line;
      }
      return '';
    };

    const sorted = (items) => [...items].sort((left, right) => left.localeCompare(right));
    const bodyLines = (document.body.innerText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const bodyNames = new Set();
    for (let index = 0; index < bodyLines.length - 1; index += 1) {
      const name = bodyLines[index];
      const meta = bodyLines[index + 1];
      const looksLikeSourceMeta =
        metadataPattern.test(meta) ||
        (datedMetadataPattern.test(meta) && filenamePattern.test(name));
      if (looksLikeSourceMeta && !isIgnored(name)) {
        bodyNames.add(name);
      }
    }
    if (bodyNames.size > 0) return sorted(bodyNames);

    const buttonNames = new Set();
    const actionButtons = [...document.querySelectorAll('button[aria-label="Source actions"]')];
    for (const button of actionButtons) {
      let current = button.parentElement;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const candidateLines = (current.innerText || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const candidate = pickLikelyName(candidateLines);
        if (candidate) {
          buttonNames.add(candidate);
          break;
        }
        current = current.parentElement;
      }
    }
    return sorted(buttonNames);
  });
}

export async function sourceExists(page, sourceName) {
  if ((await locatorCount(page.getByText(sourceName, { exact: true }))) > 0) return true;
  if ((await locatorCount(page.getByText(sourceName, { exact: false }))) > 0) return true;
  const names = await listSources(page);
  return names.includes(sourceName);
}

async function setSourceFileViaDialog(page, resolvedPath) {
  const addSources = page.getByText('Add sources', { exact: true }).first();
  if ((await locatorCount(addSources)) === 0) return false;

  await addSources.click();
  await page.waitForTimeout(1200);

  const uploadButton = page.getByRole('button', { name: 'Upload' }).first();
  if ((await locatorCount(uploadButton)) === 0) return false;

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 7000 }),
    uploadButton.click(),
  ]);
  await chooser.setFiles(resolvedPath);
  return true;
}

async function setSourceFileViaInput(page, resolvedPath) {
  const input = page.locator('input#upload-files, input[type="file"]:not([accept="image/*"])').first();
  if ((await locatorCount(input)) === 0) return false;
  await input.setInputFiles(resolvedPath);
  return true;
}

async function handleDuplicateDialog(page, baseName, onDuplicate) {
  const legacyDuplicateModal = page.getByTestId('modal-file-already-exists');
  if ((await locatorCount(legacyDuplicateModal)) > 0) {
    if (onDuplicate !== 'replace') {
      throw new Error(`Project source '${baseName}' already exists and was not removed before refresh.`);
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const replaceButton = page.getByRole('button', { name: /Replace/i }).first();
      if ((await locatorCount(replaceButton)) === 0 || !(await replaceButton.isVisible().catch(() => false))) break;
      await replaceButton.click();
      await page.waitForTimeout(800);
    }
    return true;
  }

  const duplicateText = page.getByText(/already uploaded this file/i).first();
  if ((await locatorCount(duplicateText)) === 0) return false;
  await page.getByRole('button', { name: 'OK' }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await openSourcesTab(page).catch(() => {});
  if (await sourceExists(page, baseName)) return true;
  if (onDuplicate === 'throw') {
    throw new Error(
      `Project source '${baseName}' was rejected as duplicate content, but no source row is visible.`
    );
  }
  return true;
}

/**
 * Upload a file as a durable project source.
 *
 * Current ChatGPT project UI commits uploads through:
 *   Add sources -> Upload -> filechooser
 *
 * Older UI variants exposed a hidden file input directly. Keep that as a
 * fallback, but prefer the filechooser path because the hidden input can
 * select a file without committing it to the project source list.
 *
 * opts.onDuplicate defaults to "throw". Pass "replace" for legacy duplicate
 * modals that support a Replace button.
 */
export async function addSource(page, filePath, opts = {}) {
  const { onDuplicate = 'throw' } = opts;
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved);

  await openSourcesTab(page).catch(() => {});
  if (await sourceExists(page, baseName)) return;

  let committedVia = null;
  try {
    if (await setSourceFileViaDialog(page, resolved)) {
      committedVia = 'filechooser';
    }
  } catch {
    // Fall through to the older hidden-input path.
  }

  if (!committedVia) {
    if (!(await setSourceFileViaInput(page, resolved))) {
      throw new Error('Could not find the source Upload control on the Sources tab.');
    }
    committedVia = 'hidden-input';
  }

  await page.waitForTimeout(1500);
  await handleDuplicateDialog(page, baseName, onDuplicate);

  const deadline = Date.now() + SOURCE_UPLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await openSourcesTab(page).catch(() => {});
    if (await sourceExists(page, baseName)) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for project source '${baseName}' to appear (committed via ${committedVia}).`);
}

async function clickSourceActionsByName(page, sourceName) {
  const clicked = await page.evaluate((name) => {
    const nodes = [...document.querySelectorAll('*')];
    for (const node of nodes) {
      if ((node.textContent || '').trim() !== name) continue;
      let current = node;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const button = current.querySelector('button[aria-label="Source actions"]');
        if (button) {
          button.click();
          return true;
        }
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
 * No-op if the source is already absent. Some accounts show a confirmation
 * dialog after the menuitem click; accept Remove/Confirm/Delete when visible.
 */
export async function removeSource(page, sourceName) {
  if (!(await sourceExists(page, sourceName))) return;

  await clickSourceActionsByName(page, sourceName);
  await page.waitForTimeout(400);
  try {
    await page.getByRole('menuitem', { name: 'Remove', exact: true }).click({ timeout: 8000 });
  } catch (error) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error(`No Remove menuitem found for '${sourceName}': ${error.message}`);
  }
  await page.waitForTimeout(500);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const confirmButton = page.getByRole('button', { name: /^(Remove|Confirm|Delete)$/ }).first();
    if ((await locatorCount(confirmButton)) > 0 && await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      await page.waitForTimeout(800);
    } else {
      break;
    }
  }

  const deadline = Date.now() + SOURCE_REMOVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await sourceExists(page, sourceName))) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for project source '${sourceName}' to be removed.`);
}
