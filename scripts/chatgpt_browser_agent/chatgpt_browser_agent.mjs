#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const TARGET_BASE_MODEL_BUTTON_LABEL = "5.4 Pro";
const TARGET_BASE_MODEL_MENU_LABELS = [
  "Pro 5.4",
  "5.4 Pro",
  "ChatGPT 5.4 Pro",
  "Pro",
];
const TARGET_EFFORT_LABEL = "Extended Pro";

function usage() {
  return `Usage:
  chatgpt_browser_agent.mjs prepare --project-url URL [options]
  chatgpt_browser_agent.mjs submit --project-url URL --request-file PATH --response-file PATH [options]
  chatgpt_browser_agent.mjs recover --chat-url URL --response-file PATH [options]
  chatgpt_browser_agent.mjs inspect --chat-url URL [options]

Options:
  --project-url URL            ChatGPT project URL.
  --cdp-url URL                Attach to an already-running Chrome/Chromium via CDP.
  --profile-dir PATH           Persistent browser profile dir.
  --browser-channel NAME       Browser channel, default: chrome.
  --headless                   Run headless.
  --wait-for-login-seconds N   Wait for manual login if needed, default: 300.
  --poll-seconds N             Poll interval for reply stability, default: 10.
  --max-wait-seconds N         Max wait for final reply, default: 5400.
  --add-source PATH            Add a durable project source. Repeatable.
  --remove-source NAME         Remove a durable project source by visible name. Repeatable.
  --request-file PATH          Request markdown file produced by external_agent.
  --response-file PATH         Response markdown file to write back for resume.
  --attach-file PATH           Extra chat attachment to upload with the request. Repeatable.
  --chat-url URL              Existing chat URL to reopen for recovery.
  --log-json PATH              Optional JSON session log path.
  --heartbeat-json PATH        Optional heartbeat JSON path.
  --help                       Show this help.

Environment:
  MPP_CHATGPT_PROJECT_URL      Default project URL if --project-url is omitted.
  MPP_CHATGPT_CDP_URL          Default CDP URL if --cdp-url is omitted.
  MPP_CHATGPT_PROFILE_DIR      Default profile dir if --profile-dir is omitted.
`;
}

