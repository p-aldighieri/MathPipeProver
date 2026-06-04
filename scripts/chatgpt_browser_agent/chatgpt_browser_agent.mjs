#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { ensureExtendedPro, ensureDeepResearch, BASE_MODEL_LABEL, EFFORT_LABEL, EFFORT_LABEL_DR } from "./lib/model_pill.mjs";
import {
  fillComposer, clickSend, isGenerating,
  clearComposerText, clearStoredComposerDrafts, composerTextLength,
} from "./lib/composer.mjs";
import { openBrowser } from "./lib/browser.mjs";
import { ensureChatReady } from "./lib/auth.mjs";
import {
  openSourcesTab, openChatsTab, listSources, sourceExists,
  addSource, removeSource,
} from "./lib/sources.mjs";
import { attachFile, clearComposerAttachments } from "./lib/attachments.mjs";
import {
  latestAssistantText, assistantTurnHasCopyButton, isInterimAssistantText,
  extractAssistantResponse, waitForStableAssistantReply,
} from "./lib/poll.mjs";

// Wrapper keeps the legacy local name `attachFileToComposer` for callsite readability.
const attachFileToComposer = attachFile;

// DOM primitives — pill, composer, send, generating-state — live in lib/.
// Single source of truth shared with cdp_submit.mjs and the diagnostic
// helpers. Do NOT add new pill/composer helpers here; update the lib
// instead so every entry point gets the fix at once.

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
  --chat-url-file PATH         Optional file to write the submitted chat URL.
  --log-json PATH              Optional JSON session log path.
  --page new|reuse             Submit in a fresh tab or reuse the first tab, default: new.
  --clear-draft safe|storage|off
                               Draft cleanup before submit, default: safe.
                               safe clears visible text and attachments.
                               storage also removes ChatGPT draft storage keys
                               and reloads before model selection.
  --return-after-submit        Submit and write chat URL/log, then return without
                               waiting for the assistant response.
  --deep-research              Submit via ChatGPT Deep Research mode instead of
                               Extended Pro. Used by the literature role. DR
                               jobs run 5-30 min (Extended Pro: 8-20 min).
                               Applies to 'submit' only; ignored by other
                               subcommands. NOTE: DR DOM selector is a stub
                               pending live-inspect wiring.
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
    chatUrlFile: "",
    logJson: "",
    pageMode: "new",
    clearDraft: "safe",
    returnAfterSubmit: false,
    deepResearch: false,
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
    } else if (token === "--chat-url-file") {
      args.chatUrlFile = rest.shift() || "";
    } else if (token === "--log-json") {
      args.logJson = rest.shift() || "";
    } else if (token === "--page") {
      args.pageMode = rest.shift() || "new";
      if (!["new", "reuse"].includes(args.pageMode)) {
        throw new Error("--page must be 'new' or 'reuse'.");
      }
    } else if (token === "--clear-draft") {
      args.clearDraft = rest.shift() || "safe";
      if (!["safe", "storage", "off"].includes(args.clearDraft)) {
        throw new Error("--clear-draft must be 'safe', 'storage', or 'off'.");
      }
    } else if (token === "--return-after-submit") {
      args.returnAfterSubmit = true;
    } else if (token === "--deep-research") {
      args.deepResearch = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return { help: false, args };
}

// Login readiness + account-chooser handling lives in lib/auth.mjs.
// Browser entry (CDP attach OR persistent launch) lives in lib/browser.mjs.
// The lib's openBrowser takes named params; adapt at the callsite below.

async function openProject(page, projectUrl, waitForLoginSeconds) {
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await ensureChatReady(page, waitForLoginSeconds);
}

async function reloadProject(page, projectUrl, waitForLoginSeconds) {
  await page.goto(projectUrl, { waitUntil: "domcontentloaded" });
  await ensureChatReady(page, waitForLoginSeconds);
}

// Durable Sources tab management lives in lib/sources.mjs.
// verifySources is kept here because it composes wrapper-specific
// resettle logic (ensureChatReady + ensureExtendedPro after reload).

