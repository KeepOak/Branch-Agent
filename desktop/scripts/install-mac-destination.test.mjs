// Source check for the Mac one-line installer destination. Fixture runs stay in
// desktop/scripts/install-scripts.test.mjs and must not overlap that file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../install/install.sh", import.meta.url));

test("install.sh prefers /Applications/Branch.app and keeps fixture installs in HOME", { skip: process.platform === "win32" }, () => {
  const source = readFileSync(script, "utf8");
  assert.match(source, /choose_darwin_apps/);
  assert.match(source, /\[ -d \/Applications \] && \[ -w \/Applications \]/);
  assert.match(source, /dest="\$apps\/Branch\.app"/);
  assert.match(source, /BRANCH_INSTALL_BASE_URL/);
  assert.match(source, /\$HOME\/Applications/);
  assert.match(source, /lsregister/);
  assert.match(source, /open Branch from Applications/);
  assert.match(source, /BRANCH_INSTALL_BASE_URL[\s\S]*Branch Agent\.app/);
  assert.doesNotMatch(source.replace(/BRANCH_INSTALL_BASE_URL[\s\S]*?dest="\$apps\/Branch Agent\.app"/, ""), /Installed \$apps\/Branch Agent\.app/);
});