function parseArgs(argv) {
  const args = {
    command: "",
    projectUrl: process.env.MPP_CHATGPT_PROJECT_URL || "",
    cdpUrl: process.env.MPP_CHATGPT_CDP_URL || "",
    profileDir: process.env.MPP_CHATGPT_PROFILE_DIR || "~/.mathpipeprover/chatgpt-profile",
    browserChannel: "chrome",
    headless: false,
    waitForLoginSeconds: 300,
    pollSeconds: 10,
    maxWaitSeconds: 5400,
    addSources: [],
    removeSources: [],
    requestFile: "",
    responseFile: "",
    attachFiles: [],
    chatUrl: "",
    logJson: "",
    heartbeatJson: "",
  };

  const rest = [...argv];
  if (rest.length === 0 || rest.includes("--help")) {
    return { help: true, args };
  }

  args.command = rest.shift();

  while (rest.length > 0) {
    const token = rest.shift();
    if (token === "--project-url") {
      args.projectUrl = rest.shift() || "";
    } else if (token === "--cdp-url") {
      args.cdpUrl = rest.shift() || "";
    } else if (token === "--profile-dir") {
      args.profileDir = rest.shift() || "";
    } else if (token === "--browser-channel") {
      args.browserChannel = rest.shift() || "chrome";
    } else if (token === "--headless") {
      args.headless = true;
    } else if (token === "--wait-for-login-seconds") {
      args.waitForLoginSeconds = Number(rest.shift() || "300");
    } else if (token === "--poll-seconds") {
      args.pollSeconds = Number(rest.shift() || "10");
    } else if (token === "--max-wait-seconds") {
      args.maxWaitSeconds = Number(rest.shift() || "5400");
    } else if (token === "--add-source") {
      args.addSources.push(rest.shift() || "");
    } else if (token === "--remove-source") {
      args.removeSources.push(rest.shift() || "");
    } else if (token === "--request-file") {
      args.requestFile = rest.shift() || "";
    } else if (token === "--response-file") {
      args.responseFile = rest.shift() || "";
    } else if (token === "--attach-file") {
      args.attachFiles.push(rest.shift() || "");
    } else if (token === "--chat-url") {
      args.chatUrl = rest.shift() || "";
    } else if (token === "--log-json") {
      args.logJson = rest.shift() || "";
    } else if (token === "--heartbeat-json") {
      args.heartbeatJson = rest.shift() || "";
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return { help: false, args };
}

function expandHome(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
}

async function getComposer(page) {
  const candidates = [
    page.locator('[contenteditable="true"][role="textbox"]').first(),
    page.getByRole("textbox").first(),
    page.locator('textarea[name="prompt-textarea"]').first(),
  ];

  for (const candidate of candidates) {
    if ((await candidate.count()) === 0) {
      continue;
    }
    try {
      await candidate.waitFor({ state: "visible", timeout: 1000 });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("Timed out waiting for the ChatGPT composer.");
}

async function ensureChatReady(page, waitForLoginSeconds) {
  const deadline = Date.now() + waitForLoginSeconds * 1000;
  let noticeShown = false;
  while (Date.now() < deadline) {
    try {
      await getComposer(page);
      return;
    } catch {
      // Fall through to login wait logic.
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!noticeShown && /log in|sign up|continue with/i.test(bodyText)) {
      console.error("ChatGPT login required in the persistent browser profile. Complete login in the opened browser window.");
      noticeShown = true;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for the ChatGPT composer. If this is the first run, log into chatgpt.com in the opened browser profile.");
}

async function launchPersistentBrowser(args) {
  const profileDir = expandHome(args.profileDir);
  const options = {
    headless: args.headless,
    viewport: { width: 1440, height: 1000 },
  };

  try {
    return await chromium.launchPersistentContext(profileDir, {
      ...options,
      channel: args.browserChannel,
    });
  } catch (error) {
    if (args.browserChannel !== "chrome") {
      throw error;
    }
    return await chromium.launchPersistentContext(profileDir, options);
  }
}

async function connectToExistingBrowser(args) {
  const browser = await chromium.connectOverCDP(args.cdpUrl);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error(`No browser context was available at ${args.cdpUrl}.`);
  }
  return {
    context,
    close: async () => {
      await browser.close();
    },
  };
}

async function openBrowser(args) {
  if (args.cdpUrl) {
    return await connectToExistingBrowser(args);
  }

  const context = await launchPersistentBrowser(args);
  return {
    context,
    close: async () => {
      await context.close();
    },
  };
}

async function openProject(page, projectUrl, waitForLoginSeconds) {
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await ensureChatReady(page, waitForLoginSeconds);
}

async function ensureBaseModel(page) {
  const modelButton = page.getByTestId("model-switcher-dropdown-button").first();
  await modelButton.waitFor({ state: "visible", timeout: 10000 });

  const currentLabel = await modelButton.getAttribute("aria-label");
  const currentText = ((await modelButton.innerText().catch(() => "")) || "").trim();
  const currentCombined = `${currentLabel || ""} ${currentText}`.toLowerCase();
  if (
    currentCombined.includes(TARGET_BASE_MODEL_BUTTON_LABEL.toLowerCase()) ||
    /\bpro\b/.test(currentText.toLowerCase())
  ) {
    return;
  }

  await modelButton.click();
  let clicked = false;
  for (const label of TARGET_BASE_MODEL_MENU_LABELS) {
    const exactItem = page.getByRole("menuitem", { name: label, exact: true });
    if ((await exactItem.count()) > 0) {
      await exactItem.first().click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    const fallbackItem = page.getByRole("menuitem", { name: /(?:chatgpt\s*)?5\.4\s*pro|pro\s*5\.4|\bpro\b/i }).first();
    await fallbackItem.waitFor({ state: "visible", timeout: 10000 });
    await fallbackItem.click();
  }
  await page.waitForTimeout(500);
}

async function ensureExtendedPro(page) {
  const extended = page.getByRole("button", { name: TARGET_EFFORT_LABEL, exact: true });
  if ((await extended.count()) > 0) {
    return;
  }

  const proButton = page.getByRole("button", { name: "Pro", exact: true });
  if ((await proButton.count()) === 0) {
    throw new Error("Could not find the composer Pro pill next to the plus button.");
  }

  await proButton.first().click();
  await page.getByRole("menuitemradio", { name: "Extended" }).click();
  await page.getByRole("button", { name: TARGET_EFFORT_LABEL, exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
}

async function openSourcesTab(page) {
  const sourcesTab = page.getByRole("tab", { name: "Sources", exact: true });
  if ((await sourcesTab.count()) === 0) {
    throw new Error("Could not find the Sources tab on the project page.");
  }
  await sourcesTab.click();
}

async function openChatsTab(page) {
  const chatsTab = page.getByRole("tab", { name: "Chats", exact: true });
  if ((await chatsTab.count()) > 0) {
    await chatsTab.click();
  }
}

async function listSources(page) {
  return await page.evaluate(() => {
    const bodyLines = (document.body.innerText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const names = new Set();
    for (let index = 0; index < bodyLines.length - 1; index += 1) {
      if (bodyLines[index + 1].startsWith("File")) {
        names.add(bodyLines[index]);
      }
    }

    if (names.size > 0) {
      return [...names].sort((left, right) => left.localeCompare(right));
    }

    const actionButtons = [...document.querySelectorAll('button[aria-label="Source actions"]')];

    for (const button of actionButtons) {
      let current = button.parentElement;
      for (let depth = 0; depth < 6 && current; depth += 1) {
        const lines = (current.innerText || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => line !== "Source actions" && line !== "Remove");
        if (lines.length > 0) {
          names.add(lines[0]);
          break;
        }
        current = current.parentElement;
      }
    }

    return [...names].sort((left, right) => left.localeCompare(right));
  });
}

async function sourceExists(page, sourceName) {
  return (await page.getByText(sourceName, { exact: true }).count()) > 0;
}

async function addSource(page, filePath) {
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved);
  if (await sourceExists(page, baseName)) {
    return;
  }

  const fileInputs = page.locator('input[type="file"]:not([accept="image/*"])');
  if ((await fileInputs.count()) === 0) {
    throw new Error("Could not find a project source file input on the Sources tab.");
  }

  const inputCount = await fileInputs.count();
  for (let index = 0; index < inputCount; index += 1) {
    await fileInputs.nth(index).setInputFiles(resolved);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await sourceExists(page, baseName)) {
        return;
      }
      const duplicateModal = page.getByTestId("modal-file-already-exists");
      if ((await duplicateModal.count()) > 0) {
        throw new Error(`Project source '${baseName}' already exists and was not removed before refresh.`);
      }
      await page.waitForTimeout(250);
    }
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await sourceExists(page, baseName)) {
      return;
    }
    const duplicateModal = page.getByTestId("modal-file-already-exists");
    if ((await duplicateModal.count()) > 0) {
      throw new Error(`Project source '${baseName}' already exists and was not removed before refresh.`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for project source '${baseName}' to appear.`);
}

async function attachFileToComposer(page, filePath) {
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved);

  const addButton = page.getByRole("button", { name: "Add files and more", exact: true }).first();
  await addButton.click();

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("menuitem", { name: /Add photos & files/i }).click(),
  ]);
  await chooser.setFiles(resolved);

  await page.getByText(baseName, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1000);
}

async function clearComposerAttachments(page) {
  const removeButtons = page.getByRole("button", { name: "Remove file", exact: true });
  const count = await removeButtons.count();
  for (let index = 0; index < count; index += 1) {
    await removeButtons.first().click();
    await page.waitForTimeout(200);
  }
}

async function clickSourceActionsByName(page, sourceName) {
  const clicked = await page.evaluate((name) => {
    const nodes = [...document.querySelectorAll("*")];
    for (const node of nodes) {
      if ((node.textContent || "").trim() !== name) {
        continue;
      }
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

  if (!clicked) {
    throw new Error(`Could not locate source actions for '${sourceName}'.`);
  }
}

async function removeSource(page, sourceName) {
  if (!(await sourceExists(page, sourceName))) {
    return;
  }

  await clickSourceActionsByName(page, sourceName);
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!(await sourceExists(page, sourceName))) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for project source '${sourceName}' to be removed.`);
}

async function submitPrompt(page, requestText) {
  await openChatsTab(page);
  const composer = await getComposer(page);
  await composer.fill(requestText);

  const currentUrl = page.url();
  const sendButton = page.getByRole("button", { name: "Send prompt", exact: true }).first();

  if ((await sendButton.count()) > 0) {
    await sendButton.click();
  } else {
    const submitted = await page.evaluate(() => {
      const form = document.querySelector('form[aria-label]');
      if (!form) {
        return false;
      }
      form.requestSubmit();
      return true;
    });

    if (!submitted) {
      await composer.press("Enter");
    }
  }

  try {
    await page.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15000 });
  } catch {
    // Some project-page submissions stay on the same URL briefly before the
    // conversation route appears. If needed, a later poll will still observe
    // the new assistant turn.
  }
}

function buildAttachmentPrompt(requestFile, attachFiles) {
  const fileName = path.basename(requestFile);
  const extraNames = attachFiles.map((item) => path.basename(item));
  const attachmentLine = extraNames.length > 0
    ? `The supporting files are attached separately: ${extraNames.map((name) => `\`${name}\``).join(", ")}.`
    : "There are no supporting attachments beyond the main request packet.";
  return [
    `Read the attached file \`${fileName}\` and answer that request directly.`,
    attachmentLine,
    "Follow the role instructions exactly.",
    "Use the durable project sources when relevant.",
    "Return only the substantive markdown answer for the role.",
  ].join("\n");
}

async function latestAssistantText(page) {
  return await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const assistantTexts = [];

    for (const article of articles) {
      const clone = article.cloneNode(true);
      clone.querySelectorAll("button").forEach((button) => button.remove());
      const raw = (clone.innerText || "").trim();
      if (!raw) {
        continue;
      }

      const hasAssistantPrefix = /^ChatGPT said:/i.test(raw);
      if (!hasAssistantPrefix) {
        continue;
      }

      const cleaned = raw.replace(/^ChatGPT said:\s*/i, "").trim();
      if (!cleaned || /^Thought for\b/i.test(cleaned)) {
        continue;
      }
      assistantTexts.push(cleaned);
    }

    if (assistantTexts.length > 0) {
      return assistantTexts[assistantTexts.length - 1];
    }

    const body = (document.body.innerText || "").trim();
    const marker = "ChatGPT said:";
    const start = body.lastIndexOf(marker);
    if (start === -1) {
      return "";
    }

    let tail = body.slice(start + marker.length).trim();
    for (const stopMarker of [
      "\n\nExtended Pro",
      "\n\nChatGPT can make mistakes.",
      "\n\nAdd files and more",
      "\n\nStart Voice",
    ]) {
      const stop = tail.indexOf(stopMarker);
      if (stop !== -1) {
        tail = tail.slice(0, stop).trim();
      }
    }
    return tail;
  });
}

