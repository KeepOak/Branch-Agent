#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Runs the Branch Agent rescue-message Docker smoke against the package-installed
# functional E2E image, with only the test harness mounted from the checkout.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
IMAGE_NAME="$(docker_e2e_resolve_image "branch-system-agent-rescue-e2e" BRANCH_SYSTEM_AGENT_RESCUE_E2E_IMAGE)"
CONTAINER_NAME="branch-system-agent-rescue-e2e-$$"
RUN_LOG="$(mktemp -t branch-system-agent-rescue-log.XXXXXX)"

trap 'docker_e2e_cleanup_container_run "$CONTAINER_NAME" "$RUN_LOG"' EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" system-agent-rescue
BRANCH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 system-agent-rescue empty)"

echo "Running in-container Branch Agent rescue smoke..."
# Harness files are mounted read-only; the app under test comes from /app/dist.
set +e
docker_e2e_run_with_harness \
  --name "$CONTAINER_NAME" \
  -e "BRANCH_TEST_STATE_SCRIPT_B64=$BRANCH_TEST_STATE_SCRIPT_B64" \
  -e "BRANCH_GATEWAY_TOKEN=system-agent-rescue-token" \
  "$IMAGE_NAME" \
  bash -lc "set -euo pipefail
    source scripts/lib/branch-e2e-instance.sh
    branch_e2e_eval_test_state_from_b64 \"\${BRANCH_TEST_STATE_SCRIPT_B64:?missing BRANCH_TEST_STATE_SCRIPT_B64}\"
    tsx scripts/e2e/system-agent-rescue-docker-client.ts
  " >"$RUN_LOG" 2>&1
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "Docker Branch Agent rescue smoke failed"
  docker_e2e_print_log "$RUN_LOG"
  exit "$status"
fi

docker_e2e_print_log "$RUN_LOG"
echo "OK"
