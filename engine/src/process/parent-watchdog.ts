// Adapted from Kilo-Org/kilocode parent-watchdog.ts (6fd9b7b29ce63b5a38176e45b738e94ed6167cfb).
import { isPidDefinitelyDead } from "../shared/pid-alive.ts";

export type ParentWatchdogOptions = {
  env?: NodeJS.ProcessEnv;
  readParentPid?: () => number;
  isParentDead?: (pid: number) => boolean;
};

/**
 * Stop an embedded engine when the client that launched it dies.
 * BRANCH_PARENT_PID opts in; manually launched gateways never watch their shell.
 * Only definite death or reparenting ends the engine. Inconclusive probes leave
 * it running, including EPERM. Linux zombie detection uses the native PID helper.
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
  const initial = readParentPid();
  const timer = setInterval(() => {
    // PID 1 is never considered gone, but reparenting away from a known spawner is.
    if (initial === 1 || readParentPid() === initial) {
      if (configured === 1 || !isParentDead(configured)) {
        return;
      }
    }
    clearInterval(timer);
    onOrphan();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
