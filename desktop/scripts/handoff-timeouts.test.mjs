import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const t = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "handoff-timeouts.js")));

test("the handoff deadlines the desktop and the engine share fit together", () => {
  // The engine's lease bounds (#391).
  assert.equal(t.HANDOFF_LEASE_MAX_WAIT_MS, 330_000);
  assert.equal(t.HANDOFF_LEASE_MAX_AGE_MS, 360_000);
  // The old engine can still take control back when the standby fails: everything after its step-down (the take-over,
  // the standby's readiness, the rollback) ends at least a minute before the lease deadline that stops it.
  assert.ok(t.HANDOFF_TAKE_OVER_TIMEOUT_MS + t.HANDOFF_STANDBY_READY_TIMEOUT_MS + t.HANDOFF_ROLLBACK_TIMEOUT_MS + 60_000 < t.HANDOFF_LEASE_MAX_WAIT_MS);
  // The desktop always outwaits the engine's own rollback lock wait, so a late rollback never races a retire.
  assert.ok(t.HANDOFF_ROLLBACK_LOCK_WAIT_MS < t.HANDOFF_ROLLBACK_TIMEOUT_MS);
  // A retiring engine is killed after its lease deadline and before its leases turn stale: never two writers.
  assert.ok(t.HANDOFF_RETIRE_KILL_AFTER_MS > t.HANDOFF_LEASE_MAX_WAIT_MS);
  assert.ok(t.HANDOFF_RETIRE_KILL_AFTER_MS < t.HANDOFF_LEASE_MAX_AGE_MS);
  assert.ok(t.HANDOFF_STEP_DOWN_TIMEOUT_MS < t.HANDOFF_LEASE_MAX_WAIT_MS);
  for (const [name, value] of Object.entries(t).filter(([name]) => name.startsWith("HANDOFF_"))) assert.ok(Number.isInteger(value) && value > 0, name);
  // The JSON both sides import is the one the desktop compiled in.
  const shared = JSON.parse(readFileSync(join(process.env.BRANCH_DESKTOP_TEST_DIST, "..", "src", "handoff-timeouts.json"), "utf8"));
  assert.equal(shared.leaseMaxWaitMs, t.HANDOFF_LEASE_MAX_WAIT_MS); assert.equal(shared.retireKillAfterMs, t.HANDOFF_RETIRE_KILL_AFTER_MS);
});
