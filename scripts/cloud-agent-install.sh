#!/usr/bin/env bash
# Install the Node and pnpm versions CI uses so agent VMs can build .mts files
# and run `pnpm proof`. Idempotent; does not fail when a newer patch is already
# present.
set -euo pipefail

NODE_VERSION=24.19.0
PNPM_VERSION=12.5.1

current_node="$(node -v 2>/dev/null || true)"
current_node="${current_node#v}"
need_node=1
if [[ "$current_node" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  patch="${BASH_REMATCH[3]}"
  if (( major > 24 || (major == 24 && minor > 19) || (major == 24 && minor == 19 && patch >= 0) )); then
    if (( major == 24 )); then
      need_node=0
    fi
  fi
fi

if (( need_node )); then
  echo "Installing Node ${NODE_VERSION} into /usr/local (was ${current_node:-missing})"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | sudo tar -xJ -C /usr/local --strip-components=1 --no-same-owner
fi

if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm --version)" != "$PNPM_VERSION" ]]; then
  echo "Installing pnpm ${PNPM_VERSION}"
  sudo npm install --global "pnpm@${PNPM_VERSION}"
fi

echo "Toolchain: node $(node -v) pnpm $(pnpm --version)"
