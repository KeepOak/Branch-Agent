// Polite on battery (Private #454 D). The Branch Agent app knows when this computer runs on battery and writes
// power-state.json into the engine's state directory. After Quit Branch, the per-user engine service keeps writing
// that file itself (service-keep-awake.ts). The engine then lowers its own process priority and backs off timed work
// that can wait (the heartbeat's interval polls). An old file counts as plugged in, so a stale answer never keeps
// the engine slow.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export const POWER_STATE_FILE = "power-state.json";
/** The app rewrites the file every few minutes while it runs; older than this, it no longer counts. */
export const POWER_STATE_STALE_MS = 30 * 60_000;
/** On battery, an interval poll waits this many intervals after the last run. */
export const BATTERY_BACKOFF_FACTOR = 3;
const POWER_STATE_POLL_MS = 30_000;

/** True when the app said, recently, that this computer runs on battery. */
export function readOnBattery(stateDir: string, now = Date.now()): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(stateDir, POWER_STATE_FILE), "utf8")) as {
      onBattery?: unknown;
      at?: unknown;
    };
    return (
      value.onBattery === true &&
      typeof value.at === "number" &&
      now - value.at >= 0 &&
      now - value.at < POWER_STATE_STALE_MS
    );
  } catch {
    return false;
  }
}

export type BatteryPoliteness = {
  /** The last power state read. */
  onBattery: () => boolean;
  /** How long a deferrable interval poll waits after its last run, or undefined when plugged in. */
  backoffMs: (intervalMs: number | undefined) => number | undefined;
  stop: () => void;
};

/**
 * Watches the app's power state: on battery the engine runs below normal priority, plugged in it goes back to
 * normal (where the OS lets a process raise its own priority again; otherwise it stays lowered until the next start).
 */
export function startBatteryPoliteness(
  opts: {
    stateDir?: string;
    pollMs?: number;
    now?: () => number;
    setPriority?: (priority: number) => void;
    log?: (message: string) => void;
  } = {},
): BatteryPoliteness {
  const stateDir = opts.stateDir ?? resolveStateDir(process.env);
  const now = opts.now ?? Date.now;
  const setPriority = opts.setPriority ?? ((priority: number) => os.setPriority(priority));
  let onBattery = false;
  const check = () => {
    const next = readOnBattery(stateDir, now());
    if (next === onBattery) {
      return;
    }
    onBattery = next;
    try {
      setPriority(next ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL);
      opts.log?.(next ? "on battery: running at lower priority" : "plugged in: normal priority");
    } catch (error) {
      opts.log?.(`power priority unchanged: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  check();
  const timer = setInterval(check, opts.pollMs ?? POWER_STATE_POLL_MS);
  timer.unref?.();
  return {
    onBattery: () => onBattery,
    backoffMs: (intervalMs) =>
      onBattery && intervalMs !== undefined && intervalMs > 0
        ? intervalMs * BATTERY_BACKOFF_FACTOR
        : undefined,
    stop: () => clearInterval(timer),
  };
}
