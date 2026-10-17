// Always on (Private #454, parts A and B): the engine runs as a per-user service and the app only attaches to it.
// The service itself is the engine's own `branch gateway install|start` (engine/src/daemon: a LaunchAgent, a
// systemd --user unit or a logon Scheduled Task, all per user), so there is one service implementation. This file
// drives that command, attaches to the engine it runs, and records the one fallback: a child engine when the service
// cannot be installed (a locked-down computer). With Keep working on, the desktop detaches that child and quit leaves
// it (fallback-engine.ts). Keep working off keeps today's child, which quit stops.
import { execFile } from "node:child_process";
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

/** The engine CLI arguments for one service step (run from the engine folder with the app's node). */
export function engineServiceArgs(action: EngineServiceAction | "token", port?: number): string[] {
  if (action === "install") return ["branch.mjs", "gateway", "install", "--port", String(port), "--json"];
  if (action === "start") return ["branch.mjs", "gateway", "start", "--json"];
  // An update (Private #454 E): run from the new engine, the restart rewrites the service definition to it and the
  // service manager restarts it. Never --force: the app only gets here once the engine reports no running work
  // (service-update.ts serviceWorkRefusal), and --force would begin the restart at once and cut off work that just
  // started. Not --safe either: --safe asks the RUNNING gateway to restart itself over RPC
  // (engine/src/cli/daemon-cli/lifecycle-safe-restart.ts), which skips the definition rewrite, so the service would
  // come back on the old engine. --force stays only on Stop Branch completely, after its warning.
  if (action === "restart") return ["branch.mjs", "gateway", "restart", "--json"];
  // Removes the service the engine wrote: bootout, the plist moved to the Trash, and a check that it is no longer loaded.
  if (action === "uninstall") return ["branch.mjs", "gateway", "uninstall", "--json"];
  // Stop Branch completely (C): the app is not a terminal, so the stop is confirmed with --force; the definition
  // stays, so the service starts again at the next sign-in (and the app starts it at its next launch).
  if (action === "stop") return ["branch.mjs", "gateway", "stop", "--force", "--json"];
  // The token arrives on stdin as a config patch, so it never shows in a process list.
  return ["branch.mjs", "config", "patch", "--stdin"];
}

export type EngineServiceAction = "install" | "start" | "restart" | "stop" | "uninstall";

/**
 * "Keep working when nobody is signed in" (Private #454 D, Linux): the engine's own systemd-linger path
 * (`branch gateway linger on|off|status`, engine/src/daemon/systemd-linger.ts).
 */
export function engineLingerArgs(want: "on" | "off" | "status"): string[] {
  return ["branch.mjs", "gateway", "linger", want, "--json"];
}

/** Reads `linger` from the engine's linger answer; rejects with its plain error. */
export function parseLingerAnswer(stdout: string): boolean {
  const answer = lastJsonObject(stdout);
  if (answer?.ok !== true || (answer.linger !== "yes" && answer.linger !== "no")) {
    throw new Error(typeof answer?.error === "string" ? answer.error : "the engine did not say whether linger is on");
  }
  return answer.linger === "yes";
}

export interface EngineCliCommand { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdin?: string; timeoutMs?: number }

/**
 * Runs one engine CLI command hidden and waits for it. Rejects on a non-zero exit or a JSON answer with ok false.
 * The command runs as a short-lived child of the app; a service it starts is started by the service manager, never
 * as the app's child, so it is outside the app's process tree (and on Windows outside the app's job object).
 */
export function runEngineCli(command: EngineCliCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command.file, command.args, {
      cwd: command.cwd, env: command.env, windowsHide: true, timeout: command.timeoutMs ?? 180_000, maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const answer = lastJsonObject(String(stdout));
      if (error || answer?.ok === false) {
        const detail = (typeof answer?.error === "string" && answer.error) || String(stderr).trim().split("\n").slice(-3).join(" ") || (error ? error.message : "");
        reject(new Error(`${command.args.slice(1, 3).join(" ")} failed: ${detail}`));
        return;
      }
      resolve(String(stdout));
    });
    child.stdin?.end(command.stdin ?? "");
  });
}

function lastJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  for (let start = trimmed.lastIndexOf("\n{"); ; start = trimmed.lastIndexOf("\n{", start - 1)) {
    try {
      const value = JSON.parse(start < 0 ? trimmed : trimmed.slice(start + 1)) as unknown;
      return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
    } catch { if (start < 0) return undefined; }
  }
}

/** Resolves true when an engine answers /readyz with 200 on 127.0.0.1:port. */
export async function engineAnswers(port: number, timeoutMs = 2_000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return res.status === 200;
  } catch { return false; }
}

/**
 * Honest health (Private #454 D): the engine's /health on 127.0.0.1:port. A local probe gets the reason, for
 * example the agent whose database is not admitting work. Never throws.
 */
export async function readEngineHealth(port: number, timeoutMs = 2_000): Promise<{ answered: boolean; degraded?: string }> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => ({})) as { ok?: unknown; status?: unknown; reason?: unknown };
    if (body.status === "degraded" || body.ok === false) {
      return { answered: true, degraded: typeof body.reason === "string" && body.reason ? body.reason : "an agent can't answer" };
    }
    return { answered: res.status === 200 };
  } catch { return { answered: false }; }
}

/** Polls `probe` until it answers or `timeoutMs` passes. */
export async function waitForEngineAnswer(probe: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() >= end) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, end - Date.now()))));
  }
}

export interface ServiceRestartSteps {
  /** The service engine answers /readyz on the gateway port. */
  probe(): Promise<boolean>;
  /** The engine stopped its own service after a crash storm (its marker was seen): the owner decides, not this loop. */
  stormed(): boolean;
  quitting(): boolean;
  /** `branch gateway start` through the service manager. */
  startService(): Promise<void>;
  /** Resolves true once the service engine answers, false when it never does in time. */
  waitForService(): Promise<boolean>;
  log(line: string): void;
}

/**
 * Brings a stopped engine service back through the service manager, never by starting a second engine in the app.
 * An engine that answers again by itself, a crash storm the engine stopped itself for, and quit all leave it alone.
 * Rejects when the started service does not answer, so the caller's backoff tries again.
 */
export async function restartStoppedServiceEngine(steps: ServiceRestartSteps): Promise<"answering" | "storm" | "quitting" | "restarted"> {
  if (steps.quitting()) return "quitting";
  if (await steps.probe()) return "answering";
  if (steps.stormed()) {
    steps.log("engine service: stopped after a crash storm; it starts again when Branch Agent is opened");
    return "storm";
  }
  steps.log("engine service: not answering; starting it through the service manager");
  await steps.startService();
  if (steps.quitting()) return "quitting";
  if (!await steps.waitForService()) throw new Error("the engine service was started but did not answer in time; see gateway.log");
  steps.log("engine service: answering again after a restart");
  return "restarted";
}

export type EngineMode = "service" | "child";
interface EngineModeRecord { mode: EngineMode; reason?: string; at: string; noticeShown?: boolean }
const modeFile = (dataDir: string): string => join(dataDir, "engine-mode.json");

function readEngineMode(dataDir: string): EngineModeRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(modeFile(dataDir), "utf8")) as Partial<EngineModeRecord>;
    return value.mode === "service" || value.mode === "child" ? value as EngineModeRecord : undefined;
  } catch { return undefined; }
}

function writeEngineMode(dataDir: string, record: EngineModeRecord): void {
  const file = modeFile(dataDir);
  try { writeFileSync(`${file}.tmp`, JSON.stringify(record)); renameSync(`${file}.tmp`, file); } catch { /* best effort */ }
}

/** How the engine runs on this computer, for Settings. */
export function recordEngineMode(dataDir: string, mode: EngineMode, reason?: string): void {
  const previous = readEngineMode(dataDir);
  // The child-mode notice is said once: a later launch that falls back again keeps it said.
  const noticeShown = mode === "child" && previous?.mode === "child" ? previous.noticeShown : undefined;
  writeEngineMode(dataDir, { mode, ...(reason ? { reason } : {}), at: new Date().toISOString(), ...(noticeShown ? { noticeShown } : {}) });
}

