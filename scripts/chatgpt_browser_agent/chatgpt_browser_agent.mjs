#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const TARGET_BASE_MODEL_BUTTON_LABEL = "5.4 Pro";
const TARGET_BASE_MODEL_MENU_LABEL = "Pro 5.4";
const TARGET_EFFORT_LABEL = "Extended Pro";

function usage() {
  return `Usage:
  chatgpt_browser_agent.mjs prepare --project-url URL [options]
  chatgpt_browser_agent.mjs submit --project-url URL --request-file PATH --response-file PATH [options]

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
  if ((currentLabel || "").includes(TARGET_BASE_MODEL_BUTTON_LABEL)) {
    return;
  }

  await modelButton.click();
  await page.getByRole("menuitem", { name: TARGET_BASE_MODEL_MENU_LABEL, exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(`current model is ${TARGET_BASE_MODEL_BUTTON_LABEL.replace(".", "\\.")}`, "i") })
    .first()
    .waitFor({ state: "visible", timeout: 10000 });
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

async function sourceExists(page, sourceName) {
  return (await page.getByText(sourceName, { exact: true }).count()) > 0;
}

async function addSource(page, filePath) {
  const resolved = path.resolve(filePath);
  const baseName = path.basename(resolved);
  if (await sourceExists(page, baseName)) {
    return;
  }

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Choose File" }).first().click(),
  ]);
  await chooser.setFiles(resolved);
  await page.getByText(baseName, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
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
  await page.waitForTimeout(1000);
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

function buildAttachmentPrompt(requestFile) {
  const fileName = path.basename(requestFile);
  return [
    `Read the attached file \`${fileName}\` and answer that request directly.`,
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
      const heading = article.querySelector("h3,h4,h5,h6")?.innerText?.trim() || "";
      if (!heading.startsWith("ChatGPT said")) {
        continue;
      }

      const clone = article.cloneNode(true);
      clone.querySelectorAll("button").forEach((button) => button.remove());
      const raw = (clone.innerText || "").trim().replace(/^ChatGPT said:\s*/i, "").trim();
      if (!raw || /^Thought for\b/i.test(raw)) {
        continue;
      }
      assistantTexts.push(raw);
    }

    return assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1] : "";
  });
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

async function extractAssistantResponse(page) {
  const previousClipboard = readClipboardText();

  try {
    const copied = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-testid="copy-turn-action-button"]')];
      const button = buttons.at(-1);
      if (!button) {
        return false;
      }
      button.click();
      return true;
    });

    if (copied) {
      await page.waitForTimeout(1200);
      const copiedText = readClipboardText();
      if (copiedText && copiedText.trim() && !copiedText.includes("[TRUNCATED]")) {
        return copiedText.trim();
      }
    }
  } finally {
    restoreClipboardText(previousClipboard);
  }

  const fallback = await latestAssistantText(page);
  return fallback.trim();
}

async function isLikelyGenerating(page) {
  return await page.evaluate(() => {
    return [...document.querySelectorAll("button")].some((button) => {
      const label = `${button.getAttribute("aria-label") || ""} ${(button.innerText || "").trim()}`.toLowerCase();
      return label.includes("stop") || label.includes("pause");
    });
  });
}

async function waitForStableAssistantReply(page, pollSeconds, maxWaitSeconds, onPoll = null) {
  const deadline = Date.now() + maxWaitSeconds * 1000;
  let lastText = "";
  let stableCycles = 0;

  while (Date.now() < deadline) {
    const currentText = await latestAssistantText(page);
    const generating = await isLikelyGenerating(page);

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
        stableCycles,
        deadlineAt: new Date(deadline).toISOString(),
      });
    }

    if (lastText && stableCycles >= 2) {
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

  if (args.addSources.length > 0 || args.removeSources.length > 0) {
    await openSourcesTab(page);
    for (const sourceName of args.removeSources) {
      await removeSource(page, sourceName);
    }
    for (const sourcePath of args.addSources) {
      await addSource(page, sourcePath);
    }
  }
}

async function runSubmit(page, args) {
  if (!args.requestFile || !args.responseFile) {
    throw new Error("submit requires --request-file and --response-file.");
  }

  const requestText = await fs.readFile(args.requestFile, "utf8");
  const submissionPrompt = buildAttachmentPrompt(args.requestFile);
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
  await attachFileToComposer(page, args.requestFile);
  await submitPrompt(page, submissionPrompt);
  await writeHeartbeat("submitted", { chat_url: page.url() });

  await waitForStableAssistantReply(page, args.pollSeconds, args.maxWaitSeconds, async (state) => {
    await writeHeartbeat("waiting_reply", {
      chat_url: state.chatUrl,
      generating: state.generating,
      stable_cycles: state.stableCycles,
      latest_response_chars: state.lastTextLength,
      deadline_at: state.deadlineAt,
    });
  });
  const responseText = await extractAssistantResponse(page);
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

  if (!["prepare", "submit"].includes(args.command)) {
    throw new Error(`Unknown command '${args.command}'. Use prepare or submit.`);
  }
  if (!args.projectUrl) {
    throw new Error("Missing --project-url (or MPP_CHATGPT_PROJECT_URL).");
  }

  const runtime = await openBrowser(args);
  const page = runtime.context.pages()[0] || await runtime.context.newPage();

  try {
    if (args.command === "prepare") {
      await runPrepare(page, args);
    } else {
      await runSubmit(page, args);
    }
  } finally {
    await runtime.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