async function verifySources(page, expectedPresent, expectedAbsent, waitForLoginSeconds) {
  let lastNames = [];
  let lastMissing = [...expectedPresent];
  let lastLingering = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await ensureChatReady(page, waitForLoginSeconds);
      await ensureExtendedPro(page);
    }

    await openSourcesTab(page);
    await page.waitForTimeout(1000);

    const names = await listSources(page);
    const confirmed = new Set(names);
    for (const name of expectedPresent) {
      if (await sourceExists(page, name)) {
        confirmed.add(name);
      }
    }
    for (const name of expectedAbsent) {
      if (await sourceExists(page, name)) {
        confirmed.add(name);
      }
    }

    lastNames = [...confirmed].sort((left, right) => left.localeCompare(right));
    lastMissing = expectedPresent.filter((name) => !confirmed.has(name));
    lastLingering = expectedAbsent.filter((name) => confirmed.has(name));
    if (lastMissing.length === 0 && lastLingering.length === 0) {
      return {
        sourceNames: lastNames,
        missingSources: lastMissing,
        lingeringSources: lastLingering,
      };
    }
  }

  throw new Error(
    `Durable source verification failed. Missing: ${lastMissing.join(", ") || "(none)"}; lingering: ${lastLingering.join(", ") || "(none)"}; observed: ${lastNames.join(", ") || "(none)"}`
  );
}

// Per-prompt composer attachments live in lib/attachments.mjs.
// clickSourceActionsByName + removeSource (with confirmation dialog handling)
// live in lib/sources.mjs.

async function submitPrompt(page, requestText) {
  // Wrapper-specific orchestration: ensure Chats tab is active (sources flow
  // may have left us on the Sources tab), submit via lib primitives, then
  // wait for the conversation route to appear.
  await openChatsTab(page);
  const composer = await fillComposer(page, requestText, { verify: true });

  const currentUrl = page.url();
  await clickSend(page, composer);

  try {
    await page.waitForURL((url) => url.toString() !== currentUrl, { timeout: 15000 });
  } catch {
    // Some project-page submissions stay on the same URL briefly before the
    // conversation route appears. If needed, a later poll will still observe
    // the new assistant turn.
  }
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (/\/c\/[0-9a-f-]{8,}/i.test(page.url())) break;
    await page.waitForTimeout(2000);
  }
  return page.url();
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

// Assistant-text reading, stability polling, and clipboard extraction
// live in lib/poll.mjs. Wrapper kept its old `waitForStableAssistantReply`
// signature (positional pollSeconds, maxWaitSeconds, onPoll) — provide a
// thin adapter so existing callers don't change.
const _waitStable = (page, pollSeconds, maxWaitSeconds, onPoll = null) =>
  waitForStableAssistantReply(page, { pollSeconds, maxWaitSeconds, onPoll });

