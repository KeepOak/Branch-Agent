// Process helpers for the fallback engine child: wait, escalate, and signal.
import { spawn, type ChildProcess } from "node:child_process";
import { isPidAlive } from "../../shared/pid-alive.js";

export type AppChildSpawnFn = typeof spawn;
export type AppChildSleepFn = (ms: number) => Promise<void>;

export const DEFAULT_CHILD_STOP_WAIT_MS = 3_000;

export function defaultAppChildSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function forceKillPid(
  pid: number,
  spawnImpl: AppChildSpawnFn = spawn,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    spawnImpl("taskkill", ["/T", "/F", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process may have exited between the wait and the escalate.
  }
}

export async function waitForPidExit(params: {
  pid: number;
  timeoutMs: number;
  sleep?: AppChildSleepFn;
  isAlive?: (pid: number) => boolean;
  child?: ChildProcess | null;
}): Promise<boolean> {
  const sleep = params.sleep ?? defaultAppChildSleep;
  const alive = params.isAlive ?? isPidAlive;
  const deadline = Date.now() + params.timeoutMs;
  const exited = params.child
    ? new Promise<boolean>((resolve) => {
        params.child?.once("exit", () => resolve(true));
      })
    : null;
  while (Date.now() < deadline && alive(params.pid)) {
    const remaining = Math.max(0, deadline - Date.now());
    const finished = exited
      ? await Promise.race([exited, sleep(Math.min(50, remaining)).then(() => false)])
      : await sleep(Math.min(50, remaining)).then(() => false);
    if (finished) {
      return true;
    }
  }
  return !alive(params.pid);
}

export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // The process may have already exited.
  }
}
