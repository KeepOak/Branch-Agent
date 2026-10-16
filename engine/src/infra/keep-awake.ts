// Platform sleep blocker and power-state writer, the same ones desktop/src/keep-awake.ts uses for a child
// engine. The per-user engine service runs this copy itself, because the desktop package is not imported here.
// One child process waits on this process, so the blocker cannot outlive the engine. It is taken when a run
// starts and released when the last run ends. By default it is not taken on battery.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SleepBlockerCommand {
  file: string;
  args: string[];
}

/** PowerShell for Windows: ES_CONTINUOUS | ES_SYSTEM_REQUIRED on this thread until the engine process ends. */
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
 * still lock) and ends on its own when the process `appPid` ends.
 */
export function sleepBlockerCommand(
  platform: NodeJS.Platform,
  appPid: number,
): SleepBlockerCommand | undefined {
  if (platform === "darwin") {
    return { file: "caffeinate", args: ["-i", "-w", String(appPid)] };
  }
  if (platform === "linux") {
    return {
      file: "systemd-inhibit",
      args: [
        "--what=idle:sleep",
        "--who=Branch Agent",
        "--why=A Trunk is working",
        "--mode=block",
        "tail",
        `--pid=${appPid}`,
        "-f",
        "/dev/null",
      ],
    };
  }
  if (platform === "win32") {
    return {
      file: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        windowsBlockerScript(appPid),
      ],
    };
  }
  return undefined;
}

export interface BlockerProcess {
  kill(): boolean;
  once(event: "exit", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** The only options a sleep-blocker child is started with. Windows must not flash a console. */
export interface SleepBlockerSpawnOptions {
  stdio: "ignore";
  windowsHide: true;
  detached: false;
}

export interface KeepAwakeDeps {
  platform: NodeJS.Platform;
  appPid: number;
  /** Starts the blocker. This file does not call child_process itself. */
  spawn(file: string, args: string[], options: SleepBlockerSpawnOptions): BlockerProcess;
  /** "Keep this computer awake while Trunks work". */
  enabled(): boolean;
  /** Also on battery (off by default). */
  onBatteryToo(): boolean;
  onBattery(): boolean;
  log(line: string): void;
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

/** Holds the sleep blocker exactly while a run is active (and the setting and power source allow it). */
export function createRunKeepAwake(deps: KeepAwakeDeps): RunKeepAwake {
  let blocker: BlockerProcess | undefined;
  let working = false;
  let disposed = false;
  const wanted = (): boolean =>
    !disposed && working && deps.enabled() && (!deps.onBattery() || deps.onBatteryToo());
  const apply = (): void => {
    if (wanted() && !blocker) {
      const command = sleepBlockerCommand(deps.platform, deps.appPid);
      if (!command) {
        return;
      }
      try {
        const child = deps.spawn(command.file, command.args, {
          stdio: "ignore",
          windowsHide: true,
          detached: false,
        });
        blocker = child;
        child.on("error", (error) => {
          deps.log(`keep awake: ${command.file} could not run (${error.message})`);
          if (blocker === child) {
            blocker = undefined;
          }
        });
        child.once("exit", () => {
          if (blocker === child) {
            blocker = undefined;
          }
        });
        deps.log("keep awake: held while a Trunk works");
      } catch (error) {
        deps.log(
          `keep awake: ${command.file} could not run (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    } else if (!wanted() && blocker) {
      const child = blocker;
      blocker = undefined;
      child.kill();
      deps.log("keep awake: released");
    }
  };
  return {
    update: (next) => {
      working = next;
      apply();
    },
    refresh: apply,
    held: () => blocker !== undefined,
    dispose: () => {
      disposed = true;
      apply();
    },
  };
}

/** Where the app, and the engine service after handoff, record the power source. */
export const POWER_STATE_FILE = "power-state.json";
/** power-state.ts stops trusting the file after 30 minutes; rewrite it well before that. */
export const POWER_STATE_REFRESH_MS = 5 * 60_000;

/** Polite on battery: the engine lowers its priority and backs off timed work that can wait while this says so. */
export function writePowerState(stateDir: string, onBattery: boolean, now = Date.now()): void {
  try {
    mkdirSync(stateDir, { recursive: true });
    const file = join(stateDir, POWER_STATE_FILE);
    writeFileSync(`${file}.tmp`, JSON.stringify({ onBattery, at: now }));
    renameSync(`${file}.tmp`, file);
  } catch {
    /* best effort: without the file the engine runs as plugged in */
  }
}