async function writeJsonLog(logPath, payload) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeTextFileIfSet(filePath, text) {
  if (!filePath) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${text}\n`, "utf8");
}

async function prepareComposerForSubmit(page, args) {
  let removedDraftKeys = [];
  let clearedTextLength = null;

  if (args.clearDraft === "storage") {
    removedDraftKeys = await clearStoredComposerDrafts(page);
    if (removedDraftKeys.length > 0) {
      await reloadProject(page, args.projectUrl, args.waitForLoginSeconds);
    }
  }

  if (args.clearDraft !== "off") {
    await clearComposerAttachments(page);
    await clearComposerText(page);
    clearedTextLength = await composerTextLength(page);
    if (clearedTextLength > 2) {
      throw new Error(`Composer still contains ${clearedTextLength} characters after draft cleanup.`);
    }
  }

  return { removedDraftKeys, clearedTextLength };
}

async function runPrepare(page, args) {
  await openProject(page, args.projectUrl, args.waitForLoginSeconds);
  await ensureExtendedPro(page);
  await openSourcesTab(page);
  await page.waitForTimeout(1500);
  for (const sourceName of args.removeSources) {
    await removeSource(page, sourceName);
  }
  for (const sourcePath of args.addSources) {
    await addSource(page, sourcePath);
  }
  const expectedPresent = args.addSources.map((item) => path.basename(path.resolve(item)));
  const verification = await verifySources(page, expectedPresent, args.removeSources, args.waitForLoginSeconds);
  console.log(JSON.stringify({
    command: "prepare",
    project_url: args.projectUrl,
    base_model: BASE_MODEL_LABEL,
    effort_mode: EFFORT_LABEL,
    add_sources: args.addSources.map((item) => path.resolve(item)),
    remove_sources: args.removeSources,
    source_names: verification.sourceNames,
    source_count: verification.sourceNames.length,
    confirmed_sources: verification.sourceNames,
    missing_sources: verification.missingSources,
    lingering_sources: verification.lingeringSources,
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
  const stableText = await _waitStable(page, args.pollSeconds, args.maxWaitSeconds).catch(async () => {
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
  const generating = await isGenerating(page);
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
  const effortLabel = args.deepResearch ? EFFORT_LABEL_DR : EFFORT_LABEL;

  await openProject(page, args.projectUrl, args.waitForLoginSeconds);
  const draftCleanup = await prepareComposerForSubmit(page, args);
  if (args.deepResearch) {
    await ensureDeepResearch(page);
  } else {
    await ensureExtendedPro(page);
  }
  await attachFileToComposer(page, args.requestFile);
  for (const attachmentPath of args.attachFiles) {
    await attachFileToComposer(page, attachmentPath);
  }
  const chatUrl = await submitPrompt(page, submissionPrompt);
  await writeTextFileIfSet(args.chatUrlFile, chatUrl);

  if (args.returnAfterSubmit) {
    await writeJsonLog(logPath, {
      command: "submit",
      status: "submitted",
      project_url: args.projectUrl,
      chat_url: chatUrl,
      request_file: path.resolve(args.requestFile),
      response_file: path.resolve(args.responseFile),
      base_model: BASE_MODEL_LABEL,
      effort_mode: effortLabel,
      submission_method: "file_attachment",
      page_mode: args.pageMode,
      clear_draft: args.clearDraft,
      draft_cleanup: draftCleanup,
      chat_url_file: args.chatUrlFile ? path.resolve(args.chatUrlFile) : "",
      attachment_files: args.attachFiles.map((item) => path.resolve(item)),
      submission_prompt: submissionPrompt,
      submitted_at: submittedAt,
      request_chars: requestText.length,
    });
    console.log(JSON.stringify({
      command: "submit",
      status: "submitted",
      chat_url: chatUrl,
      chat_url_file: args.chatUrlFile || "",
      response_file: path.resolve(args.responseFile),
    }));
    return;
  }

  const stableText = await _waitStable(page, args.pollSeconds, args.maxWaitSeconds);
  const responseText = await extractAssistantResponse(page, stableText);
  const completedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(args.responseFile), { recursive: true });
  await fs.writeFile(args.responseFile, `${responseText.trim()}\n`, "utf8");
  await writeJsonLog(logPath, {
    command: "submit",
    project_url: args.projectUrl,
    chat_url: chatUrl,
    request_file: path.resolve(args.requestFile),
    response_file: path.resolve(args.responseFile),
    base_model: BASE_MODEL_LABEL,
    effort_mode: effortLabel,
    submission_method: "file_attachment",
    page_mode: args.pageMode,
    clear_draft: args.clearDraft,
    draft_cleanup: draftCleanup,
    chat_url_file: args.chatUrlFile ? path.resolve(args.chatUrlFile) : "",
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

  const runtime = await openBrowser({
    cdpUrl: args.cdpUrl,
    profileDir: args.profileDir,
    browserChannel: args.browserChannel,
    headless: args.headless,
  });
  const page = args.command === "submit" && args.pageMode === "new"
    ? await runtime.context.newPage()
    : runtime.context.pages()[0] || await runtime.context.newPage();

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
