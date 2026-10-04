import assert from "node:assert/strict";
import { test } from "node:test";
import { CronCliError } from "./cron-cli-error.js";
import { resolveCronCreateScheduleFromArgs, resolveCronEditScheduleRequest } from "./schedule-options.js";

test("real CLI create rejects invalid cron before constructing gateway input", () => {
  assert.throws(() => resolveCronCreateScheduleFromArgs({ cron: "60 * * * *" }), (error) => error instanceof CronCliError && /valid cron expression/.test(error.message));
  assert.throws(() => resolveCronCreateScheduleFromArgs({ positionalSchedule: "0 0 31 2 *" }), (error) => error instanceof CronCliError && /can never occur/.test(error.message));
});

test("real CLI edit applies the same invalid and unreachable diagnostics", () => {
  assert.throws(() => resolveCronEditScheduleRequest({ cron: "@bogus" }), /valid cron expression/);
  assert.throws(() => resolveCronEditScheduleRequest({ cron: "0 0 31 4 *" }), /can never occur/);
});

test("create preserves accepted expression, timezone and exact stagger metadata", () => {
  assert.deepEqual(resolveCronCreateScheduleFromArgs({ cron: "  0 0 31 2 MON  ", tz: "UTC", exact: true }), {
    kind: "cron", expr: "0 0 31 2 MON", tz: "UTC", staggerMs: 0,
  });
  assert.deepEqual(resolveCronCreateScheduleFromArgs({ cron: "30 0 0 29 2 *" }), {
    kind: "cron", expr: "30 0 0 29 2 *", tz: undefined, staggerMs: undefined,
  });
});

test("edit preserves accepted aliases and other scheduling paths", () => {
  assert.deepEqual(resolveCronEditScheduleRequest({ cron: "@daily", tz: "America/New_York" }), {
    kind: "direct", schedule: { kind: "cron", expr: "@daily", tz: "America/New_York", staggerMs: undefined },
  });
  assert.deepEqual(resolveCronCreateScheduleFromArgs({ every: "10m" }), { kind: "every", everyMs: 600000 });
  assert.deepEqual(resolveCronEditScheduleRequest({ exact: true }), { kind: "patch-existing-cron", staggerMs: 0, tz: undefined });
});
