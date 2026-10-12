#!/usr/bin/env bash
# Publishes a new window build to the running app: builds window/ from a worktree into a temp folder next to the
# app's window folder, then swaps it in by rename. The open app sees the new build within seconds and reloads the
# window (the conversation lives in the engine, so it stays). No repackaging.
#   bash desktop/scripts/publish-window.sh [worktree] [dataDir] [gatewayPort]
# Defaults: the foundation worktree, C:/Users/you/BranchApp, 19031.
set -euo pipefail
SRC="${1:-C:/Users/you/Code/branch-wt/foundation}"
DATA="${2:-${BRANCH_DESKTOP_DATA:-C:/Users/you/BranchApp}}"
PORT="${3:-19031}"
STAMP="$(date +%Y%m%d-%H%M%S)-$$"
NEXT="$DATA/window-next-$STAMP"
OLD="$DATA/window-old-$STAMP"
CUR="$DATA/window-current"
cd "$SRC/window"
VITE_GATEWAY_URL="ws://127.0.0.1:$PORT" pnpm exec vite build --outDir "$NEXT" --emptyOutDir --logLevel warn
# The app watches this stamp, so every publish reloads the window even when the build output is byte-identical.
printf '%s %s
' "$(git -C "$SRC" rev-parse HEAD)" "$STAMP" > "$NEXT/branch-build.txt"
# Rename can fail for a moment while the app's server reads a file; retry briefly.
swap() { [ ! -e "$CUR" ] || mv "$CUR" "$OLD"; mv "$NEXT" "$CUR"; }
for i in 1 2 3 4 5 6 7 8 9 10; do
  if swap 2>/dev/null; then
    rm -rf "$OLD"
    echo "published window from $SRC ($(git -C "$SRC" rev-parse --short HEAD)) to $CUR"
    exit 0
  fi
  [ -e "$CUR" ] || { [ -e "$OLD" ] && mv "$OLD" "$CUR"; }
  sleep 0.5
done
echo "could not swap the window folder in; the new build is left at $NEXT" >&2
exit 1
