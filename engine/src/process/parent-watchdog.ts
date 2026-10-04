// Adapted from Kilo-Org/kilocode parent-watchdog.ts (6fd9b7b29ce63b5a38176e45b738e94ed6167cfb).
import { getFileLockProcessStartTime, isPidDefinitelyDead } from "../shared/pid-alive.ts";

export type ParentWatchdogOptions = {
  env?: NodeJS.ProcessEnv;
  readParentPid?: () => number;
  isParentDead?: (pid: number) => boolean;
  readParentStartTime?: (pid: number) => number | null;
};

/**
 * Stop an embedded engine when the client that launched it dies.
 * BRANCH_PARENT_PID opts in; manually launched gateways never watch their shell.
 * Only definite death or reparenting ends the engine. Inconclusive probes leave
 * it running, including EPERM. Linux zombie detection uses the native PID helper.
 * Windows retains its creator PID after exit, so compare its birth identity too.
 * Returns a function that stops the watchdog.
 */
export function startParentWatchdog(
  onOrphan: () => void,
  intervalMs = 1000,
  options: ParentWatchdogOptions = {},
): () => void {
  const configured = Number((options.env ?? process.env).BRANCH_PARENT_PID);
  if (!Number.isInteger(configured) || configured <= 0) {
    return () => {};
  }
  const readParentPid = options.readParentPid ?? (() => process.ppid);
  const isParentDead = options.isParentDead ?? isPidDefinitelyDead;
  const readParentStartTime = options.readParentStartTime ?? (
    process.platform === "win32"
      ? (pid: number) => getFileLockProcessStartTime(pid, options.env ?? process.env, intervalMs)
      : undefined
  );
  const initial = readParentPid();
  let parentStartTime = configured === 1 ? null : readParentStartTime?.(configured) ?? null;
  const timer = setInterval(() => {
    // PID 1 is never considered gone, but reparenting away from a known spawner is.
    const current = readParentPid();
    const reparented = initial > 1 && current > 0 && current !== initial;
    if (!reparented) {
      if (configured === 1) {
        return;
      }
      if (!isParentDead(configured)) {
        const currentStartTime = readParentStartTime?.(configured) ?? null;
        if (parentStartTime === null) {
          // Failed identity reads retry; absence is not evidence of PID reuse.
          parentStartTime = currentStartTime;
        }
        if (currentStartTime === null || currentStartTime === parentStartTime) {
          return;
        }
      }
    }
    clearInterval(timer);
    onOrphan();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
