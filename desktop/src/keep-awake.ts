// Always on (Private #454 D): keep this computer awake only while a Trunk works, and be polite on battery. The sleep
// blocker is the OS's own (caffeinate on macOS, systemd-inhibit on Linux, SetThreadExecutionState on Windows), held by
// one child process that also waits on the app's process, so it can never outlive the app. It is taken when a run
// starts and released the moment the last run ends, fails, is cancelled or its process dies. A hold that is not
// renewed by a live run expires on its own. By default it is not taken on battery. Nothing here imports
// Electron: main.ts gives it the run state, the power state and the spawn call, so the tests use fakes.
// With the per-user engine service, the engine holds that blocker itself (engine/src/infra/service-keep-awake.ts).
// This app then does not hold a second one. It keeps writing the power source until quit, then hands that to the engine.
import type { SpawnOptions } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SleepBlockerCommand { file: string; args: string[] }

/** PowerShell for Windows: ES_CONTINUOUS | ES_SYSTEM_REQUIRED on this thread until the app's process ends. */
function windowsBlockerScript(appPid: number): string {
  return [
    "$k = Add-Type -Name Power -Namespace BranchAgent -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
    // 0x80000001: ES_CONTINUOUS | ES_SYSTEM_REQUIRED.
    "[void]$k::SetThreadExecutionState([uint32]2147483649)",
    `Wait-Process -Id ${appPid}`,
  ].join("; ");
}

/**
 * The OS sleep blocker for this platform. It keeps the system awake (the display may still sleep and the screen may
 * still lock) and ends on its own when the app's process `appPid` ends.
 */
export function sleepBlockerCommand(platform: NodeJS.Platform, appPid: number): SleepBlockerCommand | undefined {
  if (platform === "darwin") return { file: "caffeinate", args: ["-i", "-w", String(appPid)] };
  if (platform === "linux") {
    return { file: "systemd-inhibit", args: ["--what=idle:sleep", "--who=Branch Agent", "--why=A Trunk is working", "--mode=block",
      "tail", `--pid=${appPid}`, "-f", "/dev/null"] };
  }
  if (platform === "win32") {
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", windowsBlockerScript(appPid)] };
  }
  return undefined;
}

