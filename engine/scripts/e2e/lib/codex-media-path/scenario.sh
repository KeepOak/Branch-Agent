#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/branch-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
branch_e2e_eval_test_state_from_b64 "${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}"
export BRANCH_SKIP_CHANNELS=1
export BRANCH_SKIP_GMAIL_WATCHER=1
export BRANCH_SKIP_CRON=1
export BRANCH_SKIP_CANVAS_HOST=1
export BRANCH_SKIP_BROWSER_CONTROL_SERVER=1
export BRANCH_SKIP_ACPX_RUNTIME=1
export BRANCH_SKIP_ACPX_RUNTIME_PROBE=1
export BRANCH_AGENT_HARNESS_FALLBACK=none
export BRANCH_CODEX_MEDIA_PATH_APP_SERVER_LOG="/tmp/branch-codex-media-path-app-server.jsonl"

PORT="${PORT:?missing PORT}"
TOKEN="${BRANCH_GATEWAY_TOKEN:?missing BRANCH_GATEWAY_TOKEN}"
PLUGIN_SPEC="${BRANCH_CODEX_MEDIA_PATH_PLUGIN_SPEC:-npm:@branch/codex}"
if [[ -z "${BRANCH_CODEX_MEDIA_PATH_PLUGIN_SPEC:-}" && -n "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]]; then
  PLUGIN_SPEC="npm:@branch/codex@${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}"
fi
GATEWAY_LOG="/tmp/branch-codex-media-path-gateway.log"
CLIENT_LOG="/tmp/branch-codex-media-path-client.log"
PLUGIN_INSTALL_LOG="/tmp/branch-codex-media-path-plugin-install.log"
PLUGIN_INSPECT_LOG="/tmp/branch-codex-media-path-plugin-inspect.json"
gateway_pid=""
plugin_registry_pid=""

cleanup() {
  branch_e2e_stop_process "$gateway_pid"
  branch_e2e_stop_process "$plugin_registry_pid"
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "Codex media-path Docker E2E failed with exit code $status" >&2
  branch_e2e_dump_logs "$PLUGIN_INSTALL_LOG" "$PLUGIN_INSPECT_LOG" "$GATEWAY_LOG" "$CLIENT_LOG" "$BRANCH_CODEX_MEDIA_PATH_APP_SERVER_LOG"
}
branch_e2e_enable_failure_diagnostics

entry="$(branch_e2e_resolve_entrypoint)"
mkdir -p "$BRANCH_STATE_DIR" "$BRANCH_TEST_WORKSPACE_DIR"
rm -f "$BRANCH_CODEX_MEDIA_PATH_APP_SERVER_LOG"

branch_e2e_enable_branch_cli_timeout
branch_prepublish_plugin_registry_start_mounted \
  /tmp/branch-codex-media-path-registry plugin_registry_pid '["@branch/codex"]'

echo "Installing Codex plugin: $PLUGIN_SPEC"
branch_e2e_fixture_plugin_command branch -- plugins install "$PLUGIN_SPEC" --force >"$PLUGIN_INSTALL_LOG" 2>&1
branch plugins inspect codex --runtime --json >"$PLUGIN_INSPECT_LOG"

node scripts/e2e/lib/codex-media-path/write-config.mjs

gateway_pid="$(branch_e2e_start_gateway "$entry" "$PORT" "$GATEWAY_LOG")"
branch_e2e_wait_gateway_ready "$gateway_pid" "$GATEWAY_LOG" 480 "$PORT"

PORT="$PORT" BRANCH_GATEWAY_TOKEN="$TOKEN" \
  tsx scripts/e2e/lib/codex-media-path/client.mjs >"$CLIENT_LOG" 2>&1

branch_e2e_print_log "$CLIENT_LOG"
echo "Codex media-path Docker E2E passed"
