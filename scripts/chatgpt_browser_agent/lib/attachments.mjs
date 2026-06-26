/**
 * lib/attachments.mjs — per-prompt composer file attachments.
 *
 * Composer attachments are short-lived: they live inside a single
 * submission and are visible in the chat thread as an attached file
 * on the user's turn. They are NOT durable project sources (those
 * live in the Sources tab — see lib/sources.mjs).
 *
 * Typical flow for an external_agent-style submission:
 *
 *   clearComposerAttachments(page);          // drop any draft attachments
 *   await attachFile(page, requestFile);     // primary packet
 *   for (const path of supportingFiles) {
 *     await attachFile(page, path);          // optional extras
 *   }
 *   // then fillComposer + clickSend from lib/composer.mjs
 *
 * ## Public API
 *
 *   attachFile(page, filePath) -> void
 *       Click "Add files and more" → "Add photos & files" menuitem,
 *       set the chosen file via the file chooser, wait for the
 *       filename chip to appear in the composer (30s timeout).
 *
 *   clearComposerAttachments(page) -> void
 *       Click every "Remove file" button in the composer to drop all
 *       draft attachments. Safe to call on an empty composer (no-op).
 */

import path from 'node:path';

export async function attachFile(page, filePath) {
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved);

  const chipVisible = async (timeout) => {
    try {
      await page.getByText(baseName, { exact: true }).first().waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  };

  // 1) Hidden file-input fast path. The "Add photos & files" menuitem just forwards a
  //    click to a hidden <input type="file"> in the composer; driving that input
  //    directly with setInputFiles is far more robust than the menu→filechooser event,
  //    which breaks whenever ChatGPT renames the button/menuitem (it did — the menu
  //    click stopped emitting a filechooser, hanging the 30s wait). Mirror the
  //    hidden-input approach already proven in lib/sources.mjs.
  const nonImage = page.locator('input[type="file"]:not([accept="image/*"])');
  const fileInput = (await nonImage.count()) > 0 ? nonImage.first() : page.locator('input[type="file"]').first();
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(resolved).catch(() => {});
    if (await chipVisible(15000)) {
      await page.waitForTimeout(1000);
      return;
    }
  }

  // 2) Fallback: explicit menu → filechooser (older/explicit UI), bounded so a broken
  //    menu fails fast instead of hanging the full default timeout.
  const addButton = page.getByRole('button', { name: 'Add files and more', exact: true }).first();
  await addButton.click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('menuitem', { name: /Add photos & files/i }).click(),
  ]);
  await chooser.setFiles(resolved);

  await page.getByText(baseName, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1000);
}

export async function clearComposerAttachments(page) {
  const removeButtons = page.getByRole('button', { name: 'Remove file', exact: true });
  const count = await removeButtons.count();
  for (let index = 0; index < count; index += 1) {
    await removeButtons.first().click();
    await page.waitForTimeout(200);
  }
}
