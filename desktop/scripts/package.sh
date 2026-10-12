#!/usr/bin/env bash
# Compiles the desktop app and packages it as a portable folder in a new versioned folder:
#   $OUT/v<version>/Branch Agent-win32-x64/Branch Agent.exe
# A running copy keeps running from its own folder; point the shortcuts at the new one (scripts/shortcuts.ps1).
# dist/, assets/ and a dependency-free package.json go into the app archive. Node24 is bundled beside it;
# verified engine/window components install into the per-user data directory on first launch.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
cd "$D"
node scripts/build.mjs
OUT="${BRANCH_DESKTOP_OUT:-$(node -p 'require("path").join(require("./dist/config.js").defaultDataDirectory(),"dist")')}"
VERSION="$(node -p 'require("./package.json").version')"
TARGET="$OUT/v$VERSION"
if [ -e "$TARGET" ]; then
  echo "$TARGET already exists; bump the version in desktop/package.json first." >&2
  exit 1
fi
# An existing base executable may be retained when explicitly configured.
# The folder and package.json always carry the current app version.
EXE_VERSION="$VERSION"
BASE_EXE="${BRANCH_DESKTOP_BASE_EXE:-$OUT/v0.2.0/Branch Agent-win32-x64/Branch Agent.exe}"
TEMP_ROOT="$(cd "${TMPDIR:-/tmp}" && pwd)"
STAGE="$(mktemp -d "$TEMP_ROOT/branch-desktop-stage.XXXXXX")"
cleanup() { case "$STAGE" in "$TEMP_ROOT"/branch-desktop-stage.*) rm -rf -- "$STAGE" ;; *) exit 1 ;; esac; }
trap cleanup EXIT
cp -r dist assets "$STAGE/"
node -e 'const p=require("./package.json");delete p.devDependencies;delete p.scripts;require("fs").writeFileSync(process.argv[1],JSON.stringify(p,null,2))' "$STAGE/package.json"
npx electron-packager "$STAGE" "Branch Agent" --platform=win32 --arch=x64 --electron-version=44.5.1 \
  --asar --out="$TARGET" --icon=assets/branch.ico --no-prune --app-version="$EXE_VERSION" \
  --app-copyright="Branch Agent" --win32metadata.ProductName="Branch Agent" --win32metadata.FileDescription="Branch Agent"
node scripts/bundle-node.mjs "$TARGET/Branch Agent-win32-x64/resources" win32 x64
if [ "${BRANCH_DESKTOP_PRESERVE_APPROVED_EXE:-1}" = "1" ] && [ -f "$BASE_EXE" ]; then
  cp -f "$BASE_EXE" "$TARGET/Branch Agent-win32-x64/Branch Agent.exe"
  echo "reused the allowed exe from $BASE_EXE"
fi
echo "packaged: $TARGET/Branch Agent-win32-x64/Branch Agent.exe"
