// Decision logic for the Windows held-drain Task Scheduler preflight.
// A fake runner drives every case, so this file does not start PowerShell or sc.exe.
import { describe, expect, it } from "vitest";
import {
  decideHeldDrainTaskScheduler,
  parseScheduleServiceQuery,
  TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS,
  TASK_SCHEDULER_PREFLIGHT_BUDGET_MS,
  TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS,
  TASK_SCHEDULER_PROBE_RETRY_TIMEOUT_MS,
  TASK_SCHEDULER_PROBE_TIMEOUT_MS,
  type HeldDrainTaskSchedulerRunner,
  type TaskSchedulerAvailability,
  type TaskSchedulerProbeResult,
} from "./task-scheduler-preflight.js";

const usable: TaskSchedulerAvailability = { usable: true };

const timedOut = (timeoutMs: number): TaskSchedulerProbeResult => ({
  status: "unknown",
  detail: `Scheduled Task probe timed out after ${timeoutMs} ms (ETIMEDOUT).`,
  timeoutMs,
  diagnostic: { kind: "timeout", timeoutMs },
});

function fakeRunner(
  answers: Array<(timeoutMs: number) => TaskSchedulerProbeResult>,
  availability: TaskSchedulerAvailability = usable,
) {
  const calls: Array<{ taskName: string; timeoutMs: number }> = [];
  const lines: string[] = [];
  let availabilityChecks = 0;
  const runner: HeldDrainTaskSchedulerRunner = {
    checkAvailability() {
      availabilityChecks += 1;
      return availability;
    },
    probe(taskName, timeoutMs) {
      calls.push({ taskName, timeoutMs });
      const answer = answers[calls.length - 1];
      if (!answer) {
        throw new Error(`unexpected probe attempt ${calls.length}`);
      }
      return answer(timeoutMs);
    },
    log: (line) => lines.push(line),
  };
  return { runner, calls, lines, availabilityChecks: () => availabilityChecks };
}

