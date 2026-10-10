// Starts the Branch engine gateway as a child process (as the early copy's start.sh does) and stops it by PID.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, createWriteStream, openSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { constants as osConstants, setPriority } from "node:os";
import { join } from "node:path";
import type { DesktopConfig } from "./config";
import { prepareNormalProfile, readPreparedNormalProfile } from "./profile-migration";
import { recordEngine } from "./engine-records";
import { engineSpawnOptions } from "./engine-spawn";
import { HANDOFF_ROLLBACK_TIMEOUT_MS, HANDOFF_STEP_DOWN_TIMEOUT_MS, HANDOFF_TAKE_OVER_TIMEOUT_MS } from "./handoff-timeouts";

export function readToken(cfg: DesktopConfig): string {
  mkdirSync(cfg.dataDir, { recursive: true });
  const file = join(cfg.dataDir, "gateway-token");
  try { return readFileSync(file, "utf8").trim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
    catch (createError) { if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError; }
    return readFileSync(file, "utf8").trim();
  }
}

/** Resolves true when nothing listens on 127.0.0.1:port. */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/** A loopback port nothing listens on right now: the OS picks it for a throwaway listener. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Tests only: BRANCH_DESKTOP_ENGINE_PROFILE gives the engine its own user profile, so its state-owner lock
 * (under the profile's AppData/Local/Branch Agent/locks) never mixes with a real engine's. Unset for the owner's runs.
 */
function testProfile(): Record<string, string> {
  const dir = process.env.BRANCH_DESKTOP_ENGINE_PROFILE;
  if (!dir) return {};
  return {
    USERPROFILE: dir,
    HOME: dir,
    LOCALAPPDATA: join(dir, "AppData", "Local"),
    APPDATA: join(dir, "AppData", "Roaming"),
  };
}

/** `port` defaults to the configured one; an update's standby passes its own spare port without changing the config. */
export function startGateway(cfg: DesktopConfig, engineDir: string, token: string, standby = false, port = cfg.gatewayPort, macComputerEndpoint?: string): ChildProcess {
  // The profile check can refuse a standby; it runs before the log is opened so a refusal leaks nothing.
  const prepared = standby ? readPreparedNormalProfile(join(cfg.dataDir, "home")) : undefined;
  const logPath = join(cfg.dataDir, "gateway.log");
  const log = createWriteStream(logPath, { flags: "a" });
  const profile = prepared ?? prepareNormalProfile(join(cfg.dataDir, "home"), undefined, (message) => {
    if (message === "Profile migration start") appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
    else log.write(message + "\n");
  }, join(engineDir, "docs", "reference", "templates"));
  if (profile.note) log.write(profile.note + "\n");
  const env = {
    ...process.env,
    BRANCH_PROFILE: profile.legacyDevMode ? "dev" : "default",
    BRANCH_HOME: join(cfg.dataDir, "home"),
    ...(profile.legacyDevMode ? { BRANCH_STATE_DIR: undefined, BRANCH_CONFIG_PATH: undefined } : {
      BRANCH_STATE_DIR: join(cfg.dataDir, "home", ".branch"),
      BRANCH_CONFIG_PATH: join(cfg.dataDir, "home", ".branch", "branch.json"),
    }),
    // The desktop owns the live gateway: let it start every configured channel.
    // Candidate and smoke gateways opt out separately.
    BRANCH_SKIP_CHANNELS: undefined,
    BRANCH_GATEWAY_PORT: String(port),
    // The configured port (desktop.json), even when this child is a standby on a spare.
    // After a hand-over the successor also listens here once the old engine exits.
    BRANCH_GATEWAY_PREFERRED_PORT: String(cfg.gatewayPort),
    BRANCH_GATEWAY_TOKEN: token,
    BRANCH_GATEWAY_STANDBY: standby ? "1" : undefined,
    // Only Electron's Mac host can give the Gateway this app-owned daemon lease.
    BRANCH_CUA_DRIVER_ENDPOINT: macComputerEndpoint,
    ...testProfile(),
  };
  const args = ["branch.mjs", "gateway", ...(profile.legacyDevMode ? ["--dev"] : []), "--port", String(port)];
  // A detached engine writes to the log file itself: a pipe would break when the UI that owns it has exited.
  const detachedEngine = cfg.detachedEngine === true;
  const logFd = detachedEngine ? openSync(logPath, "a") : undefined;
  let child: ChildProcess;
  try {
    child = spawn(cfg.nodePath, args, engineSpawnOptions({ platform: process.platform, detachedEngine, env, cwd: engineDir, logFd }));
  } finally {
    if (logFd !== undefined) closeSync(logFd);
  }
  // Record the spawn before querying its start time, so a crash cannot lose the engine.
  recordEngine(cfg.dataDir, child, port, standby ? "standby" : "engine", cfg.nodePath);
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  if (!standby && child.pid !== undefined) {
    writeFileSync(join(cfg.dataDir, "gateway.pid"), String(child.pid));
  }
  return child;
}

