#!/usr/bin/env bash
# scripts/council/dispatch_extended_pro.sh — Run the ChatGPT Extended Pro council member.
#
# Mirrors dispatch_codex.sh / dispatch_opus.sh's core contract (--packet-dir /
# --prompt / --out) and adds the browser-specific args (--project-url,
# optional --cdp-url / --port). Builds the combined prompt the same way,
# then submits via the validated lib-backed browser flow.
#
# Wall-clock: typically the slowest council member (30–90 min). The
# /search-council skill fans this out in parallel with Codex (5–8 min) and
# Opus (1–3 min), so wall-clock = max(members) ≈ EP's time.
#
# Usage:
#   ./dispatch_extended_pro.sh \
#     --packet-dir PATH \
#     --prompt PATH/to/03b_council_member_soft.md \
#     --out PATH/to/extended_pro_memo.md \
#     --project-url https://chatgpt.com/g/g-p-XXXX/project \
#     [--cdp-url http://localhost:9229]   # OR persistent profile via env
#     [--port 9229]                       # convenience: --cdp-url http://localhost:<port>
#
# Exit codes:
#   0 — memo written
#   1 — bad args / missing inputs
#   2 — submit failed
#   3 — submit returned empty response

set -euo pipefail

PACKET_DIR=""
PROMPT_TEMPLATE=""
OUTPUT_FILE=""
PROJECT_URL=""
CDP_URL=""
PORT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --packet-dir) PACKET_DIR="$2"; shift 2 ;;
    --prompt) PROMPT_TEMPLATE="$2"; shift 2 ;;
    --out) OUTPUT_FILE="$2"; shift 2 ;;
    --project-url) PROJECT_URL="$2"; shift 2 ;;
    --cdp-url) CDP_URL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --packet-dir DIR --prompt PATH --out PATH --project-url URL [--cdp-url URL | --port N]"
      exit 0 ;;
    *) echo "ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

[[ -n "$PACKET_DIR" && -d "$PACKET_DIR" ]] || { echo "ERROR: --packet-dir must point to an existing directory (got: $PACKET_DIR)" >&2; exit 1; }
[[ -n "$PROMPT_TEMPLATE" && -f "$PROMPT_TEMPLATE" ]] || { echo "ERROR: --prompt must point to an existing template file (got: $PROMPT_TEMPLATE)" >&2; exit 1; }
[[ -n "$OUTPUT_FILE" ]] || { echo "ERROR: --out required" >&2; exit 1; }
[[ -n "$PROJECT_URL" ]] || { echo "ERROR: --project-url required (Extended Pro needs a project context)" >&2; exit 1; }

# --port is a convenience for --cdp-url http://localhost:<port>
if [[ -z "$CDP_URL" && -n "$PORT" ]]; then
  CDP_URL="http://localhost:$PORT"
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BROWSER_AGENT="$REPO_ROOT/scripts/chatgpt_browser_agent.sh"
[[ -x "$BROWSER_AGENT" ]] || { echo "ERROR: $BROWSER_AGENT not executable" >&2; exit 1; }

mkdir -p "$(dirname "$OUTPUT_FILE")"

# Stage temp files
BUNDLE_FILE=$(mktemp -t council_bundle.XXXXXX)
REQUEST_FILE="${OUTPUT_FILE%.md}_request.md"
LOG_FILE="${OUTPUT_FILE%.md}_ep.log"
trap "rm -f '$BUNDLE_FILE'" EXIT

# Build context bundle the same way as Codex / Opus adapters.
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
  echo "ERROR: no packet files found in $PACKET_DIR" >&2
  exit 1
fi

# Substitute {context_bundle} placeholder into the request file.
awk -v bundle="$BUNDLE_FILE" '
  /^\{context_bundle\}$/ { while ((getline line < bundle) > 0) print line; next }
  { print }
' "$PROMPT_TEMPLATE" > "$REQUEST_FILE"

# Compose the chatgpt_browser_agent.sh submit invocation.
CMD=("$BROWSER_AGENT" submit
     --project-url "$PROJECT_URL"
     --request-file "$REQUEST_FILE"
     --response-file "$OUTPUT_FILE")
if [[ -n "$CDP_URL" ]]; then
  CMD+=(--cdp-url "$CDP_URL")
fi

echo "Council Extended Pro dispatch:"
echo "  packet:          $PACKET_DIR"
echo "  prompt template: $PROMPT_TEMPLATE"
echo "  output:          $OUTPUT_FILE"
echo "  request file:    $REQUEST_FILE"
echo "  project:         $PROJECT_URL"
echo "  cdp-url:         ${CDP_URL:-(persistent profile)}"
echo "  log:             $LOG_FILE"
echo "  expect 30–90 min wall-clock"
echo

if "${CMD[@]}" > "$LOG_FILE" 2>&1; then
  if [[ ! -s "$OUTPUT_FILE" ]]; then
    echo "ERROR: Extended Pro returned empty response; see $LOG_FILE" >&2
    tail -10 "$LOG_FILE" >&2
    exit 3
  fi
  echo "Done: $OUTPUT_FILE ($(wc -l < "$OUTPUT_FILE") lines)"
  exit 0
else
  rc=$?
  echo "ERROR: chatgpt_browser_agent.sh submit failed (exit $rc); see $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2
  exit 2
fi
