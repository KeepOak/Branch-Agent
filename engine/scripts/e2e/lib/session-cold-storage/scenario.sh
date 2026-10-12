#!/usr/bin/env bash
set -euo pipefail
case "${BRANCH_FROZEN_TARGET_SESSION_COLD_STORAGE_MODE:-required}" in
  required) ;;
  unsupported)
    echo "NOT RUN: cold transcript storage is unavailable in the selected frozen target"
    exit 0
    ;;
  *) echo "invalid frozen session cold-storage mode" >&2; exit 2 ;;
esac
source scripts/lib/branch-e2e-instance.sh

proof_dir="$(mktemp -d /tmp/branch-cold-storage-e2e.XXXXXX)"
export HOME="$proof_dir/home"
export BRANCH_STATE_DIR="$proof_dir/state"
export BRANCH_CONFIG_PATH="$BRANCH_STATE_DIR/branch.json"
export BRANCH_TEST_WORKSPACE_DIR="$proof_dir/workspace"
export BRANCH_GATEWAY_TOKEN="cold-storage-e2e-token"
export BRANCH_SKIP_CHANNELS=1 BRANCH_SKIP_CRON=1 BRANCH_SKIP_CANVAS_HOST=1
export BRANCH_SKIP_GMAIL_WATCHER=1 BRANCH_DISABLE_BONJOUR=1
export PORT=18789
mkdir -p "$HOME" "$BRANCH_STATE_DIR" "$BRANCH_TEST_WORKSPACE_DIR"
entry="$(branch_e2e_resolve_entrypoint)"
gateway_pid=""
gateway_log="$proof_dir/gateway.log"
cleanup() {
  branch_e2e_stop_process "$gateway_pid"
  rm -rf "$proof_dir"
}
trap cleanup EXIT
dump_debug_logs() {
  branch_e2e_dump_logs "$gateway_log"
}
branch_e2e_enable_failure_diagnostics

client() { node scripts/e2e/lib/session-cold-storage/client.mjs "$1" "$entry" "$proof_dir"; }
start_gateway() {
  gateway_pid="$(branch_e2e_start_gateway "$entry" "$PORT" "$gateway_log")"
  branch_e2e_wait_gateway_ready "$gateway_pid" "$gateway_log" 300 "$PORT"
}
client seed
start_gateway
client exercise
kill -0 "$gateway_pid"
branch_e2e_stop_process "$gateway_pid"
start_gateway
client restart
branch_e2e_stop_process "$gateway_pid"
rm -rf "$BRANCH_STATE_DIR"
export BRANCH_STATE_DIR="$proof_dir/recovered"
export BRANCH_CONFIG_PATH="$BRANCH_STATE_DIR/branch.json"
start_gateway
client recovered
echo "Cold transcript storage Docker E2E passed"
