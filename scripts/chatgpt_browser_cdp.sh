#!/usr/bin/env bash
set -euo pipefail

PORT="${MPP_CHATGPT_CDP_PORT:-9222}"
PROFILE_DIR="${MPP_CHATGPT_CDP_PROFILE_DIR:-$HOME/.mathpipeprover/chatgpt-cdp-profile}"
CHROME_BIN="${MPP_CHATGPT_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Error: Google Chrome binary not found at '$CHROME_BIN'." >&2
  echo "Set MPP_CHATGPT_CHROME_BIN to a valid Chrome/Chromium executable." >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

exec "$CHROME_BIN" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://chatgpt.com/"
