#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Runs the Branch Agent first-run Docker smoke against the package-installed
# functional E2E image, with only the test harness mounted from the checkout.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "branch-system-agent-first-run-e2e" BRANCH_SYSTEM_AGENT_FIRST_RUN_E2E_IMAGE)"
CONTAINER_NAME="branch-system-agent-first-run-e2e-$$"
RUN_LOG="$(mktemp -t branch-system-agent-first-run-log.XXXXXX)"

trap 'docker_e2e_cleanup_container_run "$CONTAINER_NAME" "$RUN_LOG"' EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" system-agent-first-run
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 system-agent-first-run empty)"

echo "Running in-container Branch Agent first-run smoke..."
# Harness files are mounted read-only; the app under test comes from /app/dist.
set +e
docker_e2e_run_with_harness \
  --name "$CONTAINER_NAME" \
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64" \
  -e "BRANCH_SUPERVISOR_MODE=external" \
  "$IMAGE_NAME" \
  bash -lc "set -euo pipefail
    source scripts/lib/branch-e2e-instance.sh
    branch_e2e_eval_test_state_from_b64 \"\${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}\"
    node scripts/e2e/lib/run-with-pty.mjs /dev/null tsx test/e2e/qa-lab/runtime/system-agent-first-run-docker-client.ts
  " >"$RUN_LOG" 2>&1
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "Docker Branch Agent first-run smoke failed"
  docker_e2e_print_log "$RUN_LOG"
  exit "$status"
fi
if grep -Fq '[run-with-pty output truncated after ' "$RUN_LOG"; then
  echo "Docker Branch Agent first-run smoke output was truncated"
  docker_e2e_print_log "$RUN_LOG"
  exit 1
fi

docker_e2e_print_log "$RUN_LOG"
echo "OK"
