#!/usr/bin/env bash
set -euo pipefail

export HOME=/tmp/branch-docker-selected-plugins
export BRANCH_STATE_DIR="$HOME/.branch"
export BRANCH_CONFIG_PATH="$BRANCH_STATE_DIR/branch.json"
export BRANCH_DISABLE_BUNDLED_SOURCE_OVERLAYS=1

mkdir -p "$BRANCH_STATE_DIR"
node --input-type=module <<'NODE'
import fs from "node:fs";

const entries = Object.fromEntries(
  ["clickclack", "slack", "msteams", "whatsapp"].map((id) => [id, { enabled: true }]),
);
fs.writeFileSync(
  process.env.BRANCH_CONFIG_PATH,
  `${JSON.stringify({ plugins: { entries } }, null, 2)}\n`,
  { mode: 0o600 },
);
NODE

for plugin_id in clickclack slack msteams whatsapp clawrouter; do
  node /app/branch.mjs plugins inspect "$plugin_id" --runtime --json \
    >"/tmp/branch-${plugin_id}-inspect.json"
done

node /branch-e2e/assertions.mjs
