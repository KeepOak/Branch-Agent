#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Installs a prepared Branch Agent npm tarball in Docker, runs non-interactive
# onboarding for a channel, and verifies one mocked model turn through Gateway.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/docker-e2e-package.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
ONBOARD_ASSERTIONS="$(branch_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs \
  "$ROOT_DIR/scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs")"
ONBOARD_IDENTITY_ASSERTIONS="$(branch_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/npm-onboard-channel-agent/execution-identity.mjs \
  "$ROOT_DIR/scripts/e2e/lib/npm-onboard-channel-agent/execution-identity.mjs")"
# The assertion and its config producer are one target-owned contract; mixing
# generations can make a valid frozen package appear to change its default model.
ONBOARD_MOCK_OPENAI_CONFIG="$(branch_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/fixtures/mock-openai-config.mjs \
  "$ROOT_DIR/scripts/e2e/lib/fixtures/mock-openai-config.mjs")"

IMAGE_NAME="$(docker_e2e_resolve_image "branch-npm-onboard-channel-agent-e2e" BRANCH_NPM_ONBOARD_E2E_IMAGE)"
DOCKER_TARGET="${BRANCH_NPM_ONBOARD_DOCKER_TARGET:-bare}"
HOST_BUILD="${BRANCH_NPM_ONBOARD_HOST_BUILD:-1}"
PACKAGE_TGZ="${BRANCH_CURRENT_PACKAGE_TGZ:-}"
CHANNEL="${BRANCH_NPM_ONBOARD_CHANNEL:-telegram}"
USE_SOURCE_PLUGIN_PACKAGE="${BRANCH_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE:-0}"
JSON_ARTIFACT_MAX_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_NPM_ONBOARD_JSON_ARTIFACT_MAX_BYTES 1048576
)"
STATUS_TEXT_MAX_BYTES="$(
  docker_e2e_read_positive_int_env BRANCH_NPM_ONBOARD_STATUS_TEXT_MAX_BYTES 1048576
)"
run_log=""

cleanup() {
  if [ -n "${PACKAGE_TGZ:-}" ]; then
    docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  fi
  if [ -n "${run_log:-}" ]; then
    rm -f "$run_log"
  fi
}
trap cleanup EXIT

case "$CHANNEL" in
telegram | discord | slack) ;;
*)
  echo "BRANCH_NPM_ONBOARD_CHANNEL must be telegram, discord, or slack, got: $CHANNEL" >&2
  exit 1
  ;;
esac

docker_e2e_build_or_reuse "$IMAGE_NAME" npm-onboard-channel-agent "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "$DOCKER_TARGET"

prepare_package_tgz() {
  if [ -n "$PACKAGE_TGZ" ]; then
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz npm-onboard-channel-agent "$PACKAGE_TGZ")"
    return 0
  fi
  if [ "$HOST_BUILD" = "0" ] && [ -z "${BRANCH_CURRENT_PACKAGE_TGZ:-}" ]; then
    echo "BRANCH_NPM_ONBOARD_HOST_BUILD=0 requires BRANCH_CURRENT_PACKAGE_TGZ" >&2
    exit 1
  fi
  PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz npm-onboard-channel-agent)"
}

prepare_package_tgz

docker_e2e_package_mount_args "$PACKAGE_TGZ"
run_log="$(docker_e2e_run_log npm-onboard-channel-agent)"
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 npm-onboard-channel-agent empty)"

echo "Running npm tarball onboard/channel/agent Docker E2E ($CHANNEL)..."
if ! docker_e2e_run_with_harness \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e BRANCH_NPM_ONBOARD_CHANNEL="$CHANNEL" \
  -e BRANCH_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE="$USE_SOURCE_PLUGIN_PACKAGE" \
  -e "BRANCH_NPM_ONBOARD_JSON_ARTIFACT_MAX_BYTES=$JSON_ARTIFACT_MAX_BYTES" \
  -e "BRANCH_NPM_ONBOARD_STATUS_TEXT_MAX_BYTES=$STATUS_TEXT_MAX_BYTES" \
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64" \
  -v "$ONBOARD_ASSERTIONS:/app/scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs:ro" \
  -v "$ONBOARD_IDENTITY_ASSERTIONS:/app/scripts/e2e/lib/npm-onboard-channel-agent/execution-identity.mjs:ro" \
  -v "$ONBOARD_MOCK_OPENAI_CONFIG:/app/scripts/e2e/lib/fixtures/mock-openai-config.mjs:ro" \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -i "$IMAGE_NAME" bash -s >"$run_log" 2>&1 <<'EOF'; then
set -Eeuo pipefail

source scripts/lib/branch-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
branch_e2e_eval_test_state_from_b64 "${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}"
export BRANCH_TEST_STATE_HOME
identity_assertions=scripts/e2e/lib/npm-onboard-channel-agent/execution-identity.mjs
node "$identity_assertions" clean-home
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export OPENAI_API_KEY="sk-branch-npm-onboard-e2e"
export BRANCH_GATEWAY_TOKEN="npm-onboard-channel-agent-token"

