import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const t = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "handoff-timeouts.js")));
const budget = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "readiness-budget.js")));

test("the desktop handoff deadlines fit together", () => {
  assert.ok(t.HANDOFF_TAKE_OVER_TIMEOUT_MS + t.HANDOFF_STANDBY_READY_TIMEOUT_MS + t.HANDOFF_ROLLBACK_TIMEOUT_MS <
    t.HANDOFF_RETIRE_KILL_AFTER_MS);
  assert.ok(t.HANDOFF_STEP_DOWN_TIMEOUT_MS < t.HANDOFF_RETIRE_KILL_AFTER_MS);
  for (const [name, value] of Object.entries(t).filter(([name]) => name.startsWith("HANDOFF_"))) assert.ok(Number.isInteger(value) && value > 0, name);
  // The JSON is the one the desktop compiled in; it contains no unused engine-only lease bounds.
  const shared = JSON.parse(readFileSync(join(process.env.BRANCH_DESKTOP_TEST_DIST, "..", "src", "handoff-timeouts.json"), "utf8"));
  assert.equal(shared.retireKillAfterMs, t.HANDOFF_RETIRE_KILL_AFTER_MS);
});


test("a slow cold start sizes the standby readiness budget from the measurement, not a flat 120 s", () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-cold-start-"));
  try {
    const file = join(dir, "cold-start.json");
    // No measurement yet: the shared deadline is the floor.
    assert.equal(budget.standbyReadyBudgetMs(budget.readColdStarts(file)), t.HANDOFF_STANDBY_READY_TIMEOUT_MS);
    // A fast host keeps the floor.
    budget.recordColdStart(file, 40_000);
    assert.equal(budget.standbyReadyBudgetMs(budget.readColdStarts(file)), t.HANDOFF_STANDBY_READY_TIMEOUT_MS);
    // One slow cold start (130 s, over the old flat 120 s) sizes the budget with headroom.
    budget.recordColdStart(file, 130_000);
    const sized = budget.standbyReadyBudgetMs(budget.readColdStarts(file));
    assert.equal(sized, Math.ceil(130_000 * budget.COLD_START_HEADROOM));
    assert.ok(sized > 130_000 && sized > t.HANDOFF_STANDBY_READY_TIMEOUT_MS);
    // The admission rollback keeps its 10 minute floor until a cold start needs more.
    assert.equal(budget.admissionRollbackBudgetMs(budget.readColdStarts(file)), 10 * 60_000);
    // Slower than the lease allows: capped so the old engine can still take control back.
    budget.recordColdStart(file, 600_000);
    assert.equal(budget.admissionRollbackBudgetMs(budget.readColdStarts(file)), 900_000);
    assert.equal(budget.standbyReadyBudgetMs(budget.readColdStarts(file)), budget.STANDBY_READY_CEILING_MS);
    assert.ok(t.HANDOFF_STEP_DOWN_TIMEOUT_MS + t.HANDOFF_TAKE_OVER_TIMEOUT_MS + budget.STANDBY_READY_CEILING_MS +
      t.HANDOFF_ROLLBACK_TIMEOUT_MS < t.HANDOFF_RETIRE_KILL_AFTER_MS);
    // Only the last few starts count: a slow one ages out.
    for (let i = 0; i < budget.COLD_START_SAMPLES; i++) budget.recordColdStart(file, 50_000);
    assert.deepEqual(budget.readColdStarts(file), Array(budget.COLD_START_SAMPLES).fill(50_000));
    assert.equal(budget.standbyReadyBudgetMs(budget.readColdStarts(file)), t.HANDOFF_STANDBY_READY_TIMEOUT_MS);
    // A damaged record reads as no measurement, never as a zero budget.
    writeFileSync(file, "{not json");
    assert.deepEqual(budget.readColdStarts(file), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