/** Settings › General › Starting up, when the engine keeps a custom copy off the per-user service (#1053). */
export const CUSTOM_COPY_SERVICE_LINE = "Running inside the app: this copy isn't the standard install, so the background service stays off.";
/** The data sits on another volume than the home folder, which macOS keeps launchd's background jobs from reading. */
export const EXTERNAL_VOLUME_SERVICE_LINE = "Running inside the app: your Branch data is on another drive, and macOS keeps background services from reading it.";
/** The installed service never started, and its logs show macOS (or the shell) would not let launchd run it. */
export const SERVICE_BLOCKED_LINE = "Running inside the app: macOS blocked Branch's background service from starting, so it was removed.";
/** Reasons that already read as complete Settings sentences: shown as they are, never cut down to a short phrase. */
const SELF_EXPLAINING_LINES: ReadonlySet<string> = new Set([CUSTOM_COPY_SERVICE_LINE, EXTERNAL_VOLUME_SERVICE_LINE, SERVICE_BLOCKED_LINE]);

/**
 * The reason the service could not be installed, in plain words for Settings. The engine's own refusal of a custom
 * setup ("service management skipped: non-default state dir or config path", with terminal repair steps for
 * environment variables the app sets itself) is never shown: Settings says CUSTOM_COPY_SERVICE_LINE and the full
 * engine answer stays in desktop.log. Any other refusal loses the CLI wrapping (`gateway install failed:`,
 * `Gateway install blocked:`, `Error:`) and keeps its first sentence, such as the OS's "Access is denied".
 */
export function plainServiceReason(reason: string): string {
  if (SELF_EXPLAINING_LINES.has(reason)) return reason;
  if (/service management skipped|non-default (?:state dir|install)/i.test(reason)) return CUSTOM_COPY_SERVICE_LINE;
  let text = reason.trim();
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/^(?:gateway \w+ failed|Gateway install blocked|Error):\s*/, "");
  }
  const first = /^[^\n]*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text.split("\n")[0] ?? text;
  return first.replace(/[.!?]$/, "").trim() || reason.trim();
}

const QUIT_STOPS_LINE = "Quitting Branch stops your Trunks.";
/** Keep working left the fallback running. It is not a service, so sign-out and reboot do not start it again. */
const QUIT_LEAVES_LINE = "Closing Branch leaves your Trunks running. They won't restart after you sign out or reboot.";

/**
 * The one-time Settings line for the engine running inside the app, from the reason takeChildModeNotice gives.
 * `keepsWorking`: the fallback was detached, so the line says it will not restart after sign-out or reboot.
 */
export function childModeSettingsLine(notice: string, keepsWorking = false): string {
  const ending = keepsWorking ? QUIT_LEAVES_LINE : QUIT_STOPS_LINE;
  if (SELF_EXPLAINING_LINES.has(notice)) return `${notice} ${ending}`;
  return `Branch runs inside the app on this computer because its background service couldn't be installed (${notice}). ${ending}`;
}

/** The reason the engine runs inside the app, the first time it is asked for; later calls return undefined. */
export function takeChildModeNotice(dataDir: string): string | undefined {
  const record = readEngineMode(dataDir);
  if (record?.mode !== "child" || record.noticeShown) return undefined;
  writeEngineMode(dataDir, { ...record, noticeShown: true });
  // A record written by an earlier build may hold the engine's own words; Settings still says them plainly.
  return record.reason ? plainServiceReason(record.reason) : "the background service could not be installed";
}

/**
 * The engine's crash-storm marker (engine/src/daemon/restart-storm.ts), taken once: the engine stopped its own
 * service after restarting too often, and this is the one plain message to show with its repair.
 */
