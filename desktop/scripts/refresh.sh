#!/usr/bin/env bash
# Package a new desktop version, then point eligible shortcuts at that package.
# Window and engine updates use their own publication scripts.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
cd "$D"
VERSION="$(node -p 'require("./package.json").version')"
bash "$D/scripts/package.sh"
OUT="${BRANCH_DESKTOP_OUT:-$(node -p 'require("path").join(require("./dist/config.js").defaultDataDirectory(),"dist")')}"
powershell -NoProfile -File "$D/scripts/shortcuts.ps1" -Exe "$(cygpath -w "$OUT/v$VERSION/Branch Agent-win32-x64/Branch Agent.exe")"
