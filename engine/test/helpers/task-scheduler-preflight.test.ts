// Decision logic for the Windows held-drain Task Scheduler preflight, driven by a fake runner on any OS.
import { describe, expect, it } from "vitest";
import {
  decideTaskSchedulerPreflight,
  parseScheduleServiceQuery,
  TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS,
  type ScheduleServiceState,
  type TaskSchedulerPreflightRunner,
  type TaskSchedulerProbeResult,
} from "./task-scheduler-preflight.js";

const timedOut = (timeoutMs: number): TaskSchedulerProbeResult => ({
  status: "unknown",
  detail: `Scheduled Task probe timed out after ${timeoutMs} ms (ETIMEDOUT).`,
  timeoutMs,
  diagnostic: { kind: "timeout", timeoutMs },
});

function fakeRunner(
  answers: Array<(timeoutMs: number) => TaskSchedulerProbeResult>,
  service: ScheduleServiceState = { state: "running" },
) {
  const calls: Array<{ taskName: string; timeoutMs: number }> = [];
  const lines: string[] = [];
  let serviceQueries = 0;
  const runner: TaskSchedulerPreflightRunner = {
    probe(taskName, timeoutMs) {
      calls.push({ taskName, timeoutMs });
      const answer = answers[calls.length - 1];
      if (!answer) throw new Error(`unexpected probe attempt ${calls.length}`);
      return answer(timeoutMs);
    },
    queryScheduleService() {
      serviceQueries += 1;
      return service;
    },
    log: (line) => lines.push(line),
  };
  return { runner, calls, lines, serviceQueries: () => serviceQueries };
}

describe("Task Scheduler preflight decision", () => {
  it("runs the case when the first probe answers missing", () => {
    const fake = fakeRunner([() => ({ status: "missing" })]);
    expect(decideTaskSchedulerPreflight(fake.runner)).toEqual({ action: "run", attempts: 1 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.serviceQueries()).toBe(0);
  });

  it("retries once with a longer timeout after a timeout, logs both attempts, then runs", () => {
    const fake = fakeRunner([timedOut, () => ({ status: "missing" })]);
    expect(decideTaskSchedulerPreflight(fake.runner)).toEqual({ action: "run", attempts: 2 });
    expect(fake.calls.map((call) => call.timeoutMs)).toEqual([...TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS]);
    expect(TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS[1]).toBeGreaterThan(TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS[0]!);
    expect(fake.calls[0]!.taskName).toBe(fake.calls[1]!.taskName);
    expect(fake.lines).toHaveLength(2);
    expect(fake.lines[0]).toMatch(/attempt 1\/2 \(timeout 60000 ms\): unknown \(Scheduled Task probe timed out/);
    expect(fake.lines[1]).toMatch(/attempt 2\/2 \(timeout 90000 ms\): missing/);
    expect(fake.serviceQueries()).toBe(0);
  });

  it("skips with the cause when both probes time out and the Schedule service is unavailable", () => {
    const fake = fakeRunner([timedOut, timedOut], {
      state: "not-running",
      detail: "in state STOPPED",
    });
    const decision = decideTaskSchedulerPreflight(fake.runner);
    expect(decision.action).toBe("skip");
    expect(decision).toMatchObject({
      reason: expect.stringContaining("Task Scheduler unavailable on this runner"),
    });
    expect(decision).toMatchObject({ reason: expect.stringContaining("in state STOPPED") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("60000 ms, 90000 ms") });
    expect(fake.calls).toHaveLength(2);
    expect(fake.lines).toHaveLength(3);
    expect(fake.lines[2]).toContain("Schedule service is in state STOPPED");
  });

  it("fails when both probes time out while the Schedule service is running", () => {
    const fake = fakeRunner([timedOut, timedOut], { state: "running" });
    const decision = decideTaskSchedulerPreflight(fake.runner);
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({
      reason: expect.stringContaining("although the Schedule service is RUNNING"),
    });
    expect(fake.serviceQueries()).toBe(1);
  });

  it("fails without retrying when the probe answers found for an unregistered task", () => {
    const fake = fakeRunner([() => ({ status: "found", state: 3 })]);
    const decision = decideTaskSchedulerPreflight(fake.runner);
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({ reason: expect.stringContaining('answered "found"') });
    expect(fake.calls).toHaveLength(1);
    expect(fake.serviceQueries()).toBe(0);
  });

  it("fails without retrying when the probe answers with a native error", () => {
    const fake = fakeRunner([
      () => ({
        status: "unknown",
        detail: "Scheduled Task probe failed (exit 2): -2147024891",
        diagnostic: { kind: "native", exitCode: 2, hresult: -2147024891 },
      }),
    ]);
    const decision = decideTaskSchedulerPreflight(fake.runner);
    expect(decision).toEqual({
      action: "fail",
      reason:
        "Task Scheduler probe answered with an error (attempt 1): Scheduled Task probe failed (exit 2): -2147024891",
    });
    expect(fake.serviceQueries()).toBe(0);
  });

  it("fails when the retry after a timeout answers with invalid output", () => {
    const fake = fakeRunner([
      timedOut,
      () => ({
        status: "unknown",
        detail: "Scheduled Task probe returned invalid JSON.",
        diagnostic: { kind: "invalid-response" },
      }),
    ]);
    const decision = decideTaskSchedulerPreflight(fake.runner);
    expect(decision.action).toBe("fail");
    expect(decision).toMatchObject({ reason: expect.stringContaining("attempt 2") });
    expect(fake.serviceQueries()).toBe(0);
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

  it("reads RUNNING as running", () => {
    expect(parseScheduleServiceQuery({ status: 0, stdout: stdout("4  RUNNING") })).toEqual({
      state: "running",
    });
  });

  it("reads any other state as not running", () => {
    expect(parseScheduleServiceQuery({ status: 0, stdout: stdout("1  STOPPED") })).toEqual({
      state: "not-running",
      detail: "in state STOPPED",
    });
  });

  it("treats a failed or hung sc.exe query as not running", () => {
    expect(
      parseScheduleServiceQuery({
        status: 1060,
        stdout: "[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\r\n",
      }),
    ).toEqual({
      state: "not-running",
      detail: "unavailable (sc.exe query exit 1060: [SC] EnumQueryServicesStatus:OpenService FAILED 1060:)",
    });
    expect(
      parseScheduleServiceQuery({ status: null, stdout: "", error: new Error("spawnSync sc.exe ETIMEDOUT") }),
    ).toEqual({ state: "not-running", detail: "not answering (sc.exe query: spawnSync sc.exe ETIMEDOUT)" });
  });
});
