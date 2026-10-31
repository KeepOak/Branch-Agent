// Held-drain on Windows starts real engines, and those engines ask Task Scheduler
// whether a task exists (src/daemon/schtasks-state-probe.ts). On a GitHub-hosted
// runner that probe can sit until its 60 s budget and the case fails with
// "Task Scheduler probe timed out after 59999 ms".
//
// This preflight runs before any engine starts:
// 1. Ask quickly whether the Schedule service is usable.
// 2. If it is not, skip held-drain.
// 3. If it is, run the same probe the engine uses. A timeout gets one more try,
//    then stop. There is no loop.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { probeScheduledTaskState } from "../../src/daemon/schtasks-state-probe.js";
import { hasErrnoCode } from "../../src/infra/errno.js";
import { getWindowsSystem32ExePath } from "../../src/infra/windows-install-roots.js";

export type TaskSchedulerProbeResult = ReturnType<typeof probeScheduledTaskState>;

export type ScheduleServiceState = { state: "running" } | { state: "not-running"; detail: string };

export type TaskSchedulerAvailability = { usable: true } | { usable: false; reason: string };

export type HeldDrainTaskSchedulerRunner = {
  checkAvailability(): TaskSchedulerAvailability;
  probe(taskName: string, timeoutMs: number): TaskSchedulerProbeResult;
  log(line: string): void;
};

export type HeldDrainTaskSchedulerDecision =
  | { action: "run"; attempts: number }
  | { action: "skip"; reason: string }
  | { action: "fail"; reason: string };

/** `sc.exe query Schedule` must answer inside this limit, or Task Scheduler is treated as unavailable. */
export const TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS = 5_000;

/** First probe. A warm scheduler answers in well under this. */
export const TASK_SCHEDULER_PROBE_TIMEOUT_MS = 20_000;

/** The only retry. Used only after a timeout, and only when the service already looked usable. */
export const TASK_SCHEDULER_PROBE_RETRY_TIMEOUT_MS = 45_000;

/** Exactly two probe attempts. Index 1 is the single retry. Do not append another. */
export const TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS = [
  TASK_SCHEDULER_PROBE_TIMEOUT_MS,
  TASK_SCHEDULER_PROBE_RETRY_TIMEOUT_MS,
] as const;

/** The most time the preflight can add: the availability query plus both probe attempts. */
export const TASK_SCHEDULER_PREFLIGHT_BUDGET_MS =
  TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS +
  TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS.reduce((sum, timeoutMs) => sum + timeoutMs, 0);

function describeProbe(result: TaskSchedulerProbeResult): string {
  return result.status === "unknown" ? `unknown (${result.detail})` : result.status;
}

export function decideHeldDrainTaskScheduler(
  runner: HeldDrainTaskSchedulerRunner,
): HeldDrainTaskSchedulerDecision {
  const availability = runner.checkAvailability();
  runner.log(
    availability.usable
      ? "Task Scheduler availability: usable"
      : `Task Scheduler availability: not usable (${availability.reason})`,
  );
  if (!availability.usable) {
    return {
      action: "skip",
      reason: `Skipping held-drain: Task Scheduler is not available on this runner (${availability.reason}).`,
    };
  }

  const taskName = `Branch handoff preflight ${randomUUID()}`;
  const timeouts = TASK_SCHEDULER_PROBE_ATTEMPT_TIMEOUTS_MS;
  for (const [index, timeoutMs] of timeouts.entries()) {
    const started = performance.now();
    const result = runner.probe(taskName, timeoutMs);
    const elapsedMs = Math.round(performance.now() - started);
    runner.log(
      `Task Scheduler probe attempt ${index + 1}/${timeouts.length} (limit ${timeoutMs} ms): ${describeProbe(result)} after ${elapsedMs} ms`,
    );
    if (result.status === "missing") {
      return { action: "run", attempts: index + 1 };
    }
    if (result.status === "found") {
      return {
        action: "fail",
        reason: `Task Scheduler probe reported an unregistered task as found (attempt ${index + 1}).`,
      };
    }
    if (result.diagnostic.kind !== "timeout") {
      return {
        action: "skip",
        reason: `Skipping held-drain: Task Scheduler probe is not usable (${result.detail}).`,
      };
    }
  }

  const [firstMs, retryMs] = timeouts;
  return {
    action: "skip",
    reason: `Skipping held-drain: Task Scheduler did not answer a probe within ${firstMs} ms or the one retry within ${retryMs} ms.`,
  };
}

/** Reads `sc.exe query Schedule`. Anything but a clean RUNNING answer counts as not usable. */
export function parseScheduleServiceQuery(result: {
  status: number | null;
  stdout: string;
  error?: Error;
}): ScheduleServiceState {
  if (result.error) {
    return {
      state: "not-running",
      detail: hasErrnoCode(result.error, "ETIMEDOUT")
        ? `sc.exe query Schedule timed out after ${TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS} ms`
        : `sc.exe query Schedule failed (${result.error.message})`,
    };
  }
  const state = /STATE\s*:\s*\d+\s+([A-Z_]+)/.exec(result.stdout)?.[1];
  if (result.status === 0 && state === "RUNNING") {
    return { state: "running" };
  }
  if (result.status === 0 && state) {
    return { state: "not-running", detail: `Schedule service is ${state}` };
  }
  const firstLine = result.stdout.trim().split(/\r?\n/).find(Boolean)?.trim() ?? "no output";
  return {
    state: "not-running",
    detail: `sc.exe query Schedule exited ${String(result.status)} (${firstLine})`,
  };
}

/** The real runner. Call it only on Windows. */
export function createWindowsHeldDrainTaskSchedulerRunner(
  log: (line: string) => void,
): HeldDrainTaskSchedulerRunner {
  return {
    checkAvailability() {
      const query = spawnSync(getWindowsSystem32ExePath("sc.exe"), ["query", "Schedule"], {
        encoding: "utf8",
        timeout: TASK_SCHEDULER_AVAILABILITY_TIMEOUT_MS,
        windowsHide: true,
      });
      const service = parseScheduleServiceQuery({
        status: query.status,
        stdout: query.stdout ?? "",
        ...(query.error ? { error: query.error } : {}),
      });
      return service.state === "running"
        ? { usable: true }
        : { usable: false, reason: service.detail };
    },
    probe: (taskName, timeoutMs) => probeScheduledTaskState(taskName, timeoutMs),
    log,
  };
}

/**
 * Windows held-drain calls this before it starts an engine. Other platforms do nothing.
 * A skip reason is passed to `skip`, which Vitest uses to mark the case skipped.
 */
export function prepareHeldDrainTaskScheduler(
  skip: (reason: string) => void,
  log: (line: string) => void,
): void {
  if (process.platform !== "win32") {
    return;
  }
  log("checking whether Task Scheduler is usable");
  const decision = decideHeldDrainTaskScheduler(createWindowsHeldDrainTaskSchedulerRunner(log));
  if (decision.action === "skip") {
    log(decision.reason);
    console.warn(`::warning title=held-drain skipped::${decision.reason}`);
    skip(decision.reason);
    return;
  }
  if (decision.action === "fail") {
    throw new Error(decision.reason);
  }
  const attempts =
    decision.attempts === 1 ? "1 probe attempt" : `${decision.attempts} probe attempts`;
  log(`Task Scheduler answered after ${attempts}`);
}
