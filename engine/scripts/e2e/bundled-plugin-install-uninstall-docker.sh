#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "branch-bundled-plugin-install-uninstall-e2e" BRANCH_BUNDLED_PLUGIN_INSTALL_UNINSTALL_E2E_IMAGE)"
LIST_TIMEOUT_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_LIST_TIMEOUT_MS 30000
)"
LIST_MAX_BUFFER_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_LIST_MAX_BUFFER_BYTES 4194304
)"
RUNTIME_PORT_BASE="$(docker_e2e_read_tcp_port_env BRANCH_BUNDLED_PLUGIN_RUNTIME_PORT_BASE 19000)"
RUNTIME_OUTPUT_CHARS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_OUTPUT_CHARS 1048576
)"
RUNTIME_LOG_SCAN_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_LOG_SCAN_BYTES 262144
)"
RUNTIME_GATEWAY_LOG_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_GATEWAY_LOG_BYTES 16777216
)"
RUNTIME_READY_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_READY_MS 900000
)"
RUNTIME_RPC_MS="$(docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_RPC_MS 60000)"
RUNTIME_RPC_READY_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_RPC_READY_MS 210000
)"
RUNTIME_WATCHDOG_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_WATCHDOG_MS 1000
)"
RUNTIME_COMMAND_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_COMMAND_MS 120000
)"
RUNTIME_HTTP_MS="$(docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_HTTP_MS 5000)"
RUNTIME_TEARDOWN_GRACE_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_TEARDOWN_GRACE_MS 10000
)"
RUNTIME_TEARDOWN_KILL_GRACE_MS="$(
  docker_e2e_read_positive_int_env BRANCH_BUNDLED_PLUGIN_RUNTIME_TEARDOWN_KILL_GRACE_MS 1000
)"

docker_e2e_build_or_reuse "$IMAGE_NAME" bundled-plugin-install-uninstall
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 bundled-plugin-install-uninstall empty)"

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "BRANCH_BUNDLED_PLUGIN_LIST_TIMEOUT_MS=$LIST_TIMEOUT_MS"
  -e "BRANCH_BUNDLED_PLUGIN_LIST_MAX_BUFFER_BYTES=$LIST_MAX_BUFFER_BYTES"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_PORT_BASE=$RUNTIME_PORT_BASE"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_OUTPUT_CHARS=$RUNTIME_OUTPUT_CHARS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_LOG_SCAN_BYTES=$RUNTIME_LOG_SCAN_BYTES"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_GATEWAY_LOG_BYTES=$RUNTIME_GATEWAY_LOG_BYTES"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_READY_MS=$RUNTIME_READY_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_RPC_MS=$RUNTIME_RPC_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_RPC_READY_MS=$RUNTIME_RPC_READY_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_WATCHDOG_MS=$RUNTIME_WATCHDOG_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_COMMAND_MS=$RUNTIME_COMMAND_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_HTTP_MS=$RUNTIME_HTTP_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_TEARDOWN_GRACE_MS=$RUNTIME_TEARDOWN_GRACE_MS"
  -e "BRANCH_BUNDLED_PLUGIN_RUNTIME_TEARDOWN_KILL_GRACE_MS=$RUNTIME_TEARDOWN_KILL_GRACE_MS"
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64"
)
capability_status=0
branch_resolve_frozen_plugin_harness_capabilities \
  "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" || capability_status=$?
[ "$capability_status" -eq 0 ] || exit "$capability_status"
branch_append_frozen_plugin_harness_docker_env
for env_name in \
  BRANCH_BUNDLED_PLUGIN_SWEEP_TOTAL \
  BRANCH_BUNDLED_PLUGIN_SWEEP_INDEX \
  BRANCH_BUNDLED_PLUGIN_SWEEP_IDS \
  BRANCH_BUNDLED_PLUGIN_SWEEP_COMMAND_TIMEOUT \
  BRANCH_BUNDLED_PLUGIN_RUNTIME_SMOKE \
  BRANCH_BUNDLED_PLUGIN_TTS_LIVE_PROVIDER \
  BRANCH_PLUGIN_LIFECYCLE_TRACE \
  OPENAI_API_KEY; do
  env_value="${!env_name:-}"
  if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
    DOCKER_ENV_ARGS+=(-e "$env_name")
  fi
done

echo "Running bundled plugin install/uninstall Docker E2E..."
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/branch-bundled-plugin-install-uninstall.XXXXXX")"
cleanup() {
  rm -f "$RUN_LOG"
}
trap cleanup EXIT

if ! docker_e2e_run_with_harness \
  "${DOCKER_ENV_ARGS[@]}" \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/bundled-plugin-install-uninstall/sweep.sh 2>&1 |
  tee "$RUN_LOG"
then
  exit 1
fi

echo "OK"
