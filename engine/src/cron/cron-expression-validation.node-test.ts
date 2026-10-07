/** Validation cases adapted from OpenHands/OpenHands a8c05584ec6bb063a0857460b9cbff48e136919f,
 * __tests__/utils/automation-schedule.test.ts; Croner-specific parity cases added. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCronExpression } from "./cron-expression-validation.js";
import { computeNextRunAtMs } from "./schedule.js";

const now = Date.parse("2026-01-01T00:00:00Z");

test("accepts and trims arbitrary recurring expressions outside presets", () => {
  for (const schedule of ["*/10 * * * *", "0 9,17 * * *", "0 0 1-15 * 1-5"]) {
    assert.deepEqual(validateCronExpression(schedule), { schedule });
  }
  assert.deepEqual(validateCronExpression("  */10 * * * *  "), { schedule: "*/10 * * * *" });
});

test("retains actual scheduler vocabulary and reachable calendar dates", () => {
  for (const schedule of [
    "0 0 * * 7", "0 0 * * SUN", "0 0 * JAN *", "0 0 * * MON-FRI",
    "0 0 L * *", "0 0 * * 5#3", "0 0 ? * MON", "* * * * * *",
    "@daily", "0 0 29 2 *", "0 0 31 1,2 *", "0 0 31 2-12/2 *", "* * * * * * *",
  ]) {
    assert.deepEqual(validateCronExpression(schedule), { schedule }, schedule);
    assert.equal(typeof computeNextRunAtMs({ kind: "cron", expr: schedule, tz: "UTC" }, now), "number", schedule);
  }
});

test("rejects field counts, out-of-range values and free text using Croner", () => {
  for (const schedule of ["* * * *", "* * * * * * * *", "60 * * * *", "* * * * 9", "every ten minutes please now", "@bogus", "", "*/90 * * * *", "0 0 31 2/2 *"]) {
    assert.deepEqual(validateCronExpression(schedule), { error: "invalid" }, schedule);
  }
});

test("rejects well-formed numeric calendars that can never fire", () => {
  for (const schedule of ["0 0 31 2 *", "0 0 30 2 *", "0 0 31 4 *", "0 0 31 2,4 *", "0 0 30-31 2 *"]) {
    assert.deepEqual(validateCronExpression(schedule), { error: "unreachable" }, schedule);
    assert.equal(computeNextRunAtMs({ kind: "cron", expr: schedule, tz: "UTC" }, now), undefined, schedule);
  }
});

test("restricted weekdays preserve production DOM-DOW OR semantics", () => {
  const schedule = "0 0 31 2 MON";
  assert.deepEqual(validateCronExpression(schedule), { schedule });
  assert.equal(computeNextRunAtMs({ kind: "cron", expr: schedule, tz: "UTC" }, now), Date.parse("2026-02-02T00:00:00Z"));
});

test("optional seconds and year keep parser order and calendar diagnostics", () => {
  assert.deepEqual(validateCronExpression("30 0 0 31 2 *"), { error: "unreachable" });
  assert.deepEqual(validateCronExpression("30 0 0 31 2 * 2028"), { error: "unreachable" });
  assert.deepEqual(validateCronExpression("30 0 0 29 2 * 2028"), { schedule: "30 0 0 29 2 * 2028" });
  const schedule = "30 0 0 29 2 *";
  assert.deepEqual(validateCronExpression(schedule), { schedule });
  assert.equal(computeNextRunAtMs({ kind: "cron", expr: schedule, tz: "UTC" }, now), Date.parse("2028-02-29T00:00:30Z"));
});

test("unmodelled calendar vocabulary stays with the production scheduler", () => {
  for (const schedule of ["0 0 L FEB *", "0 0 31 JAN,FEB *"]) {
    assert.deepEqual(validateCronExpression(schedule), { schedule });
    assert.equal(typeof computeNextRunAtMs({ kind: "cron", expr: schedule, tz: "UTC" }, now), "number", schedule);
  }
});
