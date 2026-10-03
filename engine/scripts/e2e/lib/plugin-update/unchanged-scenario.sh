#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/branch-e2e-instance.sh

branch_e2e_eval_test_state_from_b64 "${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}"
branch_e2e_install_package /tmp/branch-install.log "mounted Branch Agent package" /tmp/npm-prefix

package_root="$(branch_e2e_package_root /tmp/npm-prefix)"
entry="$(branch_e2e_package_entrypoint "$package_root")"
probe="scripts/e2e/lib/plugin-update/probe.mjs"
export PATH="/tmp/npm-prefix/bin:$PATH"

node "$probe" seed

registry_port_file=/tmp/branch-e2e-registry.port
rm -f "$registry_port_file"
node scripts/e2e/lib/plugin-update/registry-server.mjs "$registry_port_file" >/tmp/branch-e2e-registry.log 2>&1 &
registry_pid=$!
trap 'branch_e2e_stop_process "${registry_pid:-}"' EXIT
for _ in $(seq 1 50); do
  if [ -s "$registry_port_file" ]; then
    break
  fi
  sleep 0.1
done
if [ ! -s "$registry_port_file" ]; then
  echo "Local npm metadata registry did not expose a port"
  branch_e2e_print_log /tmp/branch-e2e-registry.log
  exit 1
fi
export NPM_CONFIG_REGISTRY="http://127.0.0.1:$(cat "$registry_port_file")"
export npm_config_registry="$NPM_CONFIG_REGISTRY"

if ! node "$probe" wait-registry; then
  echo "Local npm metadata registry failed to start"
  branch_e2e_print_log /tmp/branch-e2e-registry.log
  exit 1
fi

before_config_hash="$(sha256sum "$BRANCH_CONFIG_PATH" | awk '{print $1}')"
plugin_update_timeout_seconds="$(branch_e2e_read_positive_int_env BRANCH_PLUGIN_UPDATE_TIMEOUT_SECONDS 180)"

node "$probe" snapshot > /tmp/plugin-update-before.json

set +e
branch_e2e_maybe_timeout "${plugin_update_timeout_seconds}s" node "$entry" plugins update lossless-grove > /tmp/plugin-update-output.log 2>&1
plugin_update_status=$?
set -e
if [ "$plugin_update_status" -ne 0 ]; then
  echo "Plugin update command failed or timed out after ${plugin_update_timeout_seconds}s (status ${plugin_update_status})"
  echo "--- plugin update output ---"
  branch_e2e_print_log /tmp/plugin-update-output.log
  echo "--- local registry output ---"
  branch_e2e_print_log /tmp/branch-e2e-registry.log
  exit "$plugin_update_status"
fi

after_config_hash="$(sha256sum "$BRANCH_CONFIG_PATH" | awk '{print $1}')"
if [ "$before_config_hash" != "$after_config_hash" ]; then
  echo "Config changed unexpectedly during an unchanged plugin update"
  branch_e2e_print_log /tmp/plugin-update-output.log
  exit 1
fi

node "$probe" assert-snapshot /tmp/plugin-update-before.json
node "$probe" assert-output /tmp/plugin-update-output.log
branch_e2e_print_log /tmp/plugin-update-output.log
