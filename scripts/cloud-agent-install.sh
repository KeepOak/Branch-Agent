#!/usr/bin/env bash
# Install CI's Node (24.19.0) and the repo pnpm when the current Node is
# missing or older than the engine range floor (24.16.0). Leaves 24.16+,
# 25.x, and 26.1+ alone. Verifies the official SHASUMS256.txt line, extracts
# to an isolated prefix, and provisions pnpm through Corepack.
set -euo pipefail

CI_NODE_VERSION=24.19.0
PNPM_VERSION=12.5.1
NODE_RANGE_FLOOR=24.16.0

node_parse() {
  local raw="${1#v}"
  [[ "$raw" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+) ]] || return 1
  printf '%s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

# True when $1 >= $2.
node_ge() {
  local a1 a2 a3 b1 b2 b3
  read -r a1 a2 a3 < <(node_parse "$1") || return 1
  read -r b1 b2 b3 < <(node_parse "$2") || return 1
  (( a1 > b1 || (a1 == b1 && a2 > b2) || (a1 == b1 && a2 == b2 && a3 >= b3) ))
}

# Install only when Node is missing or older than >=24.16.0. 26.1+ is left alone.
node_needs_install() {
  local v="${1:-}"
  v="${v#v}"
  [[ -z "$v" ]] && return 0
  node_parse "$v" >/dev/null || return 0
  if node_ge "$v" "$NODE_RANGE_FLOOR"; then
    return 1
  fi
  return 0
}

run_priv() {
  if [[ -n "${BRANCH_NODE_NOSUDO:-}" ]] || ! command -v sudo >/dev/null 2>&1; then
    "$@"
    return
  fi
  local dest="${!#}"
  if [[ -e "$dest" && -w "$dest" ]] || [[ ! -e "$dest" && -w "$(dirname "$dest")" ]]; then
    "$@"
    return
  fi
  sudo "$@"
}

install_verified_node() {
  local os arch tarball base_url tmp parent extract_name prefix bindir
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo "unsupported OS $(uname -s) for Node bootstrap" >&2; return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "unsupported architecture $(uname -m) for Node bootstrap" >&2; return 1 ;;
  esac

  tarball="node-v${CI_NODE_VERSION}-${os}-${arch}.tar.xz"
  extract_name="${tarball%.tar.xz}"
  base_url="https://nodejs.org/dist/v${CI_NODE_VERSION}"
  parent="${BRANCH_NODE_PREFIX:-/usr/local/lib/nodejs}"
  prefix="${parent}/${extract_name}"
  bindir="${BRANCH_NODE_BIN:-/usr/local/bin}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/branch-node.XXXXXX")"

  echo "Installing Node ${CI_NODE_VERSION} into ${prefix}"
  curl -fsSL --connect-timeout 10 --max-time 120 --retry 2 --retry-delay 2 --retry-max-time 120 \
    "${base_url}/SHASUMS256.txt" -o "${tmp}/SHASUMS256.txt"
  curl -fsSL --connect-timeout 10 --max-time 120 --retry 2 --retry-delay 2 --retry-max-time 120 \
    "${base_url}/${tarball}" -o "${tmp}/${tarball}"
  (cd "$tmp" && grep "  ${tarball}$" SHASUMS256.txt | sha256sum -c -)

  run_priv mkdir -p "$parent"
  run_priv rm -rf "$prefix"
  run_priv tar -xJf "${tmp}/${tarball}" -C "$parent"
  rm -rf "$tmp"

  run_priv mkdir -p "$bindir"
  local tool
  for tool in node npm npx corepack; do
    run_priv ln -sfn "${prefix}/bin/${tool}" "${bindir}/${tool}"
  done
  export PATH="${prefix}/bin:${bindir}:$PATH"
  hash -r
}

ensure_pnpm() {
  local corepack_cmd
  corepack_cmd="$(command -v corepack || true)"
  if [[ -z "$corepack_cmd" ]]; then
    echo "corepack is missing after Node install; cannot provision pnpm ${PNPM_VERSION}" >&2
    return 1
  fi
  echo "Selecting pnpm ${PNPM_VERSION} via Corepack"
  if [[ -w "$(dirname "$(command -v node)")" ]]; then
    "$corepack_cmd" enable
    "$corepack_cmd" prepare "pnpm@${PNPM_VERSION}" --activate
  else
    sudo env PATH="$PATH" "$corepack_cmd" enable
    sudo env PATH="$PATH" "$corepack_cmd" prepare "pnpm@${PNPM_VERSION}" --activate
  fi
}

main() {
  local current
  current="$(node -v 2>/dev/null || true)"
  if [[ "${1:-}" == --check-node ]]; then
    if node_needs_install "$current"; then
      echo "needs-install ${current:-missing}"
    else
      echo "ok ${current}"
    fi
    return 0
  fi

  if node_needs_install "$current"; then
    install_verified_node
  else
    echo "Leaving Node ${current} in place (engine range >=${NODE_RANGE_FLOOR} <25 || >=26.1.0)"
  fi

  if ! command -v pnpm >/dev/null 2>&1 || [[ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
    ensure_pnpm
  fi

  echo "Toolchain: node $(node -v) pnpm $(pnpm --version)"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
