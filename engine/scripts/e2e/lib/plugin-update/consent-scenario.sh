#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/branch-e2e-instance.sh
branch_e2e_eval_test_state_from_b64 "${BRANCH_TEST_STATE_SCRIPT_B64:?missing isolated state}"
branch_e2e_install_package /tmp/consent-install.log "mounted Branch Agent package" /tmp/consent-prefix
package_root="$(branch_e2e_package_root /tmp/consent-prefix)"
entry="$(branch_e2e_package_entrypoint "$package_root")"
export PATH="/tmp/consent-prefix/bin:$PATH"
export NPM_CONFIG_PREFIX=/tmp/consent-prefix
node scripts/e2e/lib/plugin-update/probe.mjs consent "$entry" "$BRANCH_CURRENT_PACKAGE_TGZ"
