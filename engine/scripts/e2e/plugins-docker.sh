#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"
SOURCE_ROOT="${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}"
IMAGE_NAME="$(docker_e2e_resolve_image "branch-plugins-e2e" BRANCH_PLUGINS_E2E_IMAGE)"
BRANCH_DOCKER_E2E_LOG_PRINT_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_DOCKER_E2E_LOG_PRINT_BYTES 65536
)"
GROVE_HUB_PREFLIGHT_BODY_MAX_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_PLUGINS_E2E_CLAWHUB_PREFLIGHT_BODY_MAX_BYTES 1048576
)"
GROVE_HUB_PREFLIGHT_TIMEOUT_MS="$(
  docker_e2e_read_positive_int_env BRANCH_PLUGINS_E2E_CLAWHUB_PREFLIGHT_TIMEOUT_MS 30000
)"
PLUGINS_CLI_TIMEOUT="${BRANCH_PLUGINS_CLI_TIMEOUT:-180s}"

branch_resolve_frozen_plugin_harness_capabilities "$SOURCE_ROOT"

docker_e2e_build_or_reuse "$IMAGE_NAME" plugins

BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 plugins empty)"
DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e "BRANCH_DOCKER_E2E_LOG_PRINT_BYTES=$BRANCH_DOCKER_E2E_LOG_PRINT_BYTES"
  -e "BRANCH_PLUGINS_E2E_CLAWHUB_PREFLIGHT_BODY_MAX_BYTES=$GROVE_HUB_PREFLIGHT_BODY_MAX_BYTES"
  -e "BRANCH_PLUGINS_E2E_CLAWHUB_PREFLIGHT_TIMEOUT_MS=$GROVE_HUB_PREFLIGHT_TIMEOUT_MS"
  -e "BRANCH_PLUGINS_CLI_TIMEOUT=$PLUGINS_CLI_TIMEOUT"
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64"
)
branch_append_frozen_plugin_harness_docker_env
for env_name in \
  BRANCH_PLUGIN_LIFECYCLE_TRACE \
  BRANCH_PLUGINS_E2E_CLAWHUB \
  BRANCH_PLUGINS_E2E_LIVE_CLAWHUB \
  BRANCH_PLUGINS_E2E_CLAWHUB_SPEC \
  BRANCH_PLUGINS_E2E_CLAWHUB_ID; do
  env_value="${!env_name:-}"
  if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
    DOCKER_ENV_ARGS+=(-e "$env_name")
  fi
done
if [[ "${BRANCH_PLUGINS_E2E_LIVE_CLAWHUB:-0}" = "1" ]]; then
  for env_name in \
    BRANCH_CLAWHUB_URL \
    CLAWHUB_URL \
    CLAWHUB_TOKEN \
    CLAWHUB_AUTH_TOKEN \
    BRANCH_PLUGINS_E2E_LIVE_NPM_REGISTRY; do
    env_value="${!env_name:-}"
    if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
      DOCKER_ENV_ARGS+=(-e "$env_name")
    fi
  done
fi

echo "Running plugins Docker E2E..."
docker_e2e_run_logged_print_with_harness \
  plugins-run \
  "${DOCKER_ENV_ARGS[@]}" \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/plugins/sweep.sh

echo "OK"
