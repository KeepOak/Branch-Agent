#!/bin/sh
# Branch Agent one-line installer for macOS and Linux.
#
#   curl -fsSL https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.sh | sh
#   curl -fsSL https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.sh | sh -s -- --version v1.2.3
#
# It downloads the release's desktop package and SHA256SUMS, checks the package's SHA-256 against
# SHA256SUMS before touching the install, and installs for the current user only. It never uses sudo.
# Re-running replaces the install: the new copy is unpacked and verified beside the old one, then swapped in.
#
# BRANCH_INSTALL_BASE_URL is for tests only. It points the script at a local fixture release instead of
# https://github.com/KeepOak/Branch-Agent/releases. Do not set it for a real install. BRANCH_INSTALL_TEST_TARGET,
# also test-only and honoured only beside BRANCH_INSTALL_BASE_URL, runs another platform's install path.
set -eu

base_url=${BRANCH_INSTALL_BASE_URL:-https://github.com/KeepOak/Branch-Agent/releases}
version=${BRANCH_INSTALL_VERSION:-}

say() { printf '%s\n' "$*"; }
fail() { printf 'Branch Agent install failed: %s\n' "$*" >&2; exit 1; }

usage() {
  say "Usage: install.sh [--version <tag>]"
  say "Installs Branch Agent for the current user. Without --version it installs the latest release."
}

while [ $# -gt 0 ]; do
  case $1 in
    --version) [ $# -ge 2 ] || fail "--version needs a tag, for example v1.2.3"; version=$2; shift 2 ;;
    --version=*) version=${1#--version=}; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown option: $1" ;;
  esac
done

if [ "$(id -u)" = 0 ]; then
  fail "run this as your own user, not root. Branch Agent installs per user and needs no sudo."
fi

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported system $(uname -s). On Windows run: irm https://github.com/KeepOak/Branch-Agent/releases/latest/download/install.ps1 | iex" ;;
esac
case $(uname -m) in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) fail "unsupported processor $(uname -m)" ;;
esac
target=$os-$arch
if [ -n "${BRANCH_INSTALL_TEST_TARGET:-}" ]; then
  [ -n "${BRANCH_INSTALL_BASE_URL:-}" ] || fail "BRANCH_INSTALL_TEST_TARGET is for tests only"
  target=$BRANCH_INSTALL_TEST_TARGET os=${BRANCH_INSTALL_TEST_TARGET%-*}
fi
case $target in
  darwin-arm64|linux-x64) ;;
  darwin-x64) fail "Branch Agent ships for Apple silicon Macs only (no Intel build yet)" ;;
  *) fail "no Branch Agent build for $target yet" ;;
esac

if [ -n "$version" ]; then
  case $version in v*) tag=$version ;; *) tag=v$version ;; esac
  case $tag in
    v[0-9]*) ;;
    *) fail "invalid version $version" ;;
  esac
  download_url=$base_url/download/$tag
else
  tag=
  download_url=$base_url/latest/download
fi

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f 1
  else fail "shasum or sha256sum is required to verify the download"
  fi
}

fetch() {
  curl --fail --silent --show-error --location --retry 3 --proto '=https,file' --output "$2" "$1" \
    || fail "could not download $1"
}

# Which release asset this platform installs. The Linux AppImage replaces the tar.gz here later.
asset_pattern() {
  case $target in
    darwin-arm64) say "branch-desktop-[0-9][^ ]*-darwin-arm64[.]tar[.]gz" ;;
    linux-x64) say "branch-desktop-[0-9][^ ]*-linux-x64[.]tar[.]gz" ;;
  esac
}

work=$(mktemp -d "${TMPDIR:-/tmp}/branch-agent-install.XXXXXX") || fail "could not create a temporary folder"
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM

say "Branch Agent installer: $target, release ${tag:-latest}"
fetch "$download_url/SHA256SUMS" "$work/SHA256SUMS"

pattern=$(asset_pattern)
entry=$(awk -v pattern="^$pattern\$" 'NF == 2 && $2 ~ pattern { print; n++ } END { if (n != 1) exit 1 }' "$work/SHA256SUMS") \
  || fail "SHA256SUMS has no single entry for the $target desktop package; nothing was installed"
expected=$(printf '%s\n' "$entry" | cut -d ' ' -f 1)
asset=$(printf '%s\n' "$entry" | awk '{ print $2 }')
printf '%s\n' "$expected" | grep -Eq '^[0-9a-f]{64}$' || fail "SHA256SUMS entry for $asset is malformed; nothing was installed"
if [ -n "$tag" ]; then
  case $asset in
    *-"${tag#v}"-"$target".tar.gz) ;;
    *) fail "SHA256SUMS for $tag lists $asset, which is another version; nothing was installed" ;;
  esac
fi

