#!/usr/bin/env bash
# Only for changes to desktop/ itself: packages a new version folder and points the shortcuts at it.
# Window and engine builds need no repackaging (scripts/publish-window.sh; the app's engine update bar).
# Bump the version in desktop/package.json first. The owner moves over by closing and reopening the app.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${BRANCH_DESKTOP_OUT:-C:/Users/you/BranchApp/dist}"
VERSION="$(node -p "require('$D/package.json').version")"
bash "$D/scripts/package.sh"
powershell -NoProfile -ExecutionPolicy Bypass -File "$D/scripts/shortcuts.ps1" -Exe "$(cygpath -w "$OUT/v$VERSION/Branch Agent-win32-x64/Branch Agent.exe")"