CHANNEL="${BRANCH_NPM_ONBOARD_CHANNEL:?missing BRANCH_NPM_ONBOARD_CHANNEL}"
PORT="18789"
MOCK_PORT="44080"
SUCCESS_MARKER="BRANCH_AGENT_E2E_OK_ASSISTANT"
scenario_tmp="$(mktemp -d "${TMPDIR:-/tmp}/branch-npm-onboard-channel-agent.XXXXXX")"
MOCK_REQUEST_LOG="$scenario_tmp/mock-openai-requests.jsonl"
export SUCCESS_MARKER MOCK_REQUEST_LOG
mock_pid=""
plugin_registry_pid=""
gateway_pid=""

case "$CHANNEL" in
  telegram)
    CHANNEL_TOKEN="123456:branch-npm-onboard-token"
    DEP_SENTINEL="grammy"
    CHANNEL_ADD_ARGS=(--token "$CHANNEL_TOKEN")
    CHANNEL_CONFIG_TOKENS=("$CHANNEL_TOKEN")
    ;;
  discord)
    CHANNEL_TOKEN="branch-npm-onboard-discord-token"
    DEP_SENTINEL="discord-api-types"
    CHANNEL_ADD_ARGS=(--token "$CHANNEL_TOKEN")
    CHANNEL_CONFIG_TOKENS=("$CHANNEL_TOKEN")
    ;;
  slack)
    SLACK_BOT_TOKEN="xoxb-branch-npm-onboard-slack-token"
    SLACK_APP_TOKEN="xapp-branch-npm-onboard-slack-token"
    DEP_SENTINEL="@slack/bolt"
    CHANNEL_ADD_ARGS=(--bot-token "$SLACK_BOT_TOKEN" --app-token "$SLACK_APP_TOKEN")
    CHANNEL_CONFIG_TOKENS=("$SLACK_BOT_TOKEN" "$SLACK_APP_TOKEN")
    ;;
  *)
    echo "unsupported channel: $CHANNEL" >&2
    exit 1
    ;;
esac

cleanup() {
  branch_e2e_stop_process "${gateway_pid:-}"
  branch_e2e_stop_process "${mock_pid:-}"
  branch_e2e_stop_process "${plugin_registry_pid:-}"
  rm -rf "$scenario_tmp"
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "npm onboard/channel/agent scenario failed with exit code $status" >&2
  branch_e2e_dump_logs \
    /tmp/branch-install.log \
    /tmp/branch-codex-plugin-install.log \
    /tmp/branch-channel-plugin-install.log \
    /tmp/branch-onboard.json \
    /tmp/branch-channels-status.json \
    /tmp/branch-channels-status.err \
    /tmp/branch-status.txt \
    /tmp/branch-status.err \
    /tmp/branch-doctor.log \
    /tmp/branch-agent.combined \
    /tmp/branch-agent.err \
    /tmp/branch-agent.json \
    /tmp/branch-mock-openai.log \
    "$scenario_tmp/gateway-before.log" \
    "$scenario_tmp/gateway-after.log" \
    "$MOCK_REQUEST_LOG" \
    "$BRANCH_HOME/.branch/branch.json" \
    "$BRANCH_HOME/.branch/agents/main/agent/auth-profiles.json"
}
trap 'status=$?; dump_debug_logs "$status"; exit "$status"' ERR

