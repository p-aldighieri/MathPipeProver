#!/usr/bin/env bash
# scripts/council/dispatch_gemini.sh — Run the Google Gemini council member.
#
# Reads a packet directory (objective.md / paper-ref.md / dossier.md /
# prior-routes.md), interpolates them into the council-member prompt
# template's {context_bundle} placeholder, invokes the Gemini CLI in
# headless (non-interactive) read-only mode, and writes the resulting
# memo to disk.
#
# One of four peer adapters under scripts/council/:
#   dispatch_codex.sh         — Codex CLI (GPT-5.5 thinking high)
#   dispatch_gemini.sh        — this script (latest Gemini Pro via Gemini CLI)
#   dispatch_opus.sh          — Claude Opus via CC Agent
#   dispatch_extended_pro.sh  — ChatGPT Extended Pro via browser
# All four honor the same --packet-dir / --prompt / --out contract so the
# /search-council skill can fan them out uniformly.
#
# Requires the Gemini CLI (`gemini`) on PATH, authenticated once via
# `gemini` (interactive OAuth login) or a GEMINI_API_KEY. If the CLI is
# absent, this member is simply skipped (--skip-member gemini) and the
# council runs with the remaining members. See docs/soft_scaffolding.md.
#
# Model selection: by default this adapter passes NO model flag, so the
# Gemini CLI uses its own built-in default — which Google maintains as the
# latest Gemini Pro (verified 2026-05-31: resolves to gemini-3.1-pro-preview).
# This is deliberate: it is a live "pointer to latest Pro" with no version
# string to go stale. There is no server-side `-latest` alias on the OAuth
# path (gemini-pro-latest / gemini-3-pro-latest both 404), so the CLI default
# is the cleanest pointer. Pass --model NAME only to pin a specific version.
#
# Usage:
#   ./dispatch_gemini.sh \
#     --packet-dir PATH \
#     --prompt PATH/to/03b_council_member_soft.md \
#     --out PATH/to/gemini_memo.md \
#     [--model NAME]   # optional; default = Gemini CLI's built-in latest Pro
#
# Exit codes:
#   0 — memo written
#   1 — bad args / missing inputs / gemini CLI not on PATH
#   2 — gemini invocation failed / empty output

set -euo pipefail

PACKET_DIR=""
PROMPT_TEMPLATE=""
OUTPUT_FILE=""
MODEL=""   # empty => let the Gemini CLI pick its built-in default (latest Pro)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --packet-dir) PACKET_DIR="$2"; shift 2 ;;
    --prompt) PROMPT_TEMPLATE="$2"; shift 2 ;;
    --out) OUTPUT_FILE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --packet-dir DIR --prompt PATH --out PATH [--model NAME]"
      echo "  --model is optional; default = Gemini CLI's built-in latest-Pro model"
      exit 0 ;;
    *) echo "ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

[[ -n "$PACKET_DIR" && -d "$PACKET_DIR" ]] || { echo "ERROR: --packet-dir must point to an existing directory (got: $PACKET_DIR)" >&2; exit 1; }
[[ -n "$PROMPT_TEMPLATE" && -f "$PROMPT_TEMPLATE" ]] || { echo "ERROR: --prompt must point to an existing template file (got: $PROMPT_TEMPLATE)" >&2; exit 1; }
[[ -n "$OUTPUT_FILE" ]] || { echo "ERROR: --out required" >&2; exit 1; }
command -v gemini >/dev/null 2>&1 || { echo "ERROR: gemini CLI not on PATH. Install with 'npm install -g @google/gemini-cli' and authenticate once via 'gemini', or skip this member with --skip-member gemini." >&2; exit 1; }

mkdir -p "$(dirname "$OUTPUT_FILE")"

# Stage temp files
BUNDLE_FILE=$(mktemp -t council_bundle.XXXXXX)
PROMPT_FILE=$(mktemp -t council_prompt.XXXXXX)
LOG_FILE="${OUTPUT_FILE%.md}_gemini.log"
trap "rm -f '$BUNDLE_FILE' '$PROMPT_FILE'" EXIT

# Build context bundle from packet/*.md in stable order. Missing files are skipped
# silently (orchestrator may omit prior-routes.md on attempt 1, for example).
for f in objective.md paper-ref.md dossier.md prior-routes.md; do
  if [[ -f "$PACKET_DIR/$f" ]]; then
    {
      echo ""
      echo "## $f"
      echo ""
      cat "$PACKET_DIR/$f"
      echo ""
    } >> "$BUNDLE_FILE"
  fi
done

if [[ ! -s "$BUNDLE_FILE" ]]; then
  echo "ERROR: no packet files (objective.md / paper-ref.md / dossier.md / prior-routes.md) found in $PACKET_DIR" >&2
  exit 1
fi

# Substitute {context_bundle} placeholder in the prompt template.
awk -v bundle="$BUNDLE_FILE" '
  /^\{context_bundle\}$/ { while ((getline line < bundle) > 0) print line; next }
  { print }
' "$PROMPT_TEMPLATE" > "$PROMPT_FILE"

echo "Council Gemini dispatch:"
echo "  packet:          $PACKET_DIR"
echo "  prompt template: $PROMPT_TEMPLATE"
echo "  output:          $OUTPUT_FILE"
echo "  combined prompt: $(wc -l < "$PROMPT_FILE") lines, $(wc -c < "$PROMPT_FILE") bytes"
echo "  model:           ${MODEL:-<Gemini CLI default = latest Pro>}"
echo "  log:             $LOG_FILE"
echo

# Invoke Gemini in headless read-only mode. The prompt is fed on stdin
# (no arg-length limit, mirrors dispatch_opus.sh); piped stdin triggers
# non-interactive mode. --approval-mode plan keeps the run read-only (the
# member only reasons + emits a memo; it never edits the proof repo) and
# --skip-trust is required because the council runs inside arbitrary
# proof-repo directories Gemini has not marked "trusted". -o text yields
# clean stdout (warnings go to stderr / the log). When --model is omitted
# we pass NO model flag, so the CLI uses its built-in latest-Pro default.
GEMINI_ARGS=(--approval-mode plan --skip-trust -o text)
[[ -n "$MODEL" ]] && GEMINI_ARGS+=(--model "$MODEL")

if gemini "${GEMINI_ARGS[@]}" < "$PROMPT_FILE" > "$OUTPUT_FILE" 2> "$LOG_FILE"; then
  if [[ ! -s "$OUTPUT_FILE" ]]; then
    echo "ERROR: gemini returned empty output; see $LOG_FILE" >&2
    tail -10 "$LOG_FILE" >&2
    exit 2
  fi
  echo "Done: $OUTPUT_FILE ($(wc -l < "$OUTPUT_FILE") lines)"
  exit 0
else
  rc=$?
  echo "ERROR: gemini exec failed (exit $rc); see $LOG_FILE" >&2
  tail -10 "$LOG_FILE" >&2
  exit 2
fi
