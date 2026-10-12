#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
KITCHEN_SINK_ASSERTIONS="$(branch_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/kitchen-sink-plugin/assertions.mjs \
  "$ROOT_DIR/scripts/e2e/lib/kitchen-sink-plugin/assertions.mjs")"
IMAGE_NAME="$(docker_e2e_resolve_image "branch-kitchen-sink-plugin-e2e" BRANCH_KITCHEN_SINK_PLUGIN_E2E_IMAGE)"
BRANCH_DOCKER_E2E_LOG_PRINT_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_DOCKER_E2E_LOG_PRINT_BYTES 65536
)"
GROVE_HUB_FIXTURE_WAIT_ATTEMPTS="$(
  docker_e2e_read_positive_int_env BRANCH_CLAWHUB_FIXTURE_WAIT_ATTEMPTS 600
)"

BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 kitchen-sink-plugin empty)"
KITCHEN_SINK_NPM_SPEC="${BRANCH_KITCHEN_SINK_NPM_SPEC:-npm:@branch/kitchen-sink@latest}"
KITCHEN_SINK_NPM_MISSING_SPEC="${BRANCH_KITCHEN_SINK_NPM_MISSING_SPEC:-npm:@branch/kitchen-sink@beta}"

DEFAULT_KITCHEN_SINK_SCENARIOS="$(
  cat <<SCENARIOS
npm-latest-full|${KITCHEN_SINK_NPM_SPEC}|branch-kitchen-sink-fixture|npm|success|full
npm-latest-conformance|${KITCHEN_SINK_NPM_SPEC}|branch-kitchen-sink-fixture|npm|success|conformance|conformance
npm-latest-adversarial|${KITCHEN_SINK_NPM_SPEC}|branch-kitchen-sink-fixture|npm|success|adversarial|adversarial
npm-beta|${KITCHEN_SINK_NPM_MISSING_SPEC}|branch-kitchen-sink-fixture|npm|failure|none
clawhub-latest|clawhub:@branch/kitchen-sink@latest|branch-kitchen-sink-fixture|clawhub|success|basic
clawhub-beta|clawhub:@branch/kitchen-sink@beta|branch-kitchen-sink-fixture|clawhub|failure|none
npm-to-clawhub|clawhub:@branch/kitchen-sink@latest|branch-kitchen-sink-fixture|clawhub|success|basic||${KITCHEN_SINK_NPM_SPEC}
SCENARIOS
)"
KITCHEN_SINK_SCENARIOS="${BRANCH_KITCHEN_SINK_PLUGIN_SCENARIOS:-$DEFAULT_KITCHEN_SINK_SCENARIOS}"
if [[ "${BRANCH_KITCHEN_SINK_LIVE_CLAWHUB:-0}" = "1" ]]; then
  echo "The Branch Agent Kitchen Sink package is delisted from Seedbank; use the default fixture scenarios or npm scenarios." >&2
  exit 2
fi
MAX_MEMORY_MIB="$(
  if [[ -n "${BRANCH_KITCHEN_SINK_PLUGIN_MAX_MEMORY_MIB:-}" ]]; then
    docker_e2e_read_nonnegative_decimal_env BRANCH_KITCHEN_SINK_PLUGIN_MAX_MEMORY_MIB 2304
  else
    docker_e2e_read_nonnegative_decimal_env BRANCH_KITCHEN_SINK_MAX_MEMORY_MIB 2304
  fi
)"
MAX_CPU_PERCENT="$(docker_e2e_read_nonnegative_decimal_env BRANCH_KITCHEN_SINK_MAX_CPU_PERCENT 1200)"
DOCKER_RUN_TIMEOUT="${BRANCH_KITCHEN_SINK_PLUGIN_DOCKER_RUN_TIMEOUT:-1200s}"
KITCHEN_SINK_CLI_TIMEOUT="${BRANCH_KITCHEN_SINK_PLUGIN_CLI_TIMEOUT:-${KITCHEN_SINK_CLI_TIMEOUT:-180s}}"
CONTAINER_NAME="branch-kitchen-sink-plugin-e2e-$$"
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/branch-kitchen-sink-plugin.XXXXXX")"
STATS_LOG="$(mktemp "${TMPDIR:-/tmp}/branch-kitchen-sink-plugin-stats.XXXXXX")"

cleanup() {
  docker_e2e_docker_cmd rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$RUN_LOG" "$STATS_LOG"
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" kitchen-sink-plugin

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "BRANCH_CLAWHUB_FIXTURE_WAIT_ATTEMPTS=$GROVE_HUB_FIXTURE_WAIT_ATTEMPTS"
  -e "BRANCH_DOCKER_E2E_LOG_PRINT_BYTES=$BRANCH_DOCKER_E2E_LOG_PRINT_BYTES"
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64"
  -e "KITCHEN_SINK_SCENARIOS=$KITCHEN_SINK_SCENARIOS"
  -e "KITCHEN_SINK_CLI_TIMEOUT=$KITCHEN_SINK_CLI_TIMEOUT"
)
capability_status=0
branch_resolve_frozen_plugin_harness_capabilities \
  "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" || capability_status=$?
[ "$capability_status" -eq 0 ] || exit "$capability_status"
branch_append_frozen_plugin_harness_docker_env

echo "Running kitchen-sink plugin Docker E2E..."
docker_e2e_docker_cmd rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker_e2e_harness_mount_args
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run --name "$CONTAINER_NAME" "${DOCKER_E2E_HARNESS_ARGS[@]}" "${DOCKER_ENV_ARGS[@]}" -v "$KITCHEN_SINK_ASSERTIONS:/app/scripts/e2e/lib/kitchen-sink-plugin/assertions.mjs:ro" -i "$IMAGE_NAME" bash scripts/e2e/lib/kitchen-sink-plugin/sweep.sh \
  >"$RUN_LOG" 2>&1 &
docker_pid="$!"

docker_e2e_sample_stats_until_exit \
  "$CONTAINER_NAME" \
  "$docker_pid" \
  "$STATS_LOG" \
  "$RUN_LOG" \
  "Kitchen-sink plugin Docker E2E" \
  "${BRANCH_DOCKER_E2E_STATS_HEARTBEAT_SECONDS:-30}"

set +e
wait "$docker_pid"
run_status="$?"
set -e

docker_e2e_print_log "$RUN_LOG"

if [ "$run_status" -eq 0 ]; then
  node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink
elif [ -s "$STATS_LOG" ]; then
  if ! node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink; then
    echo "RESOURCE_CEILING_FAILED lane=kitchen-sink primary_status=$run_status" >&2
  fi
fi

exit "$run_status"
