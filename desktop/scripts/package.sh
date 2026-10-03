#!/usr/bin/env bash
# Compiles the desktop app and packages it as a portable folder in a new versioned folder:
#   $OUT/v<version>/Branch Agent-win32-x64/Branch Agent.exe
# A running copy keeps running from its own folder; point the shortcuts at the new one (scripts/shortcuts.ps1).
# Only dist/, assets/ and a dependency-free package.json go into the app. The engine and the window are not bundled:
# the app runs the built engine named in its config and loads the window from its watched window folder.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${BRANCH_DESKTOP_OUT:-C:/Users/you/BranchApp/dist}"
cd "$D"
VERSION="$(node -p 'require("./package.json").version')"
TARGET="$OUT/v$VERSION"
if [ -e "$TARGET" ]; then
  echo "$TARGET already exists; bump the version in desktop/package.json first." >&2
  exit 1
fi
# Windows Smart App Control judges the unsigned exe by its hash: it allowed the v0.2.0 exe and blocks new ones.
# The app code lives in resources/app.asar, so every package reuses that exact exe (same Electron, icon and stamp).
# The app's real version is the folder name and package.json (app.getVersion()).
EXE_VERSION="$VERSION"
BASE_EXE="${BRANCH_DESKTOP_BASE_EXE:-$OUT/v0.2.0/Branch Agent-win32-x64/Branch Agent.exe}"
STAGE="${TMPDIR:-/tmp}/branch-desktop-stage"
npx tsc -p tsconfig.json
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -r dist assets "$STAGE/"
node -e 'const p=require("./package.json");delete p.devDependencies;delete p.scripts;require("fs").writeFileSync(process.argv[1],JSON.stringify(p,null,2))' "$STAGE/package.json"
npx electron-packager "$STAGE" "Branch Agent" --platform=win32 --arch=x64 --electron-version=44.5.1 \
  --asar --out="$TARGET" --icon=assets/branch.ico --no-prune --app-version="$EXE_VERSION" \
  --app-copyright="Branch Agent" --win32metadata.ProductName="Branch Agent" --win32metadata.FileDescription="Branch Agent"
rm -rf "$STAGE"
if [ "${BRANCH_DESKTOP_PRESERVE_APPROVED_EXE:-1}" = "1" ] && [ -f "$BASE_EXE" ]; then
  cp -f "$BASE_EXE" "$TARGET/Branch Agent-win32-x64/Branch Agent.exe"
  echo "reused the allowed exe from $BASE_EXE"
fi
echo "packaged: $TARGET/Branch Agent-win32-x64/Branch Agent.exe"
