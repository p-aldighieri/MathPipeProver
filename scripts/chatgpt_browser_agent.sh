#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to install the ChatGPT browser agent runtime." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$SCRIPT_DIR/chatgpt_browser_agent"

if [[ ! -d "$AGENT_DIR/node_modules/playwright" ]]; then
  echo "Installing Playwright runtime for chatgpt_browser_agent..." >&2
  (
    cd "$AGENT_DIR"
    npm install --no-fund --no-audit
  )
fi

exec node "$AGENT_DIR/chatgpt_browser_agent.mjs" "$@"