required_plugins='["@branch/codex"]'
if [ "${BRANCH_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE:-0}" = "1" ] && [ "$CHANNEL" != "telegram" ]; then
  if [ -z "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    echo "source channel fixture requires BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR with the matching candidate companion" >&2
    exit 1
  fi
  required_plugins="[\"@branch/codex\",\"@branch/$CHANNEL\"]"
fi
if [ -n "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  branch_prepublish_plugin_registry_start_mounted \
    /tmp/branch-npm-onboard-plugin-registry plugin_registry_pid "$required_plugins"
fi

branch_e2e_install_package /tmp/branch-install.log

command -v branch >/dev/null
branch_e2e_enable_branch_cli_timeout
package_root="$(branch_e2e_package_root)"
if [ -d "$package_root/dist/extensions/$CHANNEL" ]; then
  CHANNEL_PACKAGE_MODE="bundled"
else
  CHANNEL_PACKAGE_MODE="external"
  echo "$CHANNEL is not packaged with core Branch Agent; its plugin must be installed before channel configuration."
fi

# Older packages own their automatic setup; consent support, not a version,
# establishes whether this fixture must explicitly preinstall required plugins.
plugin_install_help="$(branch plugins install --help)"
fixture_consent="$(printf '%s' "$plugin_install_help" | node scripts/e2e/lib/package-compat.mjs fixture-consent)"
if [ -n "$fixture_consent" ]; then
  codex_install_args=(codex)
  if [ -n "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    candidate_version="${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}"
    codex_install_args=("npm:@branch/codex@$candidate_version" --pin)
  fi
  # Published packages use the official catalog's source selection;
  # mounted candidates use only the exact companion verified above.
  branch_e2e_fixture_plugin_command branch -- plugins install "${codex_install_args[@]}" \
    >/tmp/branch-codex-plugin-install.log 2>&1
fi

mock_pid="$(branch_e2e_start_mock_openai "$MOCK_PORT" /tmp/branch-mock-openai.log)"
branch_e2e_wait_mock_openai "$MOCK_PORT"

echo "Running non-interactive onboarding..."
branch onboard --non-interactive --accept-risk \
  --mode local \
  --auth-choice openai-api-key \
  --secret-input-mode ref \
  --gateway-port "$PORT" \
  --gateway-bind loopback \
  --skip-daemon \
  --skip-ui \
  --skip-skills \
  --skip-health \
  --json >/tmp/branch-onboard.json

node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-onboard-state "$HOME"

branch_e2e_assert_dep_absent "$DEP_SENTINEL" "$HOME/.branch"

if [ "$CHANNEL_PACKAGE_MODE" = "external" ] && [ -n "$fixture_consent" ]; then
  channel_install_args=("$CHANNEL")
  if [ "${BRANCH_NPM_ONBOARD_USE_SOURCE_PLUGIN_PACKAGE:-0}" = "1" ] && [ "$CHANNEL" != "telegram" ]; then
    # The verified registry preserves candidate bytes through the official npm
    # installer; a local archive would not establish official plugin provenance.
    channel_install_args=("npm:@branch/$CHANNEL@$candidate_version" --pin)
  fi
  branch_e2e_fixture_plugin_command branch -- plugins install "${channel_install_args[@]}" \
    >/tmp/branch-channel-plugin-install.log 2>&1
fi

echo "Configuring $CHANNEL..."
branch_e2e_run_logged channel-add "$BRANCH_E2E_CLI_BIN" channels add --channel "$CHANNEL" "${CHANNEL_ADD_ARGS[@]}"
node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-channel-config "$CHANNEL" "${CHANNEL_CONFIG_TOKENS[@]}"

echo "Checking status surfaces for $CHANNEL..."
branch channels status --json >/tmp/branch-channels-status.json 2>/tmp/branch-channels-status.err
branch status >/tmp/branch-status.txt 2>/tmp/branch-status.err
node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-status-surfaces "$CHANNEL" /tmp/branch-channels-status.json /tmp/branch-status.txt

echo "Running doctor after channel activation..."
branch doctor --repair --non-interactive >/tmp/branch-doctor.log 2>&1
if [ "$CHANNEL_PACKAGE_MODE" = "external" ]; then
  branch_e2e_assert_dep_present "$DEP_SENTINEL" "$HOME/.branch"
else
  branch_e2e_assert_dep_absent "$DEP_SENTINEL" "$HOME/.branch"
fi

node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs configure-mock-model "$MOCK_PORT"
node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-mock-model-config "$MOCK_PORT"
node "$identity_assertions" empty
branch config set logging.audit.enabled true
branch config set logging.audit.executionIdentity true

echo "Running local agent turn against mocked OpenAI..."
if branch agent --local \
  --agent main \
  --session-id npm-onboard-channel-agent \
  --message "Return the success marker from the test server." \
  --thinking off \
  --json >/tmp/branch-agent.combined 2>&1; then
  agent_status=0
else
  agent_status=$?
fi
if [ "$agent_status" -ne 0 ]; then
  dump_debug_logs "$agent_status"
  exit "$agent_status"
fi

node scripts/e2e/lib/npm-onboard-channel-agent/assertions.mjs assert-agent-turn "$SUCCESS_MARKER" "$MOCK_REQUEST_LOG"
run_id="$(node "$identity_assertions" run-id)"

# The local CLI flushes its audit writer before exiting. Inspect once after that
# boundary; polling a read-only inspector would hide lost admission writes.
entry="$(branch_e2e_package_entrypoint "$package_root")"
export BRANCH_SKIP_CHANNELS=1 BRANCH_SKIP_GMAIL_WATCHER=1 BRANCH_SKIP_CANVAS_HOST=1
gateway_pid="$(branch_e2e_start_gateway "$entry" "$PORT" "$scenario_tmp/gateway-before.log")"
branch_e2e_wait_gateway_ready "$gateway_pid" "$scenario_tmp/gateway-before.log" 300 "$PORT"
branch audit --run "$run_id" --explain --json >"$scenario_tmp/identity-before.json"
execution_id="$(node "$identity_assertions" verify "$scenario_tmp/identity-before.json")"
branch_e2e_stop_process "$gateway_pid"
gateway_pid=""
gateway_pid="$(branch_e2e_start_gateway "$entry" "$PORT" "$scenario_tmp/gateway-after.log")"
branch_e2e_wait_gateway_ready "$gateway_pid" "$scenario_tmp/gateway-after.log" 300 "$PORT"
branch audit --execution "$execution_id" --explain --json >"$scenario_tmp/identity-after.json"
node "$identity_assertions" verify "$scenario_tmp/identity-after.json" "$scenario_tmp/identity-before.json" >/dev/null
echo "Installed CLI execution identity survived Gateway restart with private fixture data omitted."

echo "npm tarball onboard/channel/agent Docker E2E passed for $CHANNEL"
EOF
  docker_e2e_print_log "$run_log"
  exit 1
fi

echo "npm tarball onboard/channel/agent Docker E2E passed ($CHANNEL)"
