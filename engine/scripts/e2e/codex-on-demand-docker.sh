#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Installs Branch Agent and Codex from npm artifacts with explicit capability consent,
# then verifies OpenAI onboarding, managed dependencies, and doctor in Docker.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/docker-e2e-package.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
CODEX_ASSERTIONS="$(branch_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/codex-on-demand/assertions.mjs \
  "$ROOT_DIR/scripts/e2e/lib/codex-on-demand/assertions.mjs")"
CODEX_DOCTOR_CHECKS="$(branch_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/codex-on-demand/doctor-checks.mjs \
  "$ROOT_DIR/scripts/e2e/lib/codex-on-demand/doctor-checks.mjs" \
  "")"
CODEX_DOCTOR_CHECKS_ENABLED=0
if [ -n "$CODEX_DOCTOR_CHECKS" ]; then
  CODEX_DOCTOR_CHECKS_ENABLED=1
fi

IMAGE_NAME="$(docker_e2e_resolve_image "branch-codex-on-demand-e2e" BRANCH_CODEX_ON_DEMAND_E2E_IMAGE)"
DOCKER_TARGET="${BRANCH_CODEX_ON_DEMAND_DOCKER_TARGET:-bare}"
HOST_BUILD="${BRANCH_CODEX_ON_DEMAND_HOST_BUILD:-1}"
PACKAGE_TGZ="${BRANCH_CURRENT_PACKAGE_TGZ:-}"
AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT=""
run_log=""

# This lane installs the package and then exercises a managed npm install of Codex.
# Keep the package install budget above the shared default so slow npm hosts reach
# the Codex assertions instead of failing as a silent package-install timeout.
export BRANCH_E2E_NPM_INSTALL_TIMEOUT="${BRANCH_E2E_NPM_INSTALL_TIMEOUT:-1200s}"

cleanup() {
  if [ -n "${PACKAGE_TGZ:-}" ]; then
    docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  fi
  if [ -n "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" ]; then
    rm -rf "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT"
  fi
  if [ -n "${run_log:-}" ]; then
    rm -f "$run_log"
  fi
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" codex-on-demand "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "$DOCKER_TARGET"

prepare_package_tgz() {
  if [ -n "$PACKAGE_TGZ" ]; then
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz codex-on-demand "$PACKAGE_TGZ")"
    return 0
  fi
  if [ "$HOST_BUILD" = "0" ] && [ -z "${BRANCH_CURRENT_PACKAGE_TGZ:-}" ]; then
    echo "BRANCH_CODEX_ON_DEMAND_HOST_BUILD=0 requires BRANCH_CURRENT_PACKAGE_TGZ" >&2
    exit 1
  fi
  PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz codex-on-demand)"
}

prepare_package_tgz

if [ -z "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ] &&
  [ -z "${BRANCH_CURRENT_PACKAGE_TGZ:-}" ] &&
  [ "$HOST_BUILD" != "0" ]; then
  AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT="$(
    mktemp -d "${TMPDIR:-/tmp}/branch-codex-on-demand-plugin-registry.XXXXXX"
  )"
  BRANCH_DOCKER_ALL_LANES=codex-on-demand \
    BRANCH_DOCKER_ALL_LOG_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" \
    BRANCH_DOCKER_ALL_TIMINGS=0 \
    node "$ROOT_DIR/scripts/test-docker-all.mjs" --prepare-plugin-registry >/dev/null
  export BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT/prepublish-plugin-registry"
fi

docker_e2e_package_mount_args "$PACKAGE_TGZ"
run_log="$(docker_e2e_run_log codex-on-demand)"
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 codex-on-demand empty)"
CODEX_CONTRACT_MOUNT_ARGS=(
  -v "$CODEX_ASSERTIONS:/app/scripts/e2e/lib/codex-on-demand/assertions.mjs:ro"
)
if [ -n "$CODEX_DOCTOR_CHECKS" ]; then
  CODEX_CONTRACT_MOUNT_ARGS+=(
    -v "$CODEX_DOCTOR_CHECKS:/app/scripts/e2e/lib/codex-on-demand/doctor-checks.mjs:ro"
  )
