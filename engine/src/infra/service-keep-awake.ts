// Always on: the per-user engine service holds the sleep blocker and refreshes power-state.json after the
// desktop app quits. While the app is open it writes keep-awake-owner.json so the two do not both hold the
// blocker, and so the app's battery reading (Electron) keeps winning until quit hands power to the engine.
// A child engine has no service marker, so this stays off and the app keeps today's behavior.
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isGatewayServiceEnv } from "../daemon/constants.js";
import {
  createRunKeepAwake,
  POWER_STATE_REFRESH_MS,
  writePowerState,
  type BlockerProcess,
} from "./keep-awake.js";

/** Same file and freshness the desktop app writes (desktop/src/keep-awake.ts). */
export const KEEP_AWAKE_OWNER_FILE = "keep-awake-owner.json";
/** The app rewrites the file every few seconds. Older than this, the engine takes sleep and power. */
export const DESKTOP_KEEP_AWAKE_FRESH_MS = 20_000;
/** Service tick while a run is active; must stay below KEEP_AWAKE_LEASE_MS so a long run cannot drop the hold. */
export const SERVICE_KEEP_AWAKE_POLL_MS = 2_000;
const BATTERY_PROBE_MS = 30_000;

export type KeepAwakeDuty = "desktop" | "engine";

export interface KeepAwakeOwnership {
  /** Who holds the platform sleep blocker. */
  sleep: KeepAwakeDuty;
  /** Who refreshes power-state.json. */
  power: KeepAwakeDuty;
}

const ENGINE_OWNS: KeepAwakeOwnership = { sleep: "engine", power: "engine" };

/** Missing, stale, or unreadable means the engine owns both. A fresh file can leave one duty with the app. */
export function readKeepAwakeOwnership(stateDir: string, now = Date.now()): KeepAwakeOwnership {
  try {
    const value = JSON.parse(readFileSync(path.join(stateDir, KEEP_AWAKE_OWNER_FILE), "utf8")) as {
      sleep?: unknown;
      power?: unknown;
      at?: unknown;
    };
    const at = value.at;
    if (typeof at !== "number" || now - at < 0 || now - at >= DESKTOP_KEEP_AWAKE_FRESH_MS) {
      return ENGINE_OWNS;
    }
    return {
      sleep: value.sleep === "desktop" ? "desktop" : "engine",
      power: value.power === "desktop" ? "desktop" : "engine",
    };
  } catch {
    return ENGINE_OWNS;
  }
}

/** True only while a Trunk (or its helper) has a live run, never leftover queue or terminal counts. */
export function serviceRunIsActive(counts: {
  embeddedRuns: number;
  agentRuns: number;
  chatRuns: number;
  acpRuns: number;
  subagentRuns?: number;
}): boolean {
  return (
    Math.max(
      0,
      counts.embeddedRuns,
      counts.agentRuns,
      counts.chatRuns,
      counts.acpRuns,
      counts.subagentRuns ?? 0,
    ) > 0
  );
}

interface KeepAwakeSettings {
  keepAwake: boolean;
  keepAwakeOnBattery: boolean;
}

/** Same defaults as the desktop Settings switches: on while plugged in, off on battery. */
export function readKeepAwakeSettings(file: string): KeepAwakeSettings {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      keepAwake?: unknown;
      keepAwakeOnBattery?: unknown;
    };
    return {
      keepAwake: typeof saved.keepAwake === "boolean" ? saved.keepAwake : true,
      keepAwakeOnBattery:
        typeof saved.keepAwakeOnBattery === "boolean" ? saved.keepAwakeOnBattery : false,
    };
  } catch {
    return { keepAwake: true, keepAwakeOnBattery: false };
  }
}

export interface PowerRead {
  readdir?(dir: string): string[];
  readFile?(file: string): string;
  execFile?(file: string, args: string[]): string;
}

function readText(io: PowerRead, file: string): string {
  try {
    return io.readFile?.(file) ?? "";
  } catch {
    return "";
  }
}

