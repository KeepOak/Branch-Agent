// Task Scheduler preflight for the Windows held-drain handoff case (test/gateway-desktop-handoff.e2e.test.ts).
// The engines probe Task Scheduler through a cold Windows PowerShell + Schedule.Service COM spawn
// (src/daemon/schtasks-state-probe.ts, 60 s budget). On GitHub-hosted Windows runners that first cold spawn can
// exceed the budget before the case has exercised anything. This preflight runs the same probe up front, with
// exactly one longer retry, and logs both attempts.
//
// Decision (decideTaskSchedulerPreflight):
// - the probe answers "missing" for a fresh, unregistered task name: run the case;
// - the probe answers anything else (a task was "found", a native/COM error, invalid output, spawn failure): fail;
// - the probe times out twice and the Schedule service is not running or not answering: skip, with the reason;
// - the probe times out twice while the Schedule service reports RUNNING: fail.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { probeScheduledTaskState } from "../../src/daemon/schtasks-state-probe.js";
import { getWindowsSystem32ExePath } from "../../src/infra/windows-install-roots.js";

export type TaskSchedulerProbeResult = ReturnType<typeof probeScheduledTaskState>;

export type ScheduleServiceState = { state: "running" } | { state: "not-running"; detail: string };

export type TaskSchedulerPreflightRunner = {
  probe(taskName: string, timeoutMs: number): TaskSchedulerProbeResult;
  queryScheduleService(): ScheduleServiceState;
  log(line: string): void;
};

export type TaskSchedulerPreflightDecision =
  | { action: "run"; attempts: number }
  | { action: "skip"; reason: string }
  | { action: "fail"; reason: string };

/** First attempt matches the engine's own cold-spawn budget; the single retry gets more room. */
export const TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS: readonly number[] = [60_000, 90_000];

const SC_QUERY_TIMEOUT_MS = 20_000;

/** The most the preflight can add to a case before it decides: both probe attempts plus the service query. */
export const TASK_SCHEDULER_PREFLIGHT_BUDGET_MS =
  TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS.reduce((sum, timeoutMs) => sum + timeoutMs, 0) +
  SC_QUERY_TIMEOUT_MS;

function describeProbe(result: TaskSchedulerProbeResult): string {
  return result.status === "unknown" ? `unknown (${result.detail})` : result.status;
}

export function decideTaskSchedulerPreflight(
  runner: TaskSchedulerPreflightRunner,
  timeoutsMs: readonly number[] = TASK_SCHEDULER_PREFLIGHT_TIMEOUTS_MS,
): TaskSchedulerPreflightDecision {
  // A fresh name is never registered, so the only correct answer is "missing".
  const taskName = `Branch handoff preflight ${randomUUID()}`;
  for (const [index, timeoutMs] of timeoutsMs.entries()) {
    const attempt = index + 1;
    const started = performance.now();
    const result = runner.probe(taskName, timeoutMs);
    const elapsedMs = Math.round(performance.now() - started);
    runner.log(
      `Task Scheduler preflight attempt ${attempt}/${timeoutsMs.length} (timeout ${timeoutMs} ms): ${describeProbe(result)} after ${elapsedMs} ms`,
    );
    if (result.status === "missing") {
      return { action: "run", attempts: attempt };
    }
    if (result.status === "found") {
      return {
        action: "fail",
        reason: `Task Scheduler probe answered "found" for an unregistered task (attempt ${attempt}); expected "missing".`,
      };
    }
    if (result.diagnostic.kind !== "timeout") {
      return {
        action: "fail",
        reason: `Task Scheduler probe answered with an error (attempt ${attempt}): ${result.detail}`,
      };
    }
  }
  const budgets = timeoutsMs.map((timeoutMs) => `${timeoutMs} ms`).join(", ");
  const service = runner.queryScheduleService();
  runner.log(
    `Task Scheduler preflight: Schedule service is ${service.state === "running" ? "RUNNING" : service.detail}`,
  );
  if (service.state === "running") {
    return {
      action: "fail",
      reason: `Task Scheduler probe never answered (timed out after ${budgets}) although the Schedule service is RUNNING.`,
    };
  }
  return {
    action: "skip",
    reason: `Task Scheduler unavailable on this runner: the Schedule service is ${service.detail}, and the probe timed out after ${budgets}. Skipping the held-drain case, which needs Task Scheduler.`,
  };
}

/** Reads `sc.exe query Schedule`; anything but a clean RUNNING answer counts as not running. */
export function parseScheduleServiceQuery(result: {
  status: number | null;
  stdout: string;
  error?: Error;
}): ScheduleServiceState {
  if (result.error) {
    return { state: "not-running", detail: `not answering (sc.exe query: ${result.error.message})` };
  }
  const state = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(result.stdout)?.[1];
  if (result.status !== 0 || !state) {
    const firstLine = result.stdout.trim().split(/\r?\n/).find(Boolean) ?? "no output";
    return {
      state: "not-running",
      detail: `unavailable (sc.exe query exit ${String(result.status)}: ${firstLine.trim()})`,
    };
  }
  return state === "RUNNING" ? { state: "running" } : { state: "not-running", detail: `in state ${state}` };
}

/** The real runner; only meaningful on Windows. */
export function createWindowsTaskSchedulerPreflightRunner(
  log: (line: string) => void,
): TaskSchedulerPreflightRunner {
  return {
    probe: (taskName, timeoutMs) => probeScheduledTaskState(taskName, timeoutMs),
    queryScheduleService: () => {
      const query = spawnSync(getWindowsSystem32ExePath("sc.exe"), ["query", "Schedule"], {
        encoding: "utf8",
        timeout: SC_QUERY_TIMEOUT_MS,
        windowsHide: true,
      });
      return parseScheduleServiceQuery({
        status: query.status,
        stdout: query.stdout ?? "",
        ...(query.error ? { error: query.error } : {}),
      });
    },
    log,
  };
}
