#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Runs the packaged Gateway/code-mode/MCP API-file smoke against a live OpenAI
# provider so the real agent has to discover and use the virtual declarations.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "branch-mcp-code-mode-gateway-live-e2e" BRANCH_IMAGE)"
PORT="$(docker_e2e_read_tcp_port_env BRANCH_MCP_CODE_MODE_LIVE_GATEWAY_PORT 18789)"
CLIENT_TIMEOUT_MS="$(docker_e2e_read_positive_int_env BRANCH_MCP_CODE_MODE_CLIENT_TIMEOUT_MS 300000)"
CLIENT_BODY_MAX_BYTES="$(docker_e2e_read_positive_int_env BRANCH_MCP_CODE_MODE_CLIENT_BODY_MAX_BYTES 1048576)"
TOKEN="mcp-code-mode-live-e2e-$(date +%s)-$$"
CONTAINER_NAME="branch-mcp-code-mode-live-e2e-$$"
PROFILE_FILE="${BRANCH_MCP_CODE_MODE_LIVE_PROFILE_FILE:-${BRANCH_TESTBOX_PROFILE_FILE:-$HOME/.branch-testbox-live.profile}}"

CLIENT_LOG="$(mktemp -t branch-mcp-code-mode-live-log.XXXXXX)"

trap 'docker_e2e_cleanup_container_run "$CONTAINER_NAME" "$CLIENT_LOG"' EXIT

if [ ! -f "$PROFILE_FILE" ] && [ -f "$HOME/.profile" ]; then
  PROFILE_FILE="$HOME/.profile"
fi

PROFILE_STATUS="none"
if [ -f "$PROFILE_FILE" ] && [ -r "$PROFILE_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROFILE_FILE"
  set +a
  PROFILE_STATUS="$PROFILE_FILE"
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY was not available after sourcing $PROFILE_STATUS." >&2
  exit 1
fi
docker_e2e_build_or_reuse "$IMAGE_NAME" mcp-code-mode-gateway-live
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 mcp-code-mode-gateway-live empty)"
BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS=()
if [ -n "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  branch_prepublish_plugin_registry_configure_docker_args "$BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR"
fi

# Pass only the selected provider's credentials into the container; importing
# the whole profile there also enables unrelated providers during startup.
unset BRANCH_TESTBOX

echo "Running live Docker Gateway code-mode MCP API-file smoke..."
echo "Profile file: $PROFILE_STATUS"
set +e
docker_e2e_run_with_harness \
  --name "$CONTAINER_NAME" \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e OPENAI_API_KEY \
  -e OPENAI_BASE_URL \
  -e "BRANCH_DOCKER_OPENAI_BASE_URL=${OPENAI_BASE_URL:-https://api.openai.com/v1}" \
  -e "BRANCH_GATEWAY_TOKEN=$TOKEN" \
  -e "BRANCH_SKIP_CHANNELS=1" \
  -e "BRANCH_SKIP_GMAIL_WATCHER=1" \
  -e "BRANCH_SKIP_CRON=1" \
  -e "BRANCH_SKIP_CANVAS_HOST=1" \
  -e "BRANCH_SKIP_ACPX_RUNTIME=1" \
  -e "BRANCH_SKIP_ACPX_RUNTIME_PROBE=1" \
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64" \
  -e "GW_URL=http://127.0.0.1:$PORT" \
  -e "GW_TOKEN=$TOKEN" \
  -e "BRANCH_MCP_CODE_MODE_CLIENT_TIMEOUT_MS=$CLIENT_TIMEOUT_MS" \
  -e "BRANCH_MCP_CODE_MODE_CLIENT_BODY_MAX_BYTES=$CLIENT_BODY_MAX_BYTES" \
  -e "BRANCH_ALLOW_INSECURE_PRIVATE_WS=1" \
  -e "BRANCH_MCP_CODE_MODE_MODEL=${BRANCH_MCP_CODE_MODE_LIVE_MODEL:-branch/main}" \
  ${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]+"${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]}"} \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/mcp-code-mode/scenario.sh live "$PORT" >"$CLIENT_LOG" 2>&1
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "Live Docker MCP code-mode API-file smoke failed"
  docker_e2e_print_log "$CLIENT_LOG"
  exit "$status"
fi

docker_e2e_print_log "$CLIENT_LOG"
echo "OK"