describe("held-drain Task Scheduler preflight", () => {
  it("keeps the whole check inside a short bound with exactly one retry", () => {
    expect(TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS).toEqual([
      TASK_SCHEDULER_PROBE_TIMEOUT_MS,
      TASK_SCHEDULER_PROBE_RETRY_TIMEOUT_MS,
    ]);
    expect(TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS).toHaveLength(2);
    expect(TASK_SCHEDULER_PREFLIGHT_BUDGET_MS).toBe(
      TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS +
        TASK_SCHEDULER_PROBE_TIMEOUT_MS +
        TASK_SCHEDULER_PROBE_RETRY_TIMEOUT_MS,
    );
    expect(TASK_SCHEDULER_PREFLIGHT_BUDGET_MS).toBeLessThanOrEqual(90_000);
    expect(TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS).toBeLessThan(TASK_SCHEDULER_PROBE_TIMEOUT_MS);
  });

  it("skips before any probe when the quick check says Task Scheduler is not usable", () => {
    const fake = fakeRunner([() => ({ status: "missing" })], {
      usable: false,
      reason: "Schedule service is STOPPED",
    });
    expect(decideHeldDrainTaskScheduler(fake.runner)).toEqual({
      action: "skip",
      reason:
        "Skipping held-drain: Task Scheduler is not available on this runner (Schedule service is STOPPED).",
    });
    expect(fake.calls).toHaveLength(0);
    expect(fake.availabilityChecks()).toBe(1);
    expect(fake.lines[0]).toContain("not usable (Schedule service is STOPPED)");
  });

  it("runs the case when the service is usable and the first probe answers missing", () => {
    const fake = fakeRunner([() => ({ status: "missing" })]);
    expect(decideHeldDrainTaskScheduler(fake.runner)).toEqual({ action: "run", attempts: 1 });
    expect(fake.calls.map((call) => call.timeoutMs)).toEqual([TASK_SCHEDULER_PROBE_TIMEOUT_MS]);
    expect(fake.availabilityChecks()).toBe(1);
  });

  it("retries once after a timeout, then runs when the retry answers missing", () => {
    const fake = fakeRunner([timedOut, () => ({ status: "missing" })]);
    expect(decideHeldDrainTaskScheduler(fake.runner)).toEqual({ action: "run", attempts: 2 });
    expect(fake.calls.map((call) => call.timeoutMs)).toEqual([
      ...TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS,
    ]);
    expect(fake.calls[0]?.taskName).toBe(fake.calls[1]?.taskName);
    expect(fake.lines[1]).toMatch(/attempt 1\/2 \(limit 20000 ms\): unknown/);
    expect(fake.lines[2]).toMatch(/attempt 2\/2 \(limit 45000 ms\): missing/);
  });

  it("skips with a clear reason when the one retry also times out", () => {
    const fake = fakeRunner([timedOut, timedOut]);
    const decision = decideHeldDrainTaskScheduler(fake.runner);
    expect(decision).toEqual({
      action: "skip",
      reason:
        "Skipping held-drain: Task Scheduler did not answer a probe within 20000 ms or the one retry within 45000 ms.",
    });
    expect(fake.calls).toHaveLength(2);
  });

  it("does not retry a probe error, and skips because the probe is not usable", () => {
    const fake = fakeRunner([
      () => ({
        status: "unknown",
        detail: "Scheduled Task probe failed (exit 2): -2147024891",
        diagnostic: { kind: "native", exitCode: 2, hresult: -2147024891 },
      }),
    ]);
    expect(decideHeldDrainTaskScheduler(fake.runner)).toEqual({
      action: "skip",
      reason:
        "Skipping held-drain: Task Scheduler probe is not usable (Scheduled Task probe failed (exit 2): -2147024891).",
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("fails without a retry when an unregistered task is reported as found", () => {
    const fake = fakeRunner([() => ({ status: "found", state: 3 })]);
    const decision = decideHeldDrainTaskScheduler(fake.runner);
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({
      reason: expect.stringContaining("reported an unregistered task as found (attempt 1)"),
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("skips when the retry answers with invalid output instead of looping", () => {
    const fake = fakeRunner([
      timedOut,
      () => ({
        status: "unknown",
        detail: "Scheduled Task probe returned invalid JSON.",
        diagnostic: { kind: "invalid-response" },
      }),
    ]);
    const decision = decideHeldDrainTaskScheduler(fake.runner);
    expect(decision).toEqual({
      action: "skip",
      reason:
        "Skipping held-drain: Task Scheduler probe is not usable (Scheduled Task probe returned invalid JSON.).",
    });
    expect(fake.calls).toHaveLength(2);
  });
});

describe("Schedule service query parsing", () => {
  const stdout = (state: string) =>
    [
      "",
      "SERVICE_NAME: Schedule ",
      "        TYPE               : 30  WIN32  ",
      `        STATE              : ${state}  `,
      "        WIN32_EXIT_CODE    : 0  (0x0)",
    ].join("\r\n");

  it("reads RUNNING as usable", () => {
    expect(parseScheduleServiceQuery({ status: 0, stdout: stdout("4  RUNNING") })).toEqual({
      state: "running",
    });
  });

  it("reads any other state as not usable", () => {
    expect(parseScheduleServiceQuery({ status: 0, stdout: stdout("1  STOPPED") })).toEqual({
      state: "not-running",
      detail: "Schedule service is STOPPED",
    });
  });

  it("treats a failed or timed out sc.exe query as not usable", () => {
    expect(
      parseScheduleServiceQuery({
        status: 1060,
        stdout: "[SC] OpenService FAILED 1060:\r\n",
      }),
    ).toEqual({
      state: "not-running",
      detail: "sc.exe query Schedule exited 1060 ([SC] OpenService FAILED 1060:)",
    });
    const error = new Error("spawnSync sc.exe ETIMEDOUT");
    (error as NodeJS.ErrnoException).code = "ETIMEDOUT";
    expect(parseScheduleServiceQuery({ status: null, stdout: "", error })).toEqual({
      state: "not-running",
      detail: "sc.exe query Schedule timed out after 5000 ms",
    });
    expect(
      parseScheduleServiceQuery({
        status: null,
        stdout: "",
        error: new Error("spawnSync sc.exe ENOENT"),
      }),
    ).toEqual({
      state: "not-running",
      detail: "sc.exe query Schedule failed (spawnSync sc.exe ENOENT)",
    });
  });
});
