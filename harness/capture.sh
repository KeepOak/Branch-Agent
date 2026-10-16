#!/bin/zsh
# usage: capture.sh <window dir> <port> <outDir> <label> <routes...>
win="$1"; port="$2"; out="$3"; label="$4"; shift 4
if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null; then echo "port $port busy"; exit 3; fi
cd "$win" || exit 4
npx vite --port $port --strictPort > "$out.vite.log" 2>&1 &
vpid=$!
for i in {1..60}; do curl -s -o /dev/null "http://127.0.0.1:$port/scripts/visual-settings.html" && break; sleep 1; done
rc=0
for r in "$@"; do VISUAL_URL=http://127.0.0.1:$port node scripts/playwright-visual-routes.mjs "$r" "$out" "$label" || { echo "FAILED $r"; rc=1; }; done
kill $vpid; sleep 1; pkill -f "vite --port $port --strictPort"; sleep 1
lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null && echo "port $port STILL LISTENING" || echo "vite stopped"
exit $rc
