import { asNonArrayRecord, isRecord } from "@branch/normalization-core/record-coerce";
import { normalizeExecTarget } from "../infra/exec-approvals-core.js";
import { addSafeTimeoutDelayGraceMs } from "../utils/timer-delay.js";
import type { ExecToolDefaults } from "./bash-tools.exec-types.js";

export function resolveExecDefaultTimeoutSec(timeoutSec?: number): number {
  return timeoutSec && timeoutSec > 0 ? timeoutSec : 1800;
}

export function resolveNodeExecTimeouts(
  timeoutSec: number | null | undefined,
  defaultTimeoutSec: number,
): { runTimeoutMs: number; invokeDeadlineMs: number; invokeWaitMs: number } {
  const runTimeoutSec =
    typeof timeoutSec === "number" && Number.isFinite(timeoutSec) ? timeoutSec : defaultTimeoutSec;
  // Zero disables only the program timer; node invocation still has a bounded wait.
  const baseTimeoutSec =
    Number.isFinite(runTimeoutSec) && runTimeoutSec > 0 ? runTimeoutSec : defaultTimeoutSec;
  const invokeDeadlineMs =
    !Number.isFinite(baseTimeoutSec) || baseTimeoutSec <= 0
      ? 10_000
      : Math.max(10_000, addSafeTimeoutDelayGraceMs(baseTimeoutSec * 1000, 5_000));
  return {
    runTimeoutMs:
      Number.isFinite(runTimeoutSec) && runTimeoutSec > 0
        ? addSafeTimeoutDelayGraceMs(runTimeoutSec * 1000, 0, { minMs: 0 })
        : 0,
    invokeDeadlineMs,
    // Both deadlines saturate together at the safe timer ceiling.
    invokeWaitMs: addSafeTimeoutDelayGraceMs(invokeDeadlineMs, 5_000),
  };
}

/** Seconds named by a legacy exec timeout value, or undefined when it names none. */
export function readExecTimeoutAliasSeconds(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isNaN(value) ? undefined : value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const seconds = Number(value);
    return Number.isNaN(seconds) ? undefined : seconds;
  }
  return undefined;
}

/**
 * Fold a timeout argument into timeoutSeconds. The schema advertises only timeoutSeconds, but
 * models keep sending timeout (the process tool and other shells use that name), and rejecting
 * it made agents retry the same failing call. An explicit timeoutSeconds wins. Arguments
 * without timeout keep their identity so prepared-state lookups still match.
 */
export function foldExecTimeoutAlias<T>(args: T): T {
  if (!isRecord(args) || !Object.hasOwn(args, "timeout")) {
    return args;
  }
  const seconds = readExecTimeoutAliasSeconds(args.timeout);
  if (seconds === undefined && args.timeoutSeconds === undefined) {
    return args;
  }
  const folded: Record<string, unknown> = { ...args };
  delete folded.timeout;
  folded.timeoutSeconds ??= seconds;
  return folded as T;
}

export function createExecToolExecutionTimeoutResolver(
  defaults?: Pick<ExecToolDefaults, "host" | "timeoutSec">,
): (args: unknown) => number | undefined {
  const defaultTimeoutSec = resolveExecDefaultTimeoutSec(defaults?.timeoutSec);
  const defaultHost = defaults?.host;
  return (args) => {
    const params = asNonArrayRecord(foldExecTimeoutAlias(args));
    const requestedHost = normalizeExecTarget(
      typeof params.host === "string" ? params.host : undefined,
    );
    const host = requestedHost && requestedHost !== "auto" ? requestedHost : defaultHost;
    if (host !== "node") {
      return undefined;
    }
    return resolveNodeExecTimeouts(
      typeof params.timeoutSeconds === "number" ? params.timeoutSeconds : undefined,
      defaultTimeoutSec,
    ).invokeWaitMs;
  };
}