/** Wait for the new engine's code-only warmup while the current gateway keeps serving. */
export function waitForGatewayStandby(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (!child.connected) return Promise.reject(new Error("The standby activity channel is unavailable"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("The standby did not warm in time")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
    const onMessage = (value: unknown) => {
      const message = value as { type?: unknown; pid?: unknown };
      if (message?.type !== "branch-desktop:standby-ready" || message.pid !== child.pid) return;
      cleanup(); resolve();
    };
    const onExit = () => { cleanup(); reject(new Error("The standby exited before warming")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

export interface PreparedGateway { child: ChildProcess; port: number }

/** The launcher's go-ahead to a warmed standby (engine standby.ts GATEWAY_STANDBY_TAKE_OVER_MESSAGE, #411). */
export const STANDBY_TAKE_OVER_MESSAGE = "branch-desktop:take-over";

/**
 * Tells a warmed standby it may take the state over once it is free. A standby never takes over on a bare lock
 * release (#411), so it is sent once the old engine has stopped (or stepped down). Older standbys ignore it.
 */
export function sendStandbyTakeOver(child: ChildProcess): void {
  if (!child.connected) return;
  try { child.send({ type: STANDBY_TAKE_OVER_MESSAGE }, () => undefined); } catch { /* the channel closed: the standby is gone */ }
}

/**
 * A second engine (candidate check, warming standby) runs below normal priority so it never starves the live engine
 * on a busy machine; a promoted standby goes back to normal.
 */
export function setEnginePriority(child: ChildProcess, background: boolean): void {
  if (child.pid === undefined) return;
  try { setPriority(child.pid, background ? osConstants.priority.PRIORITY_BELOW_NORMAL : osConstants.priority.PRIORITY_NORMAL); }
  catch { /* best effort: the engine still runs at its current priority */ }
}

let warmingStandby: ChildProcess | undefined;
/** Quitting while a standby warms must not leave it behind (the caller only holds it once it has warmed). */
export function stopWarmingStandby(): void {
  if (warmingStandby) stopGateway(warmingStandby);
}

/**
 * Starts an update's standby engine beside the live one. The live engine still holds the configured port, so the
 * standby gets its own free loopback port (same token) and is promoted on that port; the window is then handed the
 * new address. Resolves once the standby has warmed; a standby that exits, cannot report or times out is stopped,
 * so nothing is left behind and the live engine keeps serving.
 */
export async function prepareStandbyGateway(cfg: DesktopConfig, engineDir: string, token: string, timeoutMs: number): Promise<PreparedGateway> {
  const port = await freeLoopbackPort();
  const child = startGateway(cfg, engineDir, token, true, port);
  // POSIX cannot raise a lowered process back without privileges, and a promoted standby must run at full speed.
  if (process.platform === "win32") setEnginePriority(child, true);
  warmingStandby = child;
  try {
    await waitForGatewayStandby(child, timeoutMs);
    return { child, port };
  } catch (error) {
    stopGateway(child);
    throw error;
  } finally {
    warmingStandby = undefined;
  }
}

export interface GatewayActivity { idle: boolean; activeRuns: number; pendingReplies: number; totalActive: number }
let nextActivityId = 0;

/** One activity request in flight: `answered` turns true synchronously when its reply arrives. */
interface ActivityRequest { reply: Promise<GatewayActivity>; readonly answered: boolean; cancel(): void }

/** Sends one activity request over the owned child channel; the reply has no deadline of its own. */
function sendActivityRequest(child: ChildProcess, stop: boolean | "drain"): ActivityRequest {
  const id = ++nextActivityId;
  let answered = false, cleanup = () => {};
  const reply = new Promise<GatewayActivity>((resolve, reject) => {
    cleanup = () => { child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
    const onMessage = (value: unknown) => {
      const response = value as { type?: unknown; id?: unknown } & Partial<GatewayActivity>;
      if (response?.type !== "branch-desktop:activity-result" || response.id !== id) return;
      answered = true;
      cleanup();
      if (typeof response.idle !== "boolean" || typeof response.activeRuns !== "number" ||
        typeof response.pendingReplies !== "number" || typeof response.totalActive !== "number") {
        reject(new Error("The gateway returned an invalid activity snapshot")); return;
      }
      resolve({ idle: response.idle, activeRuns: response.activeRuns, pendingReplies: response.pendingReplies, totalActive: response.totalActive });
    };
    const onExit = () => { cleanup(); reject(new Error("The gateway exited during activity check")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
    const type = stop === "drain" ? "branch-desktop:drain-stop" : stop ? "branch-desktop:stop-if-idle" : "branch-desktop:activity";
    child.send({ type, id }, error => { if (error) onError(error); });
  });
  reply.catch(() => undefined);
  return { reply, get answered() { return answered; }, cancel: () => cleanup() };
}

/** Rejects with `message` unless `promise` settles within `timeoutMs`. */
function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Query the engine's process-wide restart-drain inventory through its owned child channel. */
export function gatewayActivity(child: ChildProcess, stop: boolean | "drain" = false, timeoutMs = 5_000): Promise<GatewayActivity> {
  if (!child.connected) return Promise.reject(new Error("The gateway activity channel is unavailable"));
  const request = sendActivityRequest(child, stop);
  return within(request.reply, timeoutMs, "The gateway activity check timed out").finally(() => request.cancel());
}

export type HandoffAnswer = "ok" | "refused" | "unanswered" | "exited";

/**
 * Sends one handoff request over the owned child channel. "unanswered": no reply within `timeoutMs` (an engine from
 * before the handoff, or one still working on it: unknown, never taken as a refusal); "exited": it died meanwhile.
 */
function gatewayHandoffRequest(child: ChildProcess, type: "deactivate" | "rollback", timeoutMs: number): Promise<HandoffAnswer> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve("exited");
  if (!child.connected) return Promise.resolve("unanswered");
  const id = ++nextActivityId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve("unanswered"); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
    const onMessage = (value: unknown) => {
      const response = value as { type?: unknown; id?: unknown; ok?: unknown };
      if (response?.type !== `branch-desktop:${type}-result` || response.id !== id) return;
      cleanup(); resolve(response.ok === true ? "ok" : "refused");
    };
    const onExit = () => { cleanup(); resolve("exited"); };
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.send({ type: `branch-desktop:${type}`, id }, error => { if (error) { cleanup(); resolve("unanswered"); } });
  });
}

/**
 * Asks the old engine to step down for its standby without exiting: it refuses new work, stops channels and cron,
 * keeps a lease on every session with a run in flight and releases the state.
 */
export function deactivateGateway(child: ChildProcess, timeoutMs = HANDOFF_STEP_DOWN_TIMEOUT_MS): Promise<HandoffAnswer> {
  return gatewayHandoffRequest(child, "deactivate", timeoutMs);
}

/** Asks the old engine to take control back: it reacquires the state and restarts in place on its own port. */
export function rollbackGateway(child: ChildProcess, timeoutMs = HANDOFF_ROLLBACK_TIMEOUT_MS): Promise<HandoffAnswer> {
  return gatewayHandoffRequest(child, "rollback", timeoutMs);
}

/** The standby's answer to the take-over message (engine standby.ts GATEWAY_STANDBY_TAKING_OVER_MESSAGE, #411). */
export const STANDBY_TAKING_OVER_MESSAGE = "branch-desktop:taking-over";

/**
 * Tells a warmed standby to take over (only after the old engine stepped down) and resolves true once it answers
 * `branch-desktop:taking-over` (#411): from then on it owns, or is about to own, the state, channels and cron.
 */
export function takeOverStandby(child: ChildProcess, timeoutMs = HANDOFF_TAKE_OVER_TIMEOUT_MS): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null || !child.connected) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); };
    const onMessage = (value: unknown) => {
      const message = value as { type?: unknown; pid?: unknown };
      if (message?.type !== STANDBY_TAKING_OVER_MESSAGE || message.pid !== child.pid) return;
      cleanup(); resolve(true);
    };
    const onExit = () => { cleanup(); resolve(false); };
    child.on("message", onMessage);
    child.once("exit", onExit);
    sendStandbyTakeOver(child);
  });
}

