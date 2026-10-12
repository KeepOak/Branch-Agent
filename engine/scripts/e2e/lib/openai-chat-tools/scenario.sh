#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/branch-e2e-instance.sh
branch_e2e_eval_test_state_from_b64 "${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}"
export BRANCH_SKIP_CHANNELS=1
export BRANCH_SKIP_GMAIL_WATCHER=1
export BRANCH_SKIP_CRON=1
export BRANCH_SKIP_CANVAS_HOST=1
export BRANCH_SKIP_BROWSER_CONTROL_SERVER=1
export BRANCH_SKIP_ACPX_RUNTIME=1
export BRANCH_SKIP_ACPX_RUNTIME_PROBE=1
export BRANCH_AGENT_HARNESS_FALLBACK=none

for profile_path in "$HOME/.profile" /home/appuser/.profile; do
  if [ -f "$profile_path" ] && [ -r "$profile_path" ]; then
    set +e +u
    # shellcheck disable=SC1090
    source "$profile_path"
    set -euo pipefail
    break
  fi
done
if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "ERROR: OPENAI_API_KEY was not available after sourcing ~/.profile." >&2
  exit 1
fi
export OPENAI_API_KEY
if [ -n "${OPENAI_BASE_URL:-}" ]; then
  export OPENAI_BASE_URL
fi

PORT="${PORT:?missing PORT}"
TOKEN="${BRANCH_GATEWAY_TOKEN:?missing BRANCH_GATEWAY_TOKEN}"
MODEL_REF="${BRANCH_OPENAI_CHAT_TOOLS_MODEL:?missing BRANCH_OPENAI_CHAT_TOOLS_MODEL}"
GATEWAY_LOG="/tmp/branch-openai-chat-tools-gateway.log"
CLIENT_LOG="/tmp/branch-openai-chat-tools-client.log"
COLD_FIXTURE="$(mktemp /tmp/branch-openai-cold-fixture.XXXXXX)"
gateway_pid=""

cleanup() {
  branch_e2e_stop_process "$gateway_pid"
  rm -f "$COLD_FIXTURE"
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "OpenAI Chat Completions tools Docker E2E failed with exit code $status" >&2
  branch_e2e_dump_logs "$GATEWAY_LOG" "$CLIENT_LOG"
  if [ -f "$BRANCH_CONFIG_PATH" ]; then
    echo "--- $BRANCH_CONFIG_PATH keys ---" >&2
    node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.error(JSON.stringify({model:cfg.agents?.defaults?.model, tools:cfg.tools, provider:cfg.models?.providers?.openai && {api:cfg.models.providers.openai.api, baseUrl:cfg.models.providers.openai.baseUrl, agentRuntime:cfg.models.providers.openai.agentRuntime}}, null, 2));" "$BRANCH_CONFIG_PATH" || true
  fi
}
branch_e2e_enable_failure_diagnostics

entry="$(branch_e2e_resolve_entrypoint)"
mkdir -p "$BRANCH_STATE_DIR" "$BRANCH_TEST_WORKSPACE_DIR"

node scripts/e2e/lib/openai-chat-tools/write-config.mjs
if [ "${BRANCH_FROZEN_TARGET_SESSION_COLD_STORAGE_MODE:-required}" = required ]; then
  node scripts/e2e/lib/openai-chat-tools/cold-recall.mjs seed "$entry" "$COLD_FIXTURE"
fi

gateway_pid="$(branch_e2e_start_gateway "$entry" "$PORT" "$GATEWAY_LOG")"
for _ in $(seq 1 360); do
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "gateway exited before listening" >&2
    branch_e2e_print_log "$GATEWAY_LOG" >&2
    exit 1
  fi
  if node "$entry" gateway health \
    --url "ws://127.0.0.1:$PORT" \
    --token "$TOKEN" \
    --timeout 120000 \
    --json >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
node "$entry" gateway health \
  --url "ws://127.0.0.1:$PORT" \
  --token "$TOKEN" \
  --timeout 120000 \
  --json >/dev/null

PORT="$PORT" BRANCH_GATEWAY_TOKEN="$TOKEN" MODEL_REF="$MODEL_REF" \
  node scripts/e2e/lib/openai-chat-tools/client.mjs >"$CLIENT_LOG" 2>&1
if [ "${BRANCH_FROZEN_TARGET_SESSION_COLD_STORAGE_MODE:-required}" = required ]; then
  PORT="$PORT" BRANCH_GATEWAY_TOKEN="$TOKEN" MODEL_REF="$MODEL_REF" \
    node scripts/e2e/lib/openai-chat-tools/cold-recall.mjs recall "$entry" "$COLD_FIXTURE" >>"$CLIENT_LOG" 2>&1
else
  echo "NOT RUN: cold transcript recall is unavailable in the selected frozen target" >>"$CLIENT_LOG"
fi

branch_e2e_print_log "$CLIENT_LOG"
echo "OpenAI Chat Completions tools Docker E2E passed"
