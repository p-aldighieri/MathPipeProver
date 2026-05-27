/**
 * lib/browser.mjs — Browser entry points (CDP attach OR persistent launch).
 *
 * Two distinct ways to get a Playwright context against ChatGPT:
 *
 *   - CDP attach: connect to an already-running Chrome that the user
 *     launched with --remote-debugging-port=N. Used by every cdp_*
 *     diagnostic script and by the wrapper when `--cdp-url` is given.
 *     Does NOT close the underlying browser on disconnect.
 *
 *   - Persistent launch: Playwright spawns its own Chrome with a
 *     persistent profile dir, inheriting cookies/auth. Used by the
 *     wrapper for `mpp run`-style hands-off flows. DOES close the
 *     browser on disconnect.
 *
 * The dispatcher `openBrowser({ cdpUrl, profileDir, ... })` picks the
 * right path based on whether `cdpUrl` is set, and returns a uniform
 * `{ context, close }` shape so callers don't branch on entry mode.
 *
 * ## Public API
 *
 *   attachCDP({ port?, url? }) -> { browser, context, close }
 *       CDP-only attach. Either `port` (defaults to localhost:port) or
 *       a full `url` (e.g. `http://localhost:9222`). Throws if no
 *       existing context is available.
 *
 *   launchPersistent({ profileDir, browserChannel?, headless? }) -> { context, close }
 *       Spawns Chrome with the given persistent profile dir. Falls back
 *       to default channel if the named channel (e.g. "chrome") is not
 *       installed.
 *
 *   openBrowser({ cdpUrl, profileDir, browserChannel?, headless? }) -> { context, close }
 *       Dispatcher. Uses attachCDP if `cdpUrl` is truthy, else
 *       launchPersistent.
 */

import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

/**
 * Attach to an already-running Chrome via CDP.
 *
 * Pass either `port` (resolved as http://localhost:port) or a full `url`.
 * Returns the connected browser, its first context, and a close() that
 * disconnects (does NOT shut down the underlying Chrome — the user's
 * existing session keeps running).
 */
export async function attachCDP({ port, url } = {}) {
  const cdpUrl = url || `http://localhost:${port ?? 9222}`;
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error(`No browser context was available at ${cdpUrl}.`);
  }
  return {
    browser,
    context,
    close: async () => { await browser.close(); },
  };
}

/**
 * Launch Playwright-managed Chrome with a persistent profile.
 *
 * Tries the requested channel first; on failure (e.g. channel not
 * installed on this machine), retries with Playwright's bundled
 * Chromium. Returns context + close() that shuts the browser down.
 */
export async function launchPersistent({ profileDir, browserChannel = 'chrome', headless = false }) {
  const dir = expandHome(profileDir);
  const options = {
    headless,
    viewport: { width: 1440, height: 1000 },
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(dir, { ...options, channel: browserChannel });
  } catch (error) {
    if (browserChannel !== 'chrome') throw error;
    context = await chromium.launchPersistentContext(dir, options);
  }
  return {
    context,
    close: async () => { await context.close(); },
  };
}

/**
 * High-level dispatcher: CDP attach if `cdpUrl` is set, else persistent.
 *
 * Returns a uniform `{ context, close }` shape regardless of entry mode,
 * so callers don't need to branch. The CDP path's `browser` reference
 * is not exposed here — callers that need it should use `attachCDP`
 * directly.
 */
export async function openBrowser({ cdpUrl, profileDir, browserChannel, headless }) {
  if (cdpUrl) {
    const { context, close } = await attachCDP({ url: cdpUrl });
    return { context, close };
  }
  return await launchPersistent({ profileDir, browserChannel, headless });
}
