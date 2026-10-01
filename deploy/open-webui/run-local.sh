#!/usr/bin/env bash
# Run Open WebUI locally against the local portfolio, to test "Ask Yaara"
# end to end without Azure.
#
#   deploy/open-webui/run-local.sh [path-to-open-webui-executable]
#
# Needs: the portfolio dev server on :3000 started with the same
# YAARA_CHAT_TOKEN and YAARA_CHAT_USER_SECRET, and Yaara (or her web chat
# worker) pointed at http://localhost:3000. Open WebUI itself is a Python
# package: `uv venv --python 3.12 .venv && uv pip install open-webui==0.11.4`.
#
# Secrets come from SECRETS_FILE (default ../.yaara-chat-local.env, outside
# this repository), never from the command line.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exe="${1:-open-webui}"
secrets="${SECRETS_FILE:-$here/../../../.yaara-chat-local.env}"
[ -f "$secrets" ] || { echo "No secrets file at $secrets. Create it with YAARA_CHAT_TOKEN, YAARA_CHAT_USER_SECRET and WEBUI_SECRET_KEY." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$here/settings.env"
. "$secrets"
set +a

export DATA_DIR="${DATA_DIR:-$here/.local-data}"
export PORT="${PORT:-8081}"
export OPENAI_API_BASE_URL="${PORTFOLIO_URL:-http://localhost:3000}/api/yaara/v1"
export OPENAI_API_KEY="$YAARA_CHAT_TOKEN"
export FORWARD_USER_INFO_HEADER_JWT_SECRET="$YAARA_CHAT_USER_SECRET"
# Locally there is no Google sign-in: one automatic user, so the portfolio
# receives a signed token for that user exactly as it would for a real one.
export WEBUI_AUTH="${WEBUI_AUTH:-False}"
# Her picture, description and suggested questions (model-metadata.mjs).
export DEFAULT_MODEL_METADATA="$(node "$here/model-metadata.mjs" | sed -n "s/^DEFAULT_MODEL_METADATA=//p")"
export DEFAULT_PROMPT_SUGGESTIONS="$(node "$here/model-metadata.mjs" | sed -n "s/^DEFAULT_PROMPT_SUGGESTIONS=//p")"
mkdir -p "$DATA_DIR"
exec "$exe" serve --port "$PORT"
