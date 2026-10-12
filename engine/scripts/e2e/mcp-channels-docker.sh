#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Runs a Docker Gateway plus MCP stdio bridge smoke with seeded conversations and
# raw Claude notification-frame assertions.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "branch-mcp-channels-e2e" BRANCH_IMAGE)"
PORT="18789"
TOKEN="mcp-e2e-$(date +%s)-$$"
CONTAINER_NAME="branch-mcp-e2e-$$"
CLIENT_LOG="$(mktemp -t branch-mcp-client-log.XXXXXX)"

trap 'docker_e2e_cleanup_container_run "$CONTAINER_NAME" "$CLIENT_LOG"' EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" mcp-channels
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 mcp-channels empty)"
DOCKER_ENV_ARGS=()
capability_status=0
branch_resolve_frozen_plugin_harness_capabilities \
  "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" || capability_status=$?
[ "$capability_status" -eq 0 ] || exit "$capability_status"
branch_append_frozen_plugin_harness_docker_env

echo "Running in-container gateway + MCP smoke..."
# Harness files are mounted read-only; the app under test comes from /app/dist.
set +e
docker_e2e_run_with_harness \
  --name "$CONTAINER_NAME" \
  -e "BRANCH_GATEWAY_TOKEN=$TOKEN" \
  -e "BRANCH_SKIP_CHANNELS=1" \
  -e "BRANCH_SKIP_GMAIL_WATCHER=1" \
  -e "BRANCH_SKIP_CRON=1" \
  -e "BRANCH_SKIP_CANVAS_HOST=1" \
  -e "BRANCH_SKIP_ACPX_RUNTIME=1" \
  -e "BRANCH_SKIP_ACPX_RUNTIME_PROBE=1" \
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64" \
  -e "GW_URL=ws://127.0.0.1:$PORT" \
  -e "GW_TOKEN=$TOKEN" \
  -e "BRANCH_ALLOW_INSECURE_PRIVATE_WS=1" \
  ${DOCKER_ENV_ARGS[@]+"${DOCKER_ENV_ARGS[@]}"} \
  "$IMAGE_NAME" \
  bash -lc "set -euo pipefail
    source scripts/lib/branch-e2e-instance.sh
    branch_e2e_eval_test_state_from_b64 \"\${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}\"
    entry=\"\$(branch_e2e_resolve_entrypoint)\"
    mock_port=44081
    export BRANCH_DOCKER_OPENAI_BASE_URL=\"http://127.0.0.1:\$mock_port/v1\"
    mock_pid=\"\$(branch_e2e_start_mock_openai \"\$mock_port\" /tmp/mcp-channels-mock-openai.log)\"
    gateway_pid=
    cleanup_inner() {
      branch_e2e_stop_process \"\${gateway_pid:-}\"
      branch_e2e_stop_process \"\${mock_pid:-}\"
    }
    dump_gateway_log_on_error() {
      status=\$?
      if [ \"\$status\" -ne 0 ]; then
        branch_e2e_dump_logs \
          /tmp/mcp-channels-gateway.log \
          /tmp/mcp-channels-seed.log \
          /tmp/mcp-channels-mock-openai.log
      fi
      cleanup_inner
      exit \"\$status\"
    }
    trap cleanup_inner EXIT
    trap dump_gateway_log_on_error ERR
    branch_e2e_wait_mock_openai \"\$mock_port\"
    tsx scripts/e2e/mcp-channels-seed.ts >/tmp/mcp-channels-seed.log
    gateway_pid=\"\$(branch_e2e_start_gateway \"\$entry\" $PORT /tmp/mcp-channels-gateway.log)\"
    branch_e2e_wait_gateway_ready \"\$gateway_pid\" /tmp/mcp-channels-gateway.log 480 $PORT
    tsx test/e2e/qa-lab/runtime/mcp-channels-docker-client.ts
  " >"$CLIENT_LOG" 2>&1
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "Docker MCP smoke failed"
  docker_e2e_print_log "$CLIENT_LOG"
  exit "$status"
fi

docker_e2e_print_log "$CLIENT_LOG"
echo "OK"