function linuxOnBattery(io: PowerRead): boolean {
  let names: string[];
  try {
    names = io.readdir?.("/sys/class/power_supply") ?? [];
  } catch {
    return false;
  }
  let acOnline = false;
  let discharging = false;
  for (const name of names) {
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      continue;
    }
    const base = `/sys/class/power_supply/${name}`;
    const type = readText(io, `${base}/type`).trim();
    if ((type === "Mains" || type === "USB") && readText(io, `${base}/online`).trim() === "1") {
      acOnline = true;
    } else if (type === "Battery" && readText(io, `${base}/status`).trim() === "Discharging") {
      discharging = true;
    }
  }
  if (acOnline) {
    return false;
  }
  return discharging;
}

/** True when this computer is running on battery. A probe that cannot tell says plugged in. */
export function readPlatformOnBatterySync(platform: NodeJS.Platform, io: PowerRead): boolean {
  try {
    if (platform === "linux") {
      return linuxOnBattery(io);
    }
    if (platform === "darwin") {
      const text = io.execFile?.("/usr/bin/pmset", ["-g", "batt"]) ?? "";
      return text.includes("Now drawing from 'Battery Power'");
    }
    if (platform === "win32") {
      const text = io.execFile?.("powershell.exe", ["-NoProfile", "-Command", "ac"]) ?? "";
      return text.trim() === "0";
    }
  } catch {
    return false;
  }
  return false;
}

const WINDOWS_AC_LINE = [
  "$k = Add-Type -Name PowerStatus -Namespace BranchAgentKeepAwake -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s); [StructLayout(LayoutKind.Sequential)] public struct SYSTEM_POWER_STATUS { public byte ACLineStatus; public byte BatteryFlag; public byte BatteryLifePercent; public byte SystemStatusFlag; public int BatteryLifeTime; public int BatteryFullLifeTime; }'",
  "$s = New-Object BranchAgentKeepAwake.PowerStatus+SYSTEM_POWER_STATUS",
  "[void]$k::GetSystemPowerStatus([ref]$s)",
  "Write-Output $s.ACLineStatus",
].join("; ");

function execText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 3_000, windowsHide: true, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        } else {
          resolve(String(stdout ?? ""));
        }
      },
    );
  });
}

/** Live power source. Failures reject; the caller keeps the last answer. */
export async function readPlatformOnBattery(platform: NodeJS.Platform): Promise<boolean> {
  if (platform === "linux") {
    return readPlatformOnBatterySync(platform, {
      readdir: (dir) => readdirSync(dir),
      readFile: (file) => readFileSync(file, "utf8"),
    });
  }
  if (platform === "darwin") {
    const text = await execText("/usr/bin/pmset", ["-g", "batt"]);
    return readPlatformOnBatterySync(platform, { execFile: () => text });
  }
  if (platform === "win32") {
    const text = await execText("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      WINDOWS_AC_LINE,
    ]);
    return readPlatformOnBatterySync(platform, { execFile: () => text });
  }
  return false;
}

export interface ServiceKeepAwakePaths {
  stateDir: string;
  settingsFile: string;
}

/** Set only for the desktop app's engine service. A child engine, or any other gateway, gets nothing. */
export function resolveServiceKeepAwakePaths(
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean = existsSync,
): ServiceKeepAwakePaths | undefined {
  if (!isGatewayServiceEnv(env)) {
    return undefined;
  }
  const home = env.BRANCH_HOME?.trim().replace(/[\\/]+$/u, "");
  if (!home) {
    return undefined;
  }
  const dataDir = path.dirname(home);
  const marked = ["gateway-token", "desktop.json", "desktop-settings.json"].some((name) => {
    try {
      return exists(path.join(dataDir, name));
    } catch {
      return false;
    }
  });
  if (!marked) {
    return undefined;
  }
  const stateDir = env.BRANCH_STATE_DIR?.trim() || path.join(home, ".branch");
  return { stateDir, settingsFile: path.join(dataDir, "desktop-settings.json") };
}

export interface ServiceKeepAwakeDeps {
  stateDir: string;
  settingsFile: string;
  platform: NodeJS.Platform;
  pid: number;
  now?: () => number;
  runsActive(): boolean;
  onBattery(): boolean;
  spawn?: KeepAwakeDepsSpawn;
  log?(line: string): void;
}

type KeepAwakeDepsSpawn = (
  file: string,
  args: string[],
  options: { stdio: "ignore"; windowsHide: true; detached: false },
) => BlockerProcess;

