/**
 * lib/heartbeat.mjs — heartbeat JSON emission for long-running submissions.
 *
 * Emits status snapshots to a passive JSON file that `mpp watch-heartbeat`
 * (mathpipeprover/heartbeat.py) can poll without resuming or routing the
 * proof automatically. Schema is byte-stable — `mpp watch-heartbeat` and
 * the orchestrator's stale-file cleanup both depend on the field shape.
 *
 * ## Status notes (2026-05-26 audit)
 *
 * The heartbeat layer is effectively deprecated in practice: nothing in
 * the live pipeline reads the JSON during a run. Only `mpp watch-heartbeat`
 * consumes it, as opt-in manual telemetry. A separate task (spawned
 * 2026-05-26) tracks full removal. This module exists as a clean
 * extraction so that future deletion is a single-file delete plus the
 * wrapper's `--heartbeat-json` arg removal, rather than untangling
 * inline closures.
 *
 * ## Public API
 *
 *   createHeartbeatWriter(opts) -> async (status, extra?) => void
 *       Returns a writer closure pre-bound to a heartbeat JSON path and
 *       the static fields from `opts`. Each call merges in `status` and
 *       `extra` and writes the full JSON to disk.
 *
 *   resolveHeartbeatPath(responseFile, override?) -> string
 *       Default heartbeat JSON path: replace ".md" with "_heartbeat.json"
 *       in the response file path. `override` wins if provided.
 *
 * ## JSON schema (do not change without coordinating)
 *
 * { command: "submit",
 *   status: "starting" | "submitted" | "waiting_reply" | "completed" | "error",
 *   project_url, request_file, response_file,
 *   heartbeat_at, submitted_at,
 *   poll_seconds, max_wait_seconds,
 *   base_model, effort_mode,
 *   ...extra-fields-per-status }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { BASE_MODEL_LABEL, EFFORT_LABEL } from './model_pill.mjs';

async function writeJsonLog(logPath, payload) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function resolveHeartbeatPath(responseFile, override = '') {
  return override || responseFile.replace(/\.md$/i, '_heartbeat.json');
}

/**
 * Create a heartbeat-writing closure pre-bound to the immutable fields.
 *
 * @param {object} opts
 * @param {string} opts.heartbeatPath  destination JSON path
 * @param {string} opts.command        usually "submit"
 * @param {string} opts.projectUrl
 * @param {string} opts.requestFile    absolute path
 * @param {string} opts.responseFile   absolute path
 * @param {string} opts.submittedAt    ISO timestamp set at submit time
 * @param {number} opts.pollSeconds
 * @param {number} opts.maxWaitSeconds
 */
export function createHeartbeatWriter(opts) {
  const {
    heartbeatPath, command = 'submit', projectUrl,
    requestFile, responseFile, submittedAt,
    pollSeconds, maxWaitSeconds,
    // Override effort_mode for non-default modes (e.g. Deep Research).
    // Defaults to the Extended Pro label to preserve the historical schema.
    effortLabel = EFFORT_LABEL,
  } = opts;
  return async (status, extra = {}) => {
    await writeJsonLog(heartbeatPath, {
      command,
      status,
      project_url: projectUrl,
      request_file: path.resolve(requestFile),
      response_file: path.resolve(responseFile),
      heartbeat_at: new Date().toISOString(),
      submitted_at: submittedAt,
      poll_seconds: pollSeconds,
      max_wait_seconds: maxWaitSeconds,
      base_model: BASE_MODEL_LABEL,
      effort_mode: effortLabel,
      ...extra,
    });
  };
}