say "Downloading $asset"
fetch "$download_url/$asset" "$work/$asset"
actual=$(sha256_of "$work/$asset")
if [ "$actual" != "$expected" ]; then
  printf 'Branch Agent install failed: SHA-256 mismatch for %s\n  expected %s\n  got      %s\nThe download is damaged or was tampered with. Nothing was installed.\n' "$asset" "$expected" "$actual" >&2
  exit 1
fi
say "Verified SHA-256 $actual"

mkdir "$work/unpacked"
tar -xzf "$work/$asset" -C "$work/unpacked" || fail "could not unpack $asset; nothing was installed"

# Swap a verified staging copy into place. The old install stays until the new one is in.
replace() {
  staged=$1 dest=$2
  mkdir -p "$(dirname "$dest")"
  if [ -e "$dest" ]; then
    rm -rf "$dest.install-old"
    mv "$dest" "$dest.install-old"
  fi
  if ! mv "$staged" "$dest"; then
    [ -e "$dest.install-old" ] && mv "$dest.install-old" "$dest"
    fail "could not move the new install into $dest"
  fi
  rm -rf "$dest.install-old"
}

# The designated requirement of the pinned release identity (macReleaseSigning in desktop/src/mac-applications.ts).
release_designated='designated => identifier "com.electron.branch-agent" and certificate root = H"30bbf0b68236ae05e063465c39dea6c5b396b11c"'
signed_with_release_identity() {
  command -v codesign >/dev/null 2>&1 || return 1
  codesign -dv "$1" 2>&1 | grep -q 'Signature=adhoc' && return 1
  codesign -dr - "$1" 2>/dev/null | grep -Fxq "$release_designated"
}

install_darwin() {
  app="$work/unpacked/Branch Agent.app"
  [ -d "$app" ] || fail "$asset has no Branch Agent.app; nothing was installed"
  apps=$HOME/Applications
  # Never trade an app signed with the release identity for an ad-hoc or unsigned one: macOS would treat it as
  # another app, and its Keychain items and privacy grants would stop applying.
  if ! signed_with_release_identity "$app"; then
    for installed in "$apps/Branch Agent.app" "$apps/Branch.app" "/Applications/Branch.app"; do
      if [ -d "$installed" ] && signed_with_release_identity "$installed"; then
        fail "$installed is signed with the Branch release identity and this release is ad-hoc signed. Refusing to replace it with a weaker signature; nothing was installed."
      fi
    done
  fi
  mkdir -p "$apps"
  # Stage on the same volume so the final move is a rename.
  staging=$(mktemp -d "$apps/.branch-agent-install.XXXXXX")
  mv "$app" "$staging/Branch Agent.app"
  replace "$staging/Branch Agent.app" "$apps/Branch Agent.app"
  rmdir "$staging" 2>/dev/null || true
  say "Installed $apps/Branch Agent.app"
  # Apple silicon runs only signed code; an ad-hoc signature is the minimum.
  if command -v codesign >/dev/null 2>&1 && codesign -dv "$apps/Branch Agent.app" >/dev/null 2>&1; then
    say "Code signature present."
  else
    say "Warning: Branch Agent.app carries no code signature, so macOS may refuse to open it." >&2
  fi
  say ""
  say "Next: open Branch Agent from ~/Applications, or run: open \"$apps/Branch Agent.app\""
}

install_linux() {
  root="$work/unpacked"
  [ -x "$root/branch-agent" ] || fail "$asset has no branch-agent launcher; nothing was installed"
  data=${XDG_DATA_HOME:-$HOME/.local/share}
  dest=$data/branch-agent
  bin=$HOME/.local/bin
  mkdir -p "$data" "$bin" "$data/applications"
  staging=$(mktemp -d "$data/.branch-agent-install.XXXXXX")
  mv "$root" "$staging/app"
  replace "$staging/app" "$dest"
  rmdir "$staging" 2>/dev/null || true
  launcher_tmp=$(mktemp "$bin/.branch-agent.XXXXXX")
  printf '#!/bin/sh\nexec "%s/branch-agent" "$@"\n' "$dest" > "$launcher_tmp"
  chmod 755 "$launcher_tmp"
  mv -f "$launcher_tmp" "$bin/branch-agent"
  entry_tmp=$(mktemp "$data/applications/.branch-agent.XXXXXX")
  printf '[Desktop Entry]\nType=Application\nName=Branch Agent\nExec="%s" %%U\nTerminal=false\nCategories=Utility;\n' "$bin/branch-agent" > "$entry_tmp"
  chmod 644 "$entry_tmp"
  mv -f "$entry_tmp" "$data/applications/branch-agent.desktop"
  say "Installed $dest"
  say "Launcher $bin/branch-agent"
  say ""
  case :${PATH:-}: in
    *:"$bin":*) say "Next: run branch-agent, or open Branch Agent from your app menu." ;;
    *) say "Next: run $bin/branch-agent (add $bin to PATH to type just branch-agent), or open Branch Agent from your app menu." ;;
  esac
}

case $os in
  darwin) install_darwin ;;
  linux) install_linux ;;
esac
