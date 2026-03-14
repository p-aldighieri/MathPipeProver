#!/usr/bin/env node
// --------------------------------------------------------------------------
//  MCP Heartbeat Watcher — watches MathPipeProver heartbeat JSON files
//
//  Tools exposed:
//    wait_for_completion  – blocks until terminal status; returns response text
// --------------------------------------------------------------------------

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

// ── helpers ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["starting", "submitted", "waiting_reply"]);
const TERMINAL_STATUSES = new Set(["completed", "error", "timeout"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fileExists(p) {
  try {
    await access(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readText(filePath) {
  try {
    const text = await readFile(filePath, "utf-8");
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Compute age of heartbeat_at in seconds (returns Infinity if missing). */
function heartbeatAgeSeconds(payload) {
  const raw = payload?.heartbeat_at;
  if (!raw) return Infinity;
  const ts = new Date(raw);
  if (Number.isNaN(ts.getTime())) return Infinity;
  return (Date.now() - ts.getTime()) / 1000;
}

/** Build a tidy status snapshot from the heartbeat payload. */
function buildSnapshot(payload, extra = {}) {
  if (!payload) {
    return { status: "missing", message: "Heartbeat file not found.", ...extra };
  }
  const snap = {
    status: String(payload.status ?? "unknown"),
    heartbeat_at: payload.heartbeat_at ?? null,
    chat_url: payload.chat_url ?? null,
    generating: payload.generating ?? null,
    stable_cycles: payload.stable_cycles ?? null,
    latest_response_chars: payload.latest_response_chars ?? null,
    deadline_at: payload.deadline_at ?? null,
    ...extra,
  };
  return snap;
}

// ── core polling logic ─────────────────────────────────────────────────────

/**
 * Single-pass check of the heartbeat + response files.
 *
 * Returns { done: boolean, snapshot: object, responseText?: string }
 *   done=true  → terminal condition reached (completed / error / stale / timeout-like)
 *   done=false → still in progress
 */
async function checkOnce(heartbeatFile, responseFile, staleAfterSeconds) {
  const hbPath = resolve(heartbeatFile);
  const payload = await readJson(hbPath);

  if (!payload) {
    return {
      done: false,
      snapshot: buildSnapshot(null),
    };
  }

  const status = String(payload.status ?? "unknown").trim();

  // ── completed ──
  if (status === "completed") {
    const rPath = responseFile
      ? resolve(responseFile)
      : payload.response_file
        ? resolve(payload.response_file)
        : null;
    const responseText = rPath ? await readText(rPath) : null;
    if (responseText) {
      return {
        done: true,
        snapshot: buildSnapshot(payload, {
          message: "Heartbeat completed and response file is ready.",
          response_chars: responseText.length,
        }),
        responseText,
      };
    }
    // completed but response file missing/empty — treat as still in-progress
    return {
      done: false,
      snapshot: buildSnapshot(payload, {
        status: "completed_missing_response",
        message: "Heartbeat says completed but response file is missing or empty.",
      }),
    };
  }

  // ── error ──
  if (status === "error") {
    return {
      done: true,
      snapshot: buildSnapshot(payload, {
        message: payload.error || "Heartbeat reported an error.",
      }),
    };
  }

  // ── stale detection ──
  if (ACTIVE_STATUSES.has(status) || status === "completed_missing_response") {
    const age = heartbeatAgeSeconds(payload);
    if (staleAfterSeconds > 0 && age > staleAfterSeconds) {
      return {
        done: true,
        snapshot: buildSnapshot(payload, {
          status: "stale",
          message: `Heartbeat is stale (${age.toFixed(1)}s old, threshold ${staleAfterSeconds}s) while status=${status}.`,
          age_seconds: Math.round(age),
        }),
      };
    }
  }

  // ── still active ──
  return {
    done: false,
    snapshot: buildSnapshot(payload, {
      message: `Browser agent is active (status=${status}).`,
      age_seconds: Math.round(heartbeatAgeSeconds(payload)),
    }),
  };
}

// ── MCP server setup ──────────────────────────────────────────────────────

const server = new Server(
  { name: "mcp-heartbeat-watcher", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// ── tool definitions ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "wait_for_completion",
      description:
        "Block until the external-agent heartbeat file reaches a terminal status " +
        "(completed / error / stale / timeout).  Returns the response file contents " +
        "on success.  Use this when you want to hand off control and resume only " +
        "when the browser agent is done.  The session stays alive while this tool " +
        "is running — no heartbeat pings needed from your side.",
      inputSchema: {
        type: "object",
        properties: {
          heartbeat_file: {
            type: "string",
            description: "Absolute path to the heartbeat JSON file written by the browser agent.",
          },
          response_file: {
            type: "string",
            description:
              "Absolute path to the expected response markdown file.  " +
              "Falls back to the response_file field inside the heartbeat JSON if omitted.",
          },
          poll_interval_seconds: {
            type: "number",
            description: "Seconds between checks (default 10).",
            default: 10,
          },
          timeout_seconds: {
            type: "number",
            description: "Max total wait in seconds (default 5400 = 90 min).  0 = no limit.",
            default: 5400,
          },
          stale_after_seconds: {
            type: "number",
            description:
              "If the heartbeat_at timestamp is older than this many seconds while status " +
              "is still active, treat it as stale and return immediately (default 120).  0 = disable.",
            default: 120,
          },
        },
        required: ["heartbeat_file"],
      },
    },
  ],
}));

// ── tool implementations ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ────────── wait_for_completion ──────────
  if (name === "wait_for_completion") {
    const heartbeatFile = args.heartbeat_file;
    const responseFile = args.response_file ?? null;
    const pollInterval = ((args.poll_interval_seconds ?? 10) || 10) * 1000;
    const timeout = ((args.timeout_seconds ?? 5400) || 0) * 1000;
    const staleAfter = args.stale_after_seconds ?? 120;

    const start = Date.now();

    while (true) {
      const { done, snapshot, responseText } = await checkOnce(
        heartbeatFile,
        responseFile,
        staleAfter,
      );

      if (done) {
        const parts = [
          `## Heartbeat result: ${snapshot.status}`,
          "",
          `**Message:** ${snapshot.message}`,
          snapshot.chat_url ? `**Chat URL:** ${snapshot.chat_url}` : null,
          snapshot.response_chars != null
            ? `**Response length:** ${snapshot.response_chars} chars`
            : null,
          "",
        ].filter(Boolean);

        if (responseText) {
          parts.push("## Response content", "", responseText);
        }

        return {
          content: [{ type: "text", text: parts.join("\n") }],
          isError: snapshot.status !== "completed",
        };
      }

      // timeout check
      if (timeout > 0 && Date.now() - start > timeout) {
        return {
          content: [
            {
              type: "text",
              text:
                `## Heartbeat result: timeout\n\n` +
                `Timed out after ${((Date.now() - start) / 1000).toFixed(0)}s.\n` +
                `Last status: ${snapshot.status}\n` +
                (snapshot.latest_response_chars != null
                  ? `Latest response chars: ${snapshot.latest_response_chars}\n`
                  : "") +
                (snapshot.chat_url ? `Chat URL: ${snapshot.chat_url}\n` : ""),
            },
          ],
          isError: true,
        };
      }

      await sleep(pollInterval);
    }
  }

  // ────────── unknown tool ──────────
  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ── start ─────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
