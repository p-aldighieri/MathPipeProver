#!/usr/bin/env bash
# scripts/council/dispatch_codex.sh — Run the Codex council member.
#
# Reads a packet directory (objective.md / paper-ref.md / dossier.md /
# prior-routes.md), interpolates them into the council-member prompt
# template's {context_bundle} placeholder, invokes Codex thinking
# x-high non-interactively, and writes the resulting memo to disk.
#
# Designed to be one of three peer adapters under scripts/council/:
#   dispatch_codex.sh         — this script (GPT-5.5 thinking high via Codex CLI)
#   dispatch_opus.sh          — to be added (Claude Opus via CC Agent)
#   dispatch_extended_pro.sh  — to be added (ChatGPT Extended Pro via browser)
# All three honor the same --packet-dir / --prompt / --out contract so the
# /search-council skill can fan them out uniformly.
#
# Usage:
#   ./dispatch_codex.sh \
#     --packet-dir PATH \
#     --prompt PATH/to/03b_council_member_soft.md \
#     --out PATH/to/codex_memo.md \
#     [--reasoning-effort high|extra-high]   # default: high
#
# Exit codes:
#   0 — memo written
#   1 — bad args / missing inputs
#   2 — codex invocation failed

set -euo pipefail

PACKET_DIR=""
PROMPT_TEMPLATE=""
OUTPUT_FILE=""
REASONING_EFFORT="high"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --packet-dir) PACKET_DIR="$2"; shift 2 ;;
    --prompt) PROMPT_TEMPLATE="$2"; shift 2 ;;
    --out) OUTPUT_FILE="$2"; shift 2 ;;
    --reasoning-effort) REASONING_EFFORT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 --packet-dir DIR --prompt PATH --out PATH [--reasoning-effort high|extra-high]"
      exit 0 ;;
    *) echo "ERROR: unknown arg $1" >&2; exit 1 ;;
  esac
done

[[ -n "$PACKET_DIR" && -d "$PACKET_DIR" ]] || { echo "ERROR: --packet-dir must point to an existing directory (got: $PACKET_DIR)" >&2; exit 1; }
[[ -n "$PROMPT_TEMPLATE" && -f "$PROMPT_TEMPLATE" ]] || { echo "ERROR: --prompt must point to an existing template file (got: $PROMPT_TEMPLATE)" >&2; exit 1; }
[[ -n "$OUTPUT_FILE" ]] || { echo "ERROR: --out required" >&2; exit 1; }
command -v codex >/dev/null 2>&1 || { echo "ERROR: codex CLI not on PATH" >&2; exit 1; }

mkdir -p "$(dirname "$OUTPUT_FILE")"

# Stage temp files
BUNDLE_FILE=$(mktemp -t council_bundle.XXXXXX)
PROMPT_FILE=$(mktemp -t council_prompt.XXXXXX)
LOG_FILE="${OUTPUT_FILE%.md}_codex.log"
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

echo "Council Codex dispatch:"
echo "  packet:           $PACKET_DIR"
echo "  prompt template:  $PROMPT_TEMPLATE"
echo "  output:           $OUTPUT_FILE"
echo "  combined prompt:  $(wc -l < "$PROMPT_FILE") lines, $(wc -c < "$PROMPT_FILE") bytes"
echo "  reasoning effort: $REASONING_EFFORT"
echo "  log:              $LOG_FILE"
echo

# Invoke Codex. Output is captured via -o flag (clean — no preamble), full
# log goes to LOG_FILE for post-mortem.
if codex exec --skip-git-repo-check --ephemeral --model gpt-5.5 \
     -c "model_reasoning_effort=$REASONING_EFFORT" \
     -o "$OUTPUT_FILE" \
     "$(cat "$PROMPT_FILE")" > "$LOG_FILE" 2>&1; then
  echo "Done: $OUTPUT_FILE ($(wc -l < "$OUTPUT_FILE") lines)"
  exit 0
else
  rc=$?
  echo "ERROR: codex exec failed (exit $rc); see $LOG_FILE" >&2
  tail -10 "$LOG_FILE" >&2
  exit 2
fi