fi

echo "Running Codex on-demand Docker E2E..."
if ! docker_e2e_run_with_harness \
  -v "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}/extensions/codex/package.json:/tmp/branch-candidate-codex-package.json:ro" \
  "${CODEX_CONTRACT_MOUNT_ARGS[@]}" \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e "BRANCH_CODEX_DOCTOR_CHECKS_ENABLED=$CODEX_DOCTOR_CHECKS_ENABLED" \
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64" \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -i "$IMAGE_NAME" bash -s >"$run_log" 2>&1 <<'EOF'; then
set -euo pipefail

source scripts/lib/branch-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
branch_e2e_eval_test_state_from_b64 "${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$XDG_CACHE_HOME/npm}"
export npm_config_cache="$NPM_CONFIG_CACHE"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export OPENAI_API_KEY="sk-branch-codex-on-demand-e2e"

dump_debug_logs() {
  local status="$1"
  echo "Codex on-demand scenario failed with exit code $status" >&2
  branch_e2e_dump_logs \
    /tmp/branch-install.log \
    /tmp/branch-codex-plugin-install.log \
    /tmp/branch-codex-registry/server.log \
    /tmp/branch-onboard.json \
    /tmp/branch-plugins-list.json \
    /tmp/branch-codex-inspect.json
}
trap 'status=$?; dump_debug_logs "$status"; exit "$status"' ERR

plugin_registry_pid=""
cleanup_inner() {
  branch_e2e_stop_process "${plugin_registry_pid:-}"
}
trap cleanup_inner EXIT

configure_plugin_registry() {
  branch_prepublish_plugin_registry_start_mounted \
    /tmp/branch-codex-registry plugin_registry_pid '["@branch/codex"]'
}

mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE" || true

branch_e2e_install_package /tmp/branch-install.log
command -v branch >/dev/null
branch_e2e_enable_branch_cli_timeout

branch_e2e_assert_dep_absent "@branch/codex" "$HOME/.branch" "$NPM_CONFIG_PREFIX"
branch_e2e_assert_dep_absent "@openai/codex" "$HOME/.branch" "$NPM_CONFIG_PREFIX"

configure_plugin_registry

# Non-interactive onboarding cannot grant capabilities. Use the shared fixture
# consent flow and the exact companion when testing an unpublished candidate.
codex_install_args=("@branch/codex")
if [ -n "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  codex_install_args=("npm:@branch/codex@${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}" --pin)
fi
echo "Installing Codex on demand with explicit capability consent..."
branch_e2e_fixture_plugin_command branch -- plugins install "${codex_install_args[@]}" \
  >/tmp/branch-codex-plugin-install.log 2>&1

echo "Running non-interactive OpenAI onboarding with the accepted Codex plugin..."
branch onboard --non-interactive --accept-risk \
  --mode local \
  --auth-choice openai-api-key \
  --secret-input-mode ref \
  --skip-daemon \
  --skip-ui \
  --skip-channels \
  --skip-skills \
  --skip-health \
  --json >/tmp/branch-onboard.json

branch plugins list --json >/tmp/branch-plugins-list.json
branch plugins inspect codex --runtime --json >/tmp/branch-codex-inspect.json
node scripts/e2e/lib/codex-on-demand/assertions.mjs
if [ "$BRANCH_CODEX_DOCTOR_CHECKS_ENABLED" = "1" ]; then
  node scripts/e2e/lib/codex-on-demand/doctor-checks.mjs
fi

echo "Codex on-demand Docker E2E passed"
EOF
  docker_e2e_print_log "$run_log"
  exit 1
fi

docker_e2e_print_log "$run_log"
echo "Codex on-demand Docker E2E passed"
