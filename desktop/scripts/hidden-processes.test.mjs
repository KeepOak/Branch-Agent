import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "../src");

test("desktop child-process launches are hidden", () => {
  for (const file of ["../../engine/scripts/lib/available-memory.mjs", "../scripts/build.mjs", "gateway.ts", "desktop-update.ts", "desktop-os.ts", "candidate-check.ts", "engine-records.ts"]) {
    const source = readFileSync(join(root, file), "utf8");
    assert.doesNotMatch(source, /windowsHide\s*:\s*false/, file);
    assert.match(source, /windowsHide\s*:\s*true/, file);
  }
  const updateHelper = readFileSync(join(root, "desktop-update-helper.ts"), "utf8");
  assert.match(updateHelper, /This relaunches the Branch GUI[^\n]*ShowWindow/);
  assert.match(updateHelper, /const command = existsSync\(plan\.relaunch\.command\) \? plan\.relaunch\.command/);
  assert.match(updateHelper, /spawn\(command[^\n]*windowsHide: false/);
  assert.match(readFileSync(join(root, "gateway.ts"), "utf8"), /execFileSync\("taskkill"[^\n]*windowsHide: true/);
  assert.match(updateHelper, /execFileSync\("taskkill"[^\n]*windowsHide: true/);
  const records = readFileSync(join(root, "engine-records.ts"), "utf8");
  assert.match(records, /const run =[^\n]*execFileSync\([^\n]*windowsHide: true/);
  assert.match(records, /run\("taskkill"[^\n]*\/PID/);
});
