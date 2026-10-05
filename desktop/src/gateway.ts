// Starts the Branch engine gateway as a child process (as the early copy's start.sh does) and stops it by PID.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import type { DesktopConfig } from "./config";

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

export function startGateway(cfg: DesktopConfig, engineDir: string, token: string): ChildProcess {
  const log = createWriteStream(join(cfg.dataDir, "gateway.log"), { flags: "a" });
  const env = {
    ...process.env,
    BRANCH_PROFILE: "dev",
    BRANCH_HOME: join(cfg.dataDir, "home"),
    BRANCH_SKIP_CHANNELS: "1",
    BRANCH_GATEWAY_PORT: String(cfg.gatewayPort),
    BRANCH_GATEWAY_TOKEN: token,
    ...testProfile(),
  };
  const args = ["branch.mjs", "gateway", "--dev", "--port", String(cfg.gatewayPort)];
  const child = spawn(cfg.nodePath, args, {
    cwd: engineDir,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  if (child.pid !== undefined) {
    writeFileSync(join(cfg.dataDir, "gateway.pid"), String(child.pid));
  }
  return child;
}

export interface GatewayActivity { idle: boolean; activeRuns: number; pendingReplies: number; totalActive: number }
let nextActivityId = 0;
/** Query the engine's process-wide restart-drain inventory through its owned child channel. */
export function gatewayActivity(child: ChildProcess, stop: boolean | "drain" = false, timeoutMs = 5_000): Promise<GatewayActivity> {
  if (!child.connected) return Promise.reject(new Error("The gateway activity channel is unavailable"));
  const id = ++nextActivityId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("The gateway activity check timed out")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); child.off("message", onMessage); child.off("exit", onExit); child.off("error", onError); };
    const onMessage = (value: unknown) => {
      const response = value as { type?: unknown; id?: unknown } & Partial<GatewayActivity>;
      if (response?.type !== "branch-desktop:activity-result" || response.id !== id) return;
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
export async function drainStopGateway(child: ChildProcess, timeoutMs = 120_000): Promise<"drained" | "killed"> {
  if (child.exitCode !== null || child.signalCode !== null) return "drained";
  try {
    await gatewayActivity(child, "drain");
    await waitForExit(child, timeoutMs);
    return "drained";
  } catch {
    stopGateway(child);
    await waitForExit(child, 10_000).catch(() => undefined);
    return "killed";
  }
}

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
export function stopGateway(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}