/** Bounded kill: never hold the update lock forever waiting for a missing exit event. */
export async function killGatewayAndWait(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Gateway ${child.pid} did not exit after SIGKILL`)); }, timeoutMs);
    const onExit = () => { cleanup(); resolve(); };
    const cleanup = () => { clearTimeout(timer); child.off("exit", onExit); };
    child.once("exit", onExit);
    stopGateway(child, "SIGKILL");
    if (child.exitCode !== null || child.signalCode !== null) onExit();
  });
}

/**
 * Ask the owned engine to drain cleanly, but only while it is idle at the gateway. Short post-ready and background
 * work makes it answer "busy" for a few seconds, so the request repeats every 2 s for up to `busyRetryMs`.
 */
export async function stopGatewayCleanly(child: ChildProcess, timeoutMs = 90_000, busyRetryMs = 20_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const giveUp = Date.now() + busyRetryMs;
  while (!(await gatewayActivity(child, true)).idle) {
    if (Date.now() >= giveUp) throw new Error("The gateway became busy before it could stop");
    await new Promise(resolve => setTimeout(resolve, 2_000));
    if (child.exitCode !== null || child.signalCode !== null) return;
  }
  await waitForExit(child, timeoutMs);
}

/**
 * Ask the owned engine to stop admitting work and drain as SIGTERM does, even while runs are active; the next
 * engine's restart recovery resumes whatever the drain could not finish. An engine that does not answer the
 * drain request (an older build) or does not exit in time is stopped by PID, as before.
 */
export async function drainStopGateway(child: ChildProcess, timeoutMs = DRAIN_EXIT_TIMEOUT_MS): Promise<"drained" | "stopped idle" | "killed"> {
  if (child.exitCode !== null || child.signalCode !== null) return "drained";
  // No channel to ask: treat it as an engine from before drain-stop, which is stopped only while idle (that check
  // fails the same way, so the update fails and the engine keeps serving; it is never waited on and killed).
  if (!child.connected) { await stopGatewayCleanly(child); return "stopped idle"; }
  const drain = sendActivityRequest(child, "drain");
  try {
    const answered = await within(drain.reply, DRAIN_REPLY_TIMEOUT_MS, "no drain reply").then(() => true, () => false);
    if (!answered && child.exitCode === null && child.signalCode === null) {
      // No answer yet. An engine from before drain-stop still answers a plain activity check: stop it only while
      // idle; a busy one is never killed. The channel is FIFO, so an engine that knows drain-stop answers the drain
      // request before this probe: a late drain reply means it is draining, and its exit is awaited below. One too
      // busy to answer anything has the drain request queued, and it still lands.
      const answers = await gatewayActivity(child, false, DRAIN_PROBE_TIMEOUT_MS).then(() => true, () => false);
      if (answers && !drain.answered) {
        await stopGatewayCleanly(child);
        return "stopped idle";
      }
    }
  } finally { drain.cancel(); }
  try { await waitForExit(child, timeoutMs); return "drained"; }
  catch {
    stopGateway(child);
    await waitForExit(child, 10_000).catch(() => undefined);
    return "killed";
  }
}

/** How long the drain request's reply is awaited before a plain activity check tells a busy engine from an old one. */
const DRAIN_REPLY_TIMEOUT_MS = 5_000;
/** How long an engine that did not answer its drain request gets to answer a plain activity check. */
const DRAIN_PROBE_TIMEOUT_MS = 10_000;

/** Resolves once `child` has exited, or rejects after `timeoutMs`. */
export function waitForGatewayExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  return waitForExit(child, timeoutMs);
}

/** The engine's own drain budget is 315 s ("shutdown budget at startup: drain=315000ms"); never cut a drain short. */
const DRAIN_EXIT_TIMEOUT_MS = 330_000;

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("The gateway did not stop cleanly in time")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); child.off("exit", onExit); child.off("error", onError); };
    const onExit = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.once("exit", onExit); child.once("error", onError);
  });
}

/** Polls the gateway's /readyz until it answers 200, the child exits, or the time runs out. */
export class GatewayReadinessTimeoutError extends Error {
  constructor() { super("the engine is still running but did not become ready in time; see gateway.log"); }
}

export async function waitForReady(cfg: DesktopConfig, child: ChildProcess, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`the engine exited with code ${child.exitCode}; see gateway.log`);
    }
    try {
      const remaining = Math.max(1, end - Date.now());
      const res = await fetch(`http://127.0.0.1:${cfg.gatewayPort}/readyz`, { signal: AbortSignal.timeout(Math.min(remaining, 2000)) });
      await res.body?.cancel();
      if (res.status === 200 && Date.now() <= end) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(500, end - Date.now()))));
  }
  // A live, slow gateway is not proof that the newly staged release is bad.
  // Only an actual child exit should mark that release rejected.
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`the engine exited with code ${child.exitCode}; see gateway.log`);
  }
  throw new GatewayReadinessTimeoutError();
}

/** Stops the gateway and its own child processes by its PID only. */
export function stopGateway(child: ChildProcess, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
    else process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

/** How long a failed engine's own shutdown (SIGTERM) may take before its process group is killed. */
export const FAILED_ENGINE_STOP_GRACE_MS = 15_000;

/**
 * Stops an engine that failed or never became ready, and resolves once it has exited: SIGTERM first so its shutdown
 * runs, then SIGKILL to its process group after `graceMs`. Only for failed engines: a serving engine's drain has the
 * engine's own budget and is never cut short. Windows' taskkill /F is already immediate.
 */
export async function stopFailedEngine(child: ChildProcess, graceMs = FAILED_ENGINE_STOP_GRACE_MS): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  stopGateway(child);
  if (await waitForExit(child, graceMs).then(() => true, () => false)) return;
  stopGateway(child, "SIGKILL");
  await waitForExit(child, 5_000).catch(() => undefined);
}
