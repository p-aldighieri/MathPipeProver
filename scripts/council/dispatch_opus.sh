#!/usr/bin/env bash
# scripts/council/dispatch_opus.sh — Run the Claude Opus council member.
#
# Mirrors dispatch_codex.sh's contract: takes the same --packet-dir /
# --prompt / --out args, interpolates the packet into the template's
# {context_bundle} placeholder, invokes `claude --print --model opus`
# non-interactively, and writes the resulting memo to disk.
#
# Sibling of dispatch_codex.sh and dispatch_extended_pro.sh — all three
# share the same CLI so /search-council can fan them out uniformly.
#
# Usage:
#   ./dispatch_opus.sh \
#     --packet-dir PATH \
#     --prompt PATH/to/03b_council_member_soft.md \
#     --out PATH/to/opus_memo.md
#
# Exit codes:
#   0 — memo written
#   1 — bad args / missing inputs / missing claude binary
#   2 — claude invocation failed / empty output

set -euo pipefail

PACKET_DIR=""
PROMPT_TEMPLATE=""
OUTPUT_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --packet-dir) PACKET_DIR="$2"; shift 2 ;;
    --prompt) PROMPT_TEMPLATE="$2"; shift 2 ;;
    --out) OUTPUT_FILE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --packet-dir DIR --prompt PATH --out PATH"
      exit 0 ;;
    *) echo "ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

[[ -n "$PACKET_DIR" && -d "$PACKET_DIR" ]] || { echo "ERROR: --packet-dir must point to an existing directory (got: $PACKET_DIR)" >&2; exit 1; }
[[ -n "$PROMPT_TEMPLATE" && -f "$PROMPT_TEMPLATE" ]] || { echo "ERROR: --prompt must point to an existing template file (got: $PROMPT_TEMPLATE)" >&2; exit 1; }
[[ -n "$OUTPUT_FILE" ]] || { echo "ERROR: --out required" >&2; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "ERROR: claude CLI not on PATH" >&2; exit 1; }

mkdir -p "$(dirname "$OUTPUT_FILE")"

BUNDLE_FILE=$(mktemp -t council_bundle.XXXXXX)
PROMPT_FILE=$(mktemp -t council_prompt.XXXXXX)
LOG_FILE="${OUTPUT_FILE%.md}_opus.log"
trap "rm -f '$BUNDLE_FILE' '$PROMPT_FILE'" EXIT

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

awk -v bundle="$BUNDLE_FILE" '
  /^\{context_bundle\}$/ { while ((getline line < bundle) > 0) print line; next }
  { print }
' "$PROMPT_TEMPLATE" > "$PROMPT_FILE"

echo "Council Opus dispatch:"
echo "  packet:          $PACKET_DIR"
echo "  prompt template: $PROMPT_TEMPLATE"
echo "  output:          $OUTPUT_FILE"
echo "  combined prompt: $(wc -l < "$PROMPT_FILE") lines, $(wc -c < "$PROMPT_FILE") bytes"
echo "  log:             $LOG_FILE"
echo

# Invoke Opus non-interactively. --no-session-persistence so the council
# call doesn't pollute interactive session history.
if claude --print --model opus --no-session-persistence \
     < "$PROMPT_FILE" > "$OUTPUT_FILE" 2> "$LOG_FILE"; then
  if [[ ! -s "$OUTPUT_FILE" ]]; then
    echo "ERROR: claude returned empty output; see $LOG_FILE" >&2
    tail -10 "$LOG_FILE" >&2
    exit 2
  fi
  echo "Done: $OUTPUT_FILE ($(wc -l < "$OUTPUT_FILE") lines)"
  exit 0
else
  rc=$?
  echo "ERROR: claude --print failed (exit $rc); see $LOG_FILE" >&2
  tail -10 "$LOG_FILE" >&2
  exit 2
fi