export interface BlockerProcess {
  kill(): boolean;
  once(event: "exit", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface KeepAwakeDeps {
  platform: NodeJS.Platform;
  appPid: number;
  spawn(file: string, args: string[], options: SpawnOptions): BlockerProcess;
  /** "Keep this computer awake while Trunks work". */
  enabled(): boolean;
  /** Also on battery (off by default). */
  onBatteryToo(): boolean;
  onBattery(): boolean;
  log(line: string): void;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

export interface RunKeepAwake {
  /** The live run state: true while at least one Trunk has a live run. */
  update(working: boolean): void;
  /** The setting or the power source changed. */
  refresh(): void;
  held(): boolean;
  /** Quit: released at once. */
  dispose(): void;
}

/** A hold must be renewed by a live run within this window or it is dropped. */
export const KEEP_AWAKE_LEASE_MS = 30_000;
/** Tray status (and with it the hold) is refreshed this often while a Trunk works. Must stay below the lease. */
export const TRAY_STATUS_WORKING_MS = 3_000;
/** Tray status when no Trunk is working. Also below the lease. */
export const TRAY_STATUS_MS = 10_000;

/** Holds the sleep blocker exactly while a run is active (and the setting and power source allow it). */
export function createRunKeepAwake(deps: KeepAwakeDeps): RunKeepAwake {
  let blocker: BlockerProcess | undefined;
  let working = false;
  let disposed = false;
  let stale = false;
  let confirmedAt = 0;
  let leaseTimer: unknown;
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? ((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  });
  const cancel = deps.clearTimeout ?? ((timer: unknown) => { clearTimeout(timer as NodeJS.Timeout); });
  const wanted = (): boolean => !disposed && working && deps.enabled() && (!deps.onBattery() || deps.onBatteryToo());
  const apply = (): void => {
    if (wanted() && !blocker) {
      const command = sleepBlockerCommand(deps.platform, deps.appPid);
      if (!command) return;
      try {
        const child = deps.spawn(command.file, command.args, { stdio: "ignore", windowsHide: true, detached: false });
        blocker = child;
        child.on("error", (error) => {
          deps.log(`keep awake: ${command.file} could not run (${error.message})`);
          if (blocker === child) blocker = undefined;
        });
        child.once("exit", () => { if (blocker === child) blocker = undefined; });
        deps.log("keep awake: held while a Trunk works");
      } catch (error) {
        deps.log(`keep awake: ${command.file} could not run (${error instanceof Error ? error.message : String(error)})`);
      }
    } else if (!wanted() && blocker) {
      const child = blocker;
      blocker = undefined;
      child.kill();
      deps.log(stale ? "keep awake: released (no live Trunk run)" : "keep awake: released");
      stale = false;
    }
  };
  const clearLease = (): void => {
    if (leaseTimer === undefined) return;
    cancel(leaseTimer);
    leaseTimer = undefined;
  };
  const armLease = (): void => {
    clearLease();
    if (disposed || !working) return;
    const wait = Math.max(1, KEEP_AWAKE_LEASE_MS - (now() - confirmedAt));
    leaseTimer = schedule(() => {
      leaseTimer = undefined;
      if (disposed || !working) return;
      if (now() - confirmedAt < KEEP_AWAKE_LEASE_MS) {
        armLease();
        return;
      }
      stale = true;
      working = false;
      apply();
    }, wait);
  };
  return {
    update: (next) => {
      working = next;
      if (next) {
        confirmedAt = now();
        stale = false;
        apply();
        armLease();
        return;
      }
      clearLease();
      apply();
    },
    refresh: apply,
    held: () => blocker !== undefined,
    dispose: () => { disposed = true; clearLease(); apply(); },
  };
}

/** Where the app tells the engine about the power source (engine/src/infra/power-state.ts reads it). */
export const POWER_STATE_FILE = "power-state.json";
/** The engine stops trusting the file after 30 minutes; the app rewrites it well before. */
export const POWER_STATE_REFRESH_MS = 5 * 60_000;

/** Polite on battery: the engine lowers its priority and backs off timed work that can wait while this says so. */
export function writePowerState(stateDir: string, onBattery: boolean, now = Date.now()): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, POWER_STATE_FILE);
    writeFileSync(`${file}.tmp`, JSON.stringify({ onBattery, at: now }));
    renameSync(`${file}.tmp`, file);
  } catch { /* best effort: without the file the engine runs as plugged in */ }
}

/**
 * Who holds sleep, and who refreshes power-state.json. The engine service reads this same file
 * (engine/src/infra/service-keep-awake.ts). Keep the name and the 20 second freshness together.
 */
export const KEEP_AWAKE_OWNER_FILE = "keep-awake-owner.json";
export const DESKTOP_KEEP_AWAKE_FRESH_MS = 20_000;
/** How often the open app rewrites the file, well inside the freshness window. */
export const SERVICE_KEEP_AWAKE_CLAIM_MS = 5_000;

export interface KeepAwakeOwnership { sleep: "desktop" | "engine"; power: "desktop" | "engine" }

/** The service engine holds the blocker. This app holds it only while it is running a child engine. */
export function appHoldsSleepBlock(serviceEngine: boolean): boolean {
  return !serviceEngine;
}

function writeKeepAwakeOwnership(stateDir: string, ownership: KeepAwakeOwnership, now: number): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, KEEP_AWAKE_OWNER_FILE);
    writeFileSync(`${file}.tmp`, JSON.stringify({ sleep: ownership.sleep, power: ownership.power, at: now }));
    renameSync(`${file}.tmp`, file);
  } catch { /* best effort: a missing file means the engine owns both */ }
}

/** While this app is open on the service: the engine holds sleep, and this app keeps the power file current. */
export function claimServiceKeepAwake(stateDir: string, now = Date.now()): void {
  writeKeepAwakeOwnership(stateDir, { sleep: "engine", power: "desktop" }, now);
}

/**
 * Quit on the service path. Release any blocker this process held, then tell the engine it owns sleep and power.
 * Releasing first means the two never hold the blocker at the same time.
 */
export function handOffKeepAwake(stateDir: string, keepAwake: { dispose(): void }, now = Date.now()): void {
  keepAwake.dispose();
  writeKeepAwakeOwnership(stateDir, { sleep: "engine", power: "engine" }, now);
}
