#!/usr/bin/env bash
# Publishes a new engine to the app the way OpenClaw installs: a packaged copy (pnpm deploy --prod of the built
# engine; no src/, so Node's compile cache is on) in its own folder, then points engine-current.txt at it.
# The open app notices within about 15 seconds and shows "An update is ready — Restart"; it never restarts by itself.
# The running engine's folder is never touched; older unused copies are removed.
#   bash desktop/scripts/publish-engine.sh [worktree] [dataDir]
# Defaults: the foundation worktree, C:/Users/you/BranchApp. The engine must already be built (pnpm build).
set -euo pipefail
SRC="${1:-C:/Users/you/Code/branch-wt/foundation}"
DATA="${2:-${BRANCH_DESKTOP_DATA:-C:/Users/you/BranchApp}}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NEXT="$DATA/engines/engine-$STAMP"
[ -f "$SRC/engine/dist/build-info.json" ] || { echo "no built engine in $SRC/engine (run pnpm build)" >&2; exit 1; }
mkdir -p "$DATA/engines"
cd "$SRC/engine"
pnpm --filter branch deploy --prod --legacy --config.allow-unused-patches=true "$NEXT" > "$NEXT.log" 2>&1 \
  || { echo "pnpm deploy failed; see $NEXT.log" >&2; exit 1; }
[ -f "$NEXT/branch.mjs" ] && [ -f "$NEXT/dist/build-info.json" ] && [ ! -e "$NEXT/src/entry.ts" ] \
  || { echo "the copy in $NEXT is incomplete" >&2; exit 1; }
printf '%s\n' "$NEXT" > "$DATA/engine-current.txt.tmp"
mv -f "$DATA/engine-current.txt.tmp" "$DATA/engine-current.txt"
echo "published engine $(node -p "require('$NEXT/dist/build-info.json').buildId") to $NEXT"
RUNNING="$(cat "$DATA/engine-running.txt" 2>/dev/null || true)"
for d in "$DATA"/engines/engine-*/; do
  d="${d%/}"
  [ "$d" = "$NEXT" ] || [ "$d" = "$RUNNING" ] || { rm -rf "$d" "$d.log" && echo "removed unused $d"; }
done
