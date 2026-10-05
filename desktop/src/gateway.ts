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
  let outputTail = "";
  const noteStartupPhase = (chunk: Buffer): void => {
    const output = outputTail + chunk.toString("utf8");
    if (output.includes("startup trace:")) (child as GatewayChild).startupPhaseAt = Date.now();
    outputTail = output.slice(-32);
  };
  child.stdout?.on("data", noteStartupPhase);
  child.stderr?.on("data", noteStartupPhase);
  if (child.pid !== undefined) {
    writeFileSync(join(cfg.dataDir, "gateway.pid"), String(child.pid));
  }
  return child;
}

type GatewayChild = ChildProcess & { startupPhaseAt?: number };

export interface GatewayActivity { idle: boolean; activeRuns: number; pendingReplies: number; totalActive: number }
let nextActivityId = 0;
/** Query the engine's process-wide restart-drain inventory through its owned child channel. */
export function gatewayActivity(child: ChildProcess, stopIfIdle = false, timeoutMs = 5_000): Promise<GatewayActivity> {
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
    child.send({ type: stopIfIdle ? "branch-desktop:stop-if-idle" : "branch-desktop:activity", id }, error => { if (error) onError(error); });
  });
}

/** Ask the owned engine to drain cleanly, but only if it is still idle at the gateway. */
export async function stopGatewayCleanly(child: ChildProcess, timeoutMs = 90_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const snapshot = await gatewayActivity(child, true);
  if (!snapshot.idle) throw new Error("The gateway became busy before it could stop");
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("The gateway did not stop cleanly in time")); }, timeoutMs);
    const cleanup = () => { clearTimeout(timer); child.off("exit", onExit); child.off("error", onError); };
    const onExit = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    child.once("exit", onExit); child.once("error", onError);
  });
}

export class GatewayReadinessError extends Error {
  constructor(readonly reason: "exit" | "timeout" | "unready", message: string) { super(message); }
}

/** A silent, unbound gateway fails after 180 s; a responding or progressing one gets up to 10 min. */
export async function waitForReady(
  cfg: DesktopConfig,
  child: GatewayChild,
  ms: number,
  options: { maxWaitMs?: number; phaseQuietMs?: number; pollMs?: number } = {},
): Promise<void> {
  const started = Date.now();
  const softEnd = started + ms;
  const hardEnd = started + (options.maxWaitMs ?? 600_000);
  const phaseQuietMs = options.phaseQuietMs ?? 60_000;
  const pollMs = options.pollMs ?? 500;
  let listenerAnswered = false;
  while (true) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new GatewayReadinessError("exit", `the engine exited with code ${child.exitCode}; see gateway.log`);
    }
    const now = Date.now();
    const phaseRecent = child.startupPhaseAt !== undefined && now - child.startupPhaseAt <= phaseQuietMs;
    if (now >= hardEnd) throw new GatewayReadinessError(listenerAnswered ? "unready" : "timeout", "the engine did not become ready in time; see gateway.log");
    if (now >= softEnd && !listenerAnswered && !phaseRecent) {
      throw new GatewayReadinessError("timeout", "the engine never answered on its port before the startup deadline; see gateway.log");
    }
    try {
      const probeEnd = listenerAnswered || phaseRecent ? hardEnd : Math.min(softEnd, hardEnd);
      const remaining = Math.max(1, probeEnd - now);
      const res = await fetch(`http://127.0.0.1:${cfg.gatewayPort}/readyz`, { signal: AbortSignal.timeout(Math.min(remaining, 2000)) });
      await res.body?.cancel();
      listenerAnswered = true;
      if (res.status === 200 && child.exitCode === null && child.signalCode === null) return;
    } catch {
      // not listening yet
    }
    const nextEnd = listenerAnswered || (child.startupPhaseAt !== undefined && Date.now() - child.startupPhaseAt <= phaseQuietMs)
      ? hardEnd : Math.min(softEnd, hardEnd);
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pollMs, nextEnd - Date.now()))));
  }
}

/** Stops the gateway and its own child processes by its PID only. */
export function stopGateway(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // already gone
  }
}
