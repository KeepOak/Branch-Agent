import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const t = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "handoff-timeouts.js")));

test("the desktop handoff deadlines fit together", () => {
  assert.ok(t.HANDOFF_TAKE_OVER_TIMEOUT_MS + t.HANDOFF_STANDBY_READY_TIMEOUT_MS + t.HANDOFF_ROLLBACK_TIMEOUT_MS <
    t.HANDOFF_RETIRE_KILL_AFTER_MS);
  assert.ok(t.HANDOFF_STEP_DOWN_TIMEOUT_MS < t.HANDOFF_RETIRE_KILL_AFTER_MS);
  for (const [name, value] of Object.entries(t).filter(([name]) => name.startsWith("HANDOFF_"))) assert.ok(Number.isInteger(value) && value > 0, name);
  // The JSON is the one the desktop compiled in; the engine test checks its lease bounds against the actual constants.
  const shared = JSON.parse(readFileSync(join(process.env.BRANCH_DESKTOP_TEST_DIST, "..", "src", "handoff-timeouts.json"), "utf8"));
  assert.equal(shared.retireKillAfterMs, t.HANDOFF_RETIRE_KILL_AFTER_MS);
});
