#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Proves hosted npm installation plus dedicated-prefix source installation.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_ROOT="${BRANCH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "branch-cli-installer-distribution:local")"
PACKAGE_TGZ="$(
  docker_e2e_prepare_package_tgz cli-installer-distribution "${BRANCH_CURRENT_PACKAGE_TGZ:-}"
)"
docker_e2e_package_mount_args "$PACKAGE_TGZ"
HOSTED_PROOF_CONTAINER="branch-hosted-installer-proof-$$"
SOURCE_PROOF_CONTAINER="branch-source-installer-proof-$$"
SOURCE_BUNDLE="$(mktemp "${TMPDIR:-/tmp}/branch-source.XXXXXX.bundle")"
SOURCE_PROOF_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/branch-source-proof.XXXXXX.sh")"
SOURCE_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
SOURCE_MEMORY="${BRANCH_CLI_INSTALLER_SOURCE_MEMORY:-16g}"

cleanup() {
  docker_e2e_docker_cmd rm -f \
    "$HOSTED_PROOF_CONTAINER" \
    "$SOURCE_PROOF_CONTAINER" >/dev/null 2>&1 || true
  docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  rm -f "$SOURCE_BUNDLE" "$SOURCE_PROOF_SCRIPT"
}
trap cleanup EXIT

git -C "$SOURCE_ROOT" bundle create "$SOURCE_BUNDLE" HEAD
cat >"$SOURCE_PROOF_SCRIPT" <<'SOURCE_PROOF'
#!/usr/bin/env bash
set -euo pipefail

test -r "$0"
test -x "$0"
command -v curl >/dev/null
git clone -q /tmp/branch-source.bundle /tmp/branch-source
git -C /tmp/branch-source checkout -q --detach "$BRANCH_SOURCE_SHA"
bash /tmp/branch-source/scripts/install-cli.sh \
  --install-method git \
  --git-dir /tmp/branch-source \
  --version "$BRANCH_SOURCE_SHA" \
  --no-git-update \
  --prefix /tmp/branch-prefix \
  --node-version 24.21.0 \
  --no-onboard

prefix_node=/tmp/branch-prefix/tools/node/bin/node
prefix_cli=/tmp/branch-prefix/bin/branch
test -x "$prefix_node"
test -x "$prefix_cli"
grep -Fq "exec \"$prefix_node\"" "$prefix_cli"
grep -Fq "/tmp/branch-source/dist/entry.js" "$prefix_cli"
export PATH="/tmp/branch-prefix/bin:$PATH"
test "$(command -v branch)" = "$prefix_cli"
test "$(git -C /tmp/branch-source rev-parse HEAD)" = "$BRANCH_SOURCE_SHA"
branch_version="$(branch --version)"
branch --help >/tmp/branch-help
test -s /tmp/branch-help
status_json="$(branch update status --json)"
STATUS_JSON="$status_json" node -e "
  const status = JSON.parse(process.env.STATUS_JSON);
  if (status.update?.installKind !== \"git\") {
    throw new Error(\`expected git install kind, got \${status.update?.installKind}\`);
  }
"
printf "prefixNode=%s@%s\n" "$prefix_node" "$("$prefix_node" --version)"
printf "prefixBranch=%s@%s\n" "$prefix_cli" "$branch_version"
printf "sourceHead=%s installKind=git\n" "$BRANCH_SOURCE_SHA"
printf "sourceOnboard=disabled\n"
touch /tmp/branch-proof-ready
exec sleep infinity
SOURCE_PROOF
chmod 0555 "$SOURCE_PROOF_SCRIPT"

docker_e2e_build_or_reuse \
  "$IMAGE_NAME" \
  cli-installer-distribution \
  "$ROOT_DIR/scripts/e2e/Dockerfile" \
  "$ROOT_DIR" \
  bare

echo "==> Hosted install.sh exact-candidate proof"
docker_e2e_docker_run_cmd run -d \
  --name "$HOSTED_PROOF_CONTAINER" \
  -e HOME=/tmp/branch-hosted-home \
  -e BRANCH_NO_ONBOARD=1 \
  -e BRANCH_NO_PROMPT=1 \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -v "$SOURCE_ROOT/scripts/install.sh:/tmp/install.sh:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    mkdir -p "$HOME"
    bash /tmp/install.sh \
      --install-method npm \
      --version file:/tmp/branch-current.tgz \
      --no-onboard \
      --no-prompt
    source "$HOME/.bashrc"
    hash -r
    branch_path="$(command -v branch)"
    test -n "$branch_path"
    node_path="$(command -v node)"
    node_version="$(node --version)"
    branch_version="$(branch --version)"
    branch --help >/tmp/branch-help
    test -s /tmp/branch-help
    printf "hostedNode=%s@%s\n" "$node_path" "$node_version"
    printf "hostedBranch=%s@%s\n" "$branch_path" "$branch_version"
    printf "hostedOnboard=disabled\n"
    touch /tmp/branch-proof-ready
    exec sleep infinity
  ' >/dev/null

# A full source install builds every workspace package; the shared 8g cap OOMs before wrapper creation.
echo "==> install-cli.sh dedicated-prefix source-checkout proof"
docker_e2e_docker_run_cmd run -d \
  --name "$SOURCE_PROOF_CONTAINER" \
  --memory "$SOURCE_MEMORY" \
  -e HOME=/tmp/branch-source-home \
  -e BRANCH_NO_ONBOARD=1 \
  -e BRANCH_NO_PROMPT=1 \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e "BRANCH_SOURCE_SHA=$SOURCE_SHA" \
  --user root \
  -v "$SOURCE_BUNDLE:/tmp/branch-source.bundle:ro" \
  -v "$SOURCE_PROOF_SCRIPT:/tmp/source-proof.sh:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    rm -f -- /node_modules
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl
    rm -rf /var/lib/apt/lists/*
    command -v curl >/dev/null
    install -d -o appuser -g appuser "$HOME"
    exec runuser -u appuser -- env \
      HOME="$HOME" \
      BRANCH_NO_ONBOARD="$BRANCH_NO_ONBOARD" \
      BRANCH_NO_PROMPT="$BRANCH_NO_PROMPT" \
      COREPACK_ENABLE_DOWNLOAD_PROMPT="$COREPACK_ENABLE_DOWNLOAD_PROMPT" \
      BRANCH_SOURCE_SHA="$BRANCH_SOURCE_SHA" \
      bash /tmp/source-proof.sh
  ' >/dev/null

docker_e2e_wait_for_proof "$HOSTED_PROOF_CONTAINER" 1200
docker logs "$HOSTED_PROOF_CONTAINER"
docker_e2e_wait_for_proof "$SOURCE_PROOF_CONTAINER" 1200
docker logs "$SOURCE_PROOF_CONTAINER"
echo "CLI installer distribution proof passed."