export function takeCrashStormNotice(stateDir: string): string | undefined {
  const file = join(stateDir, "gateway-restart-storm.json");
  let message: string | undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { message?: unknown };
    message = typeof value.message === "string" && value.message ? value.message : undefined;
  } catch { return undefined; }
  try { unlinkSync(file); } catch { /* already taken */ }
  return message;
}

const START_LOCK_STALE_MS = 5 * 60_000;
const processAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
};

/**
 * One launcher at a time installs or starts the engine service. Resolves a release function once held, or undefined
 * when `attached` turns true while waiting (another launcher's engine came up). A lock left by a launcher that
 * exited, or older than five minutes, is taken over.
 */
export async function acquireEngineStartLock(dataDir: string, attached: () => Promise<boolean>, timeoutMs = 10 * 60_000): Promise<(() => void) | undefined> {
  const file = join(dataDir, "engine-start.lock");
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = openSync(file, "wx", 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      let released = false;
      return () => { if (!released) { released = true; try { unlinkSync(file); } catch { /* gone */ } } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let holder: { pid?: number; at?: number } = {};
    try { holder = JSON.parse(readFileSync(file, "utf8")) as typeof holder; } catch { /* being written */ }
    const stale = holder.pid !== undefined && (!processAlive(holder.pid) || Date.now() - (holder.at ?? 0) > START_LOCK_STALE_MS);
    if (stale) { try { unlinkSync(file); } catch { /* another launcher took it over */ } continue; }
    if (await attached()) return undefined;
    if (Date.now() >= end) throw new Error("another Branch Agent launch is still starting the engine");
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

/** Reads a path's real location and the device (volume) it sits on. Tests pass their own; the app uses nodeVolumeReader. */
export interface VolumeReader {
  realpath(path: string): Promise<string>;
  deviceOf(path: string): Promise<number>;
}

export const nodeVolumeReader: VolumeReader = {
  realpath: path => realpath(path),
  deviceOf: async path => (await stat(path)).dev,
};

/**
 * macOS privacy (TCC) keeps launchd's jobs off a volume other than the home volume unless the owner grants access, so a
 * service whose data is there cannot start (exit 126). Resolves the Settings reason when any path, after resolving
 * symlinks, sits on another volume than home. Other platforms are never blocked here. A folder that does not exist
 * yet is on home, as it will be created there.
 */
export async function serviceVolumeBlock(paths: readonly string[], home: string, reader: VolumeReader,
  platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  if (platform !== "darwin") return undefined;
  let homeDevice: number;
  try { homeDevice = await reader.deviceOf(await reader.realpath(home)); } catch { return undefined; }
  for (const path of paths) {
    let device: number;
    try { device = await reader.deviceOf(await reader.realpath(path)); } catch { continue; }
    if (device !== homeDevice) return EXTERNAL_VOLUME_SERVICE_LINE;
  }
  return undefined;
}

/**
 * What launchd cannot run: the shell that starts the service cannot exec its wrapper (macOS privacy), or the wrapper or
 * the node binary is denied. Only these lines count. An ordinary denial from the engine's own code (a plugin reading a
 * protected folder) is not a launch failure, so a slow service that logs one stays an error, never a removal.
 */
const SHELL_INIT_DENIED = /shell-init: error retrieving current directory\b.*Operation not permitted/;
const SHELL_CANNOT_EXEC = /^\/bin\/sh: .*: Operation not permitted\s*$/;
const DENIED = /Permission denied/;

/**
 * The Settings reason when launchd could not run the service, or undefined. `executables` are the paths a denial must
 * name to count (the service-env folder that holds the wrapper, and the node binary). `job` is launchd's view of the
 * label (launchd job lookup). A last exit of 126 or 127 counts only when the job is not running and has no live pid: a
 * stale exit from an earlier failed start must not remove a healthy service that is merely slow.
 */
export function serviceCannotRunReason(appendedLog: string, executables: readonly string[], job?: LaunchdJob): string | undefined {
  if (job && job.state === "not running" && job.pid === undefined && (job.lastExit === 126 || job.lastExit === 127)) return SERVICE_BLOCKED_LINE;
  for (const line of appendedLog.split("\n")) {
    if (SHELL_INIT_DENIED.test(line)) return SERVICE_BLOCKED_LINE;
    const namesExecutable = executables.some(path => path !== "" && line.includes(path));
    if (namesExecutable && (SHELL_CANNOT_EXEC.test(line) || DENIED.test(line))) return SERVICE_BLOCKED_LINE;
  }
  return undefined;
}

/** The LaunchAgent label the engine writes (engine/src/daemon/constants.ts). */
export const SERVICE_LAUNCHD_LABEL = "ai.branch.gateway";

/** launchd's view of a job from `launchctl print`: its state, its live pid (only while running) and its last exit status. */
export interface LaunchdJob { state?: string; pid?: number; lastExit?: number }

/**
 * Reads the job's state, pid and last exit code from `launchctl print` output, and launchd's last exit status for the
 * label in the user's GUI domain. Undefined fields are unknown. A failed lookup reads as an empty job.
 */
export function parseLaunchdJob(output: string): LaunchdJob {
  const value = (key: string): string | undefined => new RegExp(`^\\s*${key} = (.+)$`, "m").exec(output)?.[1]?.trim();
  const state = value("state");
  const pid = value("pid");
  const lastExit = value("last exit code");
  return {
    ...(state ? { state } : {}),
    ...(pid && /^\d+$/.test(pid) ? { pid: Number(pid) } : {}),
    ...(lastExit && /^\d+$/.test(lastExit) ? { lastExit: Number(lastExit) } : {}),
  };
}

export async function launchdJob(label = SERVICE_LAUNCHD_LABEL, uid = process.getuid?.() ?? 0): Promise<LaunchdJob> {
  const output = await new Promise<string>(resolve => {
    execFile("launchctl", ["print", `gui/${uid}/${label}`], { timeout: 5_000, windowsHide: true }, (_error, stdout) => resolve(String(stdout)));
  });
  return parseLaunchdJob(output);
}

/** The two launchd log files the macOS service writes (stdout and stderr), under the owner's home folder. */
export function serviceLogPaths(home: string): string[] {
  const dir = join(home, "Library", "Logs", "branch");
  return [join(dir, "gateway.log"), join(dir, "gateway.err.log")];
}

/** The size of each service log now: a later read starts here, so only this start's lines count. */
export async function serviceLogSizes(paths: readonly string[]): Promise<number[]> {
  return Promise.all(paths.map(file => stat(file).then(info => info.size, () => 0)));
}

/** The text each service log gained since `sizes` (a log that was rotated or shrank is read from its start). */
export async function readServiceLogsSince(paths: readonly string[], sizes: readonly number[]): Promise<string> {
  const parts: string[] = [];
  for (const [index, file] of paths.entries()) {
    let handle;
    try { handle = await open(file, "r"); } catch { continue; }
    try {
      const { size } = await handle.stat();
      const from = size < (sizes[index] ?? 0) ? 0 : sizes[index] ?? 0;
      const bytes = Buffer.alloc(size - from);
      await handle.read(bytes, 0, bytes.length, from);
      if (bytes.length) parts.push(bytes.toString("utf8"));
    } finally { await handle.close(); }
  }
  return parts.join("\n");
}

export interface EngineAttachSteps {
  dataDir: string;
  /** An engine answers on the gateway port. */
  probe(): Promise<boolean>;
  /** `branch gateway install` (engine/src/daemon); rejects when the service cannot be installed. */
  installService(): Promise<void>;
  /** `branch gateway start` for the installed service. */
  startService(): Promise<void>;
  /** After a successful install: resolves true once the service engine answers, false when it never does. */
  waitForService(): Promise<boolean>;
  /** The fallback: today's child engine, started and ready. */
  spawnChild(): Promise<void>;
  /**
   * macOS: the Settings reason when the engine's data or state folder is on another volume than home, so launchd cannot
   * run a service there. Undefined when every folder is on home. Checked before any install.
   */
  volumeBlock?(): Promise<string | undefined>;
  /** Marks where this start's log lines begin, before the install. */
  logMark?(): Promise<number[]>;
  /** The Settings reason when the service's logs since `mark` show launchd could not run it; undefined otherwise. */
  cannotRunReason?(mark: number[]): Promise<string | undefined>;
  /**
   * `branch gateway uninstall`: stops the service, removes its LaunchAgent and checks it is no longer loaded. Rejects
   * when it is still there. Undefined when the supervisor manages the service (BRANCH_SUPERVISOR_MODE=external).
   */
  uninstallService?(): Promise<void>;
  log(line: string): void;
  lockTimeoutMs?: number;
}

export type EngineAttachResult = { mode: "service"; via: "attached" | "started" } | { mode: "child"; reason: string };

/**
 * Launch: attach to the engine that already answers; else install and start the service, then attach. Never a
 * second engine: the probe runs again under the start lock, and an installed service that is slow to answer is
 * an error, not a reason to start a child beside it. A service that cannot be installed, or that launchd cannot run,
 * is removed (confirmed gone) before the one child engine starts, recorded for Settings. A data folder on another
 * volume (macOS privacy) chooses the child engine up front, without installing anything.
 */
export async function attachOrStartEngine(steps: EngineAttachSteps): Promise<EngineAttachResult> {
  const attached = (): EngineAttachResult => {
    recordEngineMode(steps.dataDir, "service");
    steps.log("engine: attached to the running service engine");
    return { mode: "service", via: "attached" };
  };
  if (await steps.probe()) return attached();
  const release = await acquireEngineStartLock(steps.dataDir, steps.probe, steps.lockTimeoutMs);
  if (!release) return attached();
  try {
    if (await steps.probe()) return attached();
    const volume = await steps.volumeBlock?.();
    if (volume) return await childFallback(steps, attached, volume, volume, true);
    const mark = await steps.logMark?.() ?? [];
    let installError: unknown;
    try { await steps.installService(); } catch (error) { installError = error; }
    if (installError === undefined) {
      // From here a service exists: whatever goes wrong is reported, never answered with a second engine.
      await steps.startService();
      if (await steps.waitForService()) {
        recordEngineMode(steps.dataDir, "service");
        steps.log("engine: service installed and started; attached");
        return { mode: "service", via: "started" };
      }
      const cannotRun = await steps.cannotRunReason?.(mark);
      if (!cannotRun) throw new Error("Branch Agent's engine service started but did not answer in time; see gateway.log");
      // Only a service this app can remove is replaced by the child: an externally managed one is never guessed at.
      if (!steps.uninstallService) throw new Error("the background service cannot run and is managed outside Branch Agent; see gateway.log");
      steps.log("engine: launchd could not run the service; removing it before running the engine inside the app");
      return await childFallback(steps, attached, cannotRun, cannotRun, true);
    }
    // An engine that came up meanwhile (a slow first start) is attached to, never doubled.
    const reason = installError instanceof Error ? installError.message : String(installError);
    return await childFallback(steps, attached, plainServiceReason(reason), reason, false);
  } finally {
    release();
  }
}

/**
 * The one child engine: removes the service first when it exists (and the app manages it), then starts the child.
 * A child is started only once the service is confirmed gone; a failed removal throws and nothing starts.
 */
async function childFallback(steps: EngineAttachSteps, attached: () => EngineAttachResult, settingsReason: string, reason: string,
  removeService: boolean): Promise<EngineAttachResult> {
  if (removeService && steps.uninstallService) {
    await steps.uninstallService();
    steps.log("engine: removed the background service");
  }
  // An engine that came up meanwhile is attached to, never doubled.
  if (await steps.probe()) return attached();
  steps.log(`engine: the background service is not used (${reason}); running the engine inside the app`);
  recordEngineMode(steps.dataDir, "child", settingsReason);
  await steps.spawnChild();
  return { mode: "child", reason };
}