async function assistantTurnHasCopyButton(page) {
  return await page.evaluate(() => {
    const articles = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
    const assistantArticle = [...articles].reverse().find((article) =>
      /^ChatGPT said:/i.test((article.innerText || "").trim())
    );
    if (!assistantArticle) {
      return [...document.querySelectorAll("button")].some((button) =>
        (button.getAttribute("aria-label") || "").toLowerCase().includes("copy response")
      );
    }
    return Boolean(assistantArticle.querySelector('[data-testid="copy-turn-action-button"]'));
  });
}

function isInterimAssistantText(text) {
  const normalized = (text || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.length > 400) {
    return false;
  }

  return (
    normalized.includes("reading documents") ||
    normalized.includes("searching the web") ||
    normalized.includes("thinking") ||
    normalized.includes("analyzing")
  );
}

function readClipboardText() {
  if (process.platform !== "darwin") {
    return null;
  }

  try {
    return execFileSync("pbpaste", { encoding: "utf8" });
  } catch {
    return null;
  }
}

function restoreClipboardText(text) {
  if (process.platform !== "darwin" || text == null) {
    return;
  }

  try {
    execFileSync("pbcopy", { input: text, encoding: "utf8" });
  } catch {
    // Best-effort only.
  }
}

async function extractAssistantResponse(page, fallbackOverride = "") {
  const fallbackText = (fallbackOverride || await latestAssistantText(page)).trim();
  const previousClipboard = readClipboardText();

  try {
    const copied = await page.evaluate(() => {
      const articles = [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
      const assistantArticle = [...articles].reverse().find((article) =>
        /^ChatGPT said:/i.test((article.innerText || "").trim())
      );
      if (!assistantArticle) {
        const pageButton = [...document.querySelectorAll("button")].find((button) =>
          (button.getAttribute("aria-label") || "").toLowerCase().includes("copy response")
        );
        if (!pageButton) {
          return false;
        }
        pageButton.click();
        return true;
      }
      const button = assistantArticle.querySelector('[data-testid="copy-turn-action-button"]');
      if (!button) {
        return false;
      }
      button.click();
      return true;
    });

    if (copied) {
      await page.waitForTimeout(1200);
      const copiedText = (readClipboardText() || "").trim();
      if (copiedText && !copiedText.includes("[TRUNCATED]")) {
        if (!fallbackText) {
          return copiedText;
        }
        // Reject obviously bad clipboard captures, such as a single URL or a much
        // shorter fragment than the full assistant turn still visible in the DOM.
        if (copiedText === fallbackText) {
          return copiedText;
        }
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

async function isLikelyGenerating(page) {
  return await page.evaluate(() => {
    return [...document.querySelectorAll("button")].some((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${(button.innerText || "").trim()}`.toLowerCase();
      return (
        label.includes("stop streaming") ||
        label.includes("stop generating") ||
        label.includes("stop response") ||
        label.includes("pause generating") ||
        label.includes("pause streaming")
      );
    });
  });
}

async function waitForStableAssistantReply(page, pollSeconds, maxWaitSeconds, onPoll = null) {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let lastText = "";
  let stableCycles = 0;
  let unchangedCycles = 0;

  while (Date.now() < deadline) {
    const currentText = await latestAssistantText(page);
    const generating = await isLikelyGenerating(page);
    const readyToCopy = await assistantTurnHasCopyButton(page);

    if (currentText && currentText === lastText) {
      unchangedCycles += 1;
    } else {
      unchangedCycles = 0;
    }

    if (currentText && currentText === lastText && !generating) {
      stableCycles += 1;
    } else {
      stableCycles = 0;
    }

    if (currentText) {
      lastText = currentText;
    }

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

    if (lastText && stableCycles >= 2 && readyToCopy && !isInterimAssistantText(lastText)) {
      return lastText;
    }

    // The ChatGPT UI can leave a stale stop button behind after the text has
    // already stabilized. If the assistant text stops changing for long enough,
    // trust the stable text rather than waiting forever on a false positive.
    if (lastText && unchangedCycles >= 4 && readyToCopy && !isInterimAssistantText(lastText)) {
      return lastText;
    }

    await page.waitForTimeout(pollSeconds * 1000);
  }

  throw new Error("Timed out waiting for a stable assistant reply.");
}

async function writeJsonLog(logPath, payload) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function runPrepare(page, args) {
  await openProject(page, args.projectUrl, args.waitForLoginSeconds);
  await ensureBaseModel(page);
  await ensureExtendedPro(page);
  await openSourcesTab(page);
  await page.waitForTimeout(1500);
  for (const sourceName of args.removeSources) {
    await removeSource(page, sourceName);
  }
  for (const sourcePath of args.addSources) {
    await addSource(page, sourcePath);
  }
  await page.waitForTimeout(1000);
  const sourceNames = await listSources(page);
  console.log(JSON.stringify({
    command: "prepare",
    project_url: args.projectUrl,
    base_model: TARGET_BASE_MODEL_BUTTON_LABEL,
    effort_mode: TARGET_EFFORT_LABEL,
    add_sources: args.addSources.map((item) => path.resolve(item)),
    remove_sources: args.removeSources,
    source_names: sourceNames,
    source_count: sourceNames.length,
    prepared_at: new Date().toISOString(),
  }));
}

async function runRecover(page, args) {
  if (!args.chatUrl || !args.responseFile) {
    throw new Error("recover requires --chat-url and --response-file.");
  }

  await page.goto(args.chatUrl, { waitUntil: "domcontentloaded" });
  await ensureChatReady(page, args.waitForLoginSeconds);
  await page.waitForTimeout(1500);
  const stableText = await waitForStableAssistantReply(page, args.pollSeconds, args.maxWaitSeconds).catch(async () => {
    return (await latestAssistantText(page)).trim();
  });
  const responseText = await extractAssistantResponse(page, stableText);
  if (!responseText.trim()) {
    throw new Error("Could not recover a non-empty assistant reply from the chat.");
  }

  await fs.mkdir(path.dirname(args.responseFile), { recursive: true });
  await fs.writeFile(args.responseFile, `${responseText.trim()}\n`, "utf8");

  const logPath = args.logJson || args.responseFile.replace(/\.md$/i, "_session.json");
  await writeJsonLog(logPath, {
    command: "recover",
    chat_url: args.chatUrl,
    response_file: path.resolve(args.responseFile),
    recovered_at: new Date().toISOString(),
    response_chars: responseText.length,
    response_text: responseText,
  });
}

async function runInspect(page, args) {
  if (!args.chatUrl) {
    throw new Error("inspect requires --chat-url.");
  }

  await page.goto(args.chatUrl, { waitUntil: "domcontentloaded" });
  await ensureChatReady(page, args.waitForLoginSeconds);
  await page.waitForTimeout(1000);

  const latestText = (await latestAssistantText(page)).trim();
  const generating = await isLikelyGenerating(page);
  const hash = crypto.createHash("sha256").update(latestText).digest("hex");

  console.log(JSON.stringify({
    command: "inspect",
    chat_url: page.url(),
    generating,
    response_chars: latestText.length,
    response_hash: hash,
    response_preview: latestText.slice(0, 240),
    inspected_at: new Date().toISOString(),
  }));
}

async function runSubmit(page, args) {
  if (!args.requestFile || !args.responseFile) {
    throw new Error("submit requires --request-file and --response-file.");
  }

  const requestText = await fs.readFile(args.requestFile, "utf8");
  const submissionPrompt = buildAttachmentPrompt(args.requestFile, args.attachFiles);
  const submittedAt = new Date().toISOString();
  const logPath = args.logJson || args.responseFile.replace(/\.md$/i, "_session.json");
  const heartbeatPath = args.heartbeatJson || args.responseFile.replace(/\.md$/i, "_heartbeat.json");

  const writeHeartbeat = async (status, extra = {}) => {
    await writeJsonLog(heartbeatPath, {
      command: "submit",
      status,
      project_url: args.projectUrl,
      request_file: path.resolve(args.requestFile),
      response_file: path.resolve(args.responseFile),
      heartbeat_at: new Date().toISOString(),
      submitted_at: submittedAt,
      poll_seconds: args.pollSeconds,
      max_wait_seconds: args.maxWaitSeconds,
      base_model: TARGET_BASE_MODEL_BUTTON_LABEL,
      effort_mode: TARGET_EFFORT_LABEL,
      ...extra,
    });
  };

  await writeHeartbeat("starting");

  try {
  await openProject(page, args.projectUrl, args.waitForLoginSeconds);
  await ensureBaseModel(page);
  await ensureExtendedPro(page);
  await clearComposerAttachments(page);
  await attachFileToComposer(page, args.requestFile);
  for (const attachmentPath of args.attachFiles) {
    await attachFileToComposer(page, attachmentPath);
  }
  await submitPrompt(page, submissionPrompt);
  await writeHeartbeat("submitted", { chat_url: page.url() });

  const stableText = await waitForStableAssistantReply(page, args.pollSeconds, args.maxWaitSeconds, async (state) => {
    await writeHeartbeat("waiting_reply", {
      chat_url: state.chatUrl,
      generating: state.generating,
      stable_cycles: state.stableCycles,
      latest_response_chars: state.lastTextLength,
      deadline_at: state.deadlineAt,
    });
  });
  const responseText = await extractAssistantResponse(page, stableText);
  const completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(args.responseFile), { recursive: true });
  await fs.writeFile(args.responseFile, `${responseText.trim()}\n`, "utf8");
  await writeHeartbeat("completed", {
    chat_url: page.url(),
    completed_at: completedAt,
    response_chars: responseText.length,
  });
  await writeJsonLog(logPath, {
    command: "submit",
    project_url: args.projectUrl,
    chat_url: page.url(),
    request_file: path.resolve(args.requestFile),
    response_file: path.resolve(args.responseFile),
    base_model: TARGET_BASE_MODEL_BUTTON_LABEL,
    effort_mode: TARGET_EFFORT_LABEL,
    submission_method: "file_attachment",
    attachment_files: args.attachFiles.map((item) => path.resolve(item)),
    submission_prompt: submissionPrompt,
    add_sources: args.addSources.map((item) => path.resolve(item)),
    remove_sources: args.removeSources,
    submitted_at: submittedAt,
    completed_at: completedAt,
    request_chars: requestText.length,
    response_chars: responseText.length,
    request_text: requestText,
    response_text: responseText,
  });
  } catch (error) {
    await writeHeartbeat("error", {
      chat_url: page.url(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function main() {
  const { help, args } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(usage());
    return;
  }

  if (!["prepare", "submit", "recover", "inspect"].includes(args.command)) {
    throw new Error(`Unknown command '${args.command}'. Use prepare, submit, recover, or inspect.`);
  }
  if (!args.projectUrl && !["recover", "inspect"].includes(args.command)) {
    throw new Error("Missing --project-url (or MPP_CHATGPT_PROJECT_URL).");
  }

  const runtime = await openBrowser(args);
  const page = runtime.context.pages()[0] || await runtime.context.newPage();

  try {
    if (args.command === "prepare") {
      await runPrepare(page, args);
    } else if (args.command === "submit") {
      await runSubmit(page, args);
    } else if (args.command === "recover") {
      await runRecover(page, args);
    } else {
      await runInspect(page, args);
    }
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
