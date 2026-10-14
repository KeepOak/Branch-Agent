// Always on (Private #454, parts A and B): the engine runs as a per-user service and the app only attaches to it.
// The service itself is the engine's own `branch gateway install|start` (engine/src/daemon: a LaunchAgent, a
// systemd --user unit or a logon Scheduled Task, all per user), so there is one service implementation. This file
// drives that command, attaches to the engine it runs, and records the one fallback: a child engine when the service
// cannot be installed (a locked-down computer).
import { execFile } from "node:child_process";
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

/** The engine CLI arguments for one service step (run from the engine folder with the app's node). */
export function engineServiceArgs(action: "install" | "start" | "token", port?: number): string[] {
  if (action === "install") return ["branch.mjs", "gateway", "install", "--port", String(port), "--json"];
  if (action === "start") return ["branch.mjs", "gateway", "start", "--json"];
  // The token arrives on stdin as a config patch, so it never shows in a process list.
  return ["branch.mjs", "config", "patch", "--stdin"];
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

/** Polls `probe` until it answers or `timeoutMs` passes. */
export async function waitForEngineAnswer(probe: () => Promise<boolean>, timeoutMs: number, intervalMs = 500): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return true;
    if (Date.now() >= end) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, end - Date.now()))));
  }
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

/** The reason the engine runs inside the app, the first time it is asked for; later calls return undefined. */
export function takeChildModeNotice(dataDir: string): string | undefined {
  const record = readEngineMode(dataDir);
  if (record?.mode !== "child" || record.noticeShown) return undefined;
  writeEngineMode(dataDir, { ...record, noticeShown: true });
  return record.reason ?? "the background service could not be installed";
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
  log(line: string): void;
  lockTimeoutMs?: number;
}

export type EngineAttachResult = { mode: "service"; via: "attached" | "started" } | { mode: "child"; reason: string };

/**
 * Launch: attach to the engine that already answers; else install and start the service, then attach. Never a
 * second engine: the probe runs again under the start lock, and an installed service that is slow to answer is
 * an error, not a reason to start a child beside it. Only a service that cannot be installed falls back to one
 * child engine, recorded for Settings.
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
    let installError: unknown;
    try { await steps.installService(); } catch (error) { installError = error; }
    if (installError === undefined) {
      // From here a service exists: whatever goes wrong is reported, never answered with a second engine.
      await steps.startService();
      if (!await steps.waitForService()) throw new Error("Branch Agent's engine service started but did not answer in time; see gateway.log");
      recordEngineMode(steps.dataDir, "service");
      steps.log("engine: service installed and started; attached");
      return { mode: "service", via: "started" };
    }
    // An engine that came up meanwhile (a slow first start) is attached to, never doubled.
    if (await steps.probe()) return attached();
    const reason = installError instanceof Error ? installError.message : String(installError);
    steps.log(`engine: the background service could not be installed (${reason}); running the engine inside the app`);
    recordEngineMode(steps.dataDir, "child", reason);
    await steps.spawnChild();
    return { mode: "child", reason };
  } finally {
    release();
  }
}