export interface ServiceKeepAwake {
  tick(): void;
  held(): boolean;
  stop(): void;
}

/** One check: hold or release the blocker, and refresh power-state when the engine owns that. */
export function createServiceKeepAwake(deps: ServiceKeepAwakeDeps): ServiceKeepAwake {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const settings: KeepAwakeSettings = { keepAwake: true, keepAwakeOnBattery: false };
  let battery = false;
  const keep = createRunKeepAwake({
    platform: deps.platform,
    appPid: deps.pid,
    spawn:
      deps.spawn ??
      ((file, args, options) =>
        spawn(file, args, { ...options, windowsHide: true }) as unknown as BlockerProcess),
    enabled: () => settings.keepAwake,
    onBatteryToo: () => settings.keepAwakeOnBattery,
    onBattery: () => battery,
    log,
  });
  let lastPowerAt = Number.NEGATIVE_INFINITY;
  let lastPower = false;
  let stopped = false;
  return {
    tick: () => {
      if (stopped) {
        return;
      }
      const at = now();
      const ownership = readKeepAwakeOwnership(deps.stateDir, at);
      const next = readKeepAwakeSettings(deps.settingsFile);
      settings.keepAwake = next.keepAwake;
      settings.keepAwakeOnBattery = next.keepAwakeOnBattery;
      battery = deps.onBattery();
      if (ownership.power === "engine") {
        if (battery !== lastPower || at - lastPowerAt >= POWER_STATE_REFRESH_MS) {
          writePowerState(deps.stateDir, battery, at);
          lastPower = battery;
          lastPowerAt = at;
        }
      }
      keep.update(ownership.sleep === "engine" && deps.runsActive());
    },
    held: () => keep.held(),
    stop: () => {
      stopped = true;
      keep.dispose();
    },
  };
}

/** Polls until stop. The timer does not keep the process alive. */
export function startServiceKeepAwake(
  deps: ServiceKeepAwakeDeps & { pollMs?: number },
): ServiceKeepAwake {
  const keep = createServiceKeepAwake(deps);
  const poll = (): void => {
    try {
      keep.tick();
    } catch (error) {
      (deps.log ?? (() => {}))(
        `keep awake: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  poll();
  const timer = setInterval(poll, deps.pollMs ?? SERVICE_KEEP_AWAKE_POLL_MS);
  timer.unref?.();
  return {
    tick: keep.tick,
    held: keep.held,
    stop: () => {
      clearInterval(timer);
      keep.stop();
    },
  };
}

/**
 * Starts the service owner when this process is the desktop app's engine service.
 * Returns undefined for a child engine and for any other gateway.
 */
export function maybeStartServiceKeepAwake(
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = () => {},
): { stop(): void } | undefined {
  const paths = resolveServiceKeepAwakePaths(env);
  if (!paths) {
    return undefined;
  }
  let runsActive = (): boolean => false;
  let onBattery = false;
  let stopped = false;
  const handle = startServiceKeepAwake({
    stateDir: paths.stateDir,
    settingsFile: paths.settingsFile,
    platform: process.platform,
    pid: process.pid,
    runsActive: () => runsActive(),
    onBattery: () => onBattery,
    log,
  });
  const probe = (): void => {
    void readPlatformOnBattery(process.platform)
      .then((next) => {
        if (stopped) {
          return;
        }
        onBattery = next;
        handle.tick();
      })
      .catch(() => {
        /* keep the last answer; a failed probe is not "plugged in" */
      });
  };
  probe();
  const batteryTimer = setInterval(probe, BATTERY_PROBE_MS);
  batteryTimer.unref?.();
  void import("./gateway-active-work.js")
    .then((mod) => {
      if (stopped) {
        return;
      }
      runsActive = () => serviceRunIsActive(mod.createGatewayActiveWorkSnapshot().counts);
      handle.tick();
    })
    .catch((error: unknown) => {
      log(
        `keep awake: run check failed (${error instanceof Error ? error.message : String(error)})`,
      );
    });
  return {
    stop: () => {
      stopped = true;
      clearInterval(batteryTimer);
      handle.stop();
    },
  };
}
