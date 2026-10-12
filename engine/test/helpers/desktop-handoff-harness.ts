// The desktop's side of an in-place engine handoff, for tests that drive real engines: spawn an engine the way
// desktop/src/gateway.ts does (its own process, an IPC channel, the owner's profile), send it the desktop's
// branch-desktop:* requests, and probe what each engine really does: /readyz, the state lock, the lease files.
// restart-engine.test.mjs (desktop) can drive the same scenario through these helpers.
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { readActiveGatewayLockIdentity } from "../../src/infra/gateway-lock.js";
import { killProcessTree } from "../../src/process/kill-tree.js";
import {
  listSessionHandoffLeases,
  resolveSessionHandoffLeaseDir,
} from "../../src/process/session-handoff-lease-files.js";
import type { BranchTestInstance } from "./branch-test-instance.js";

export const DESKTOP_DEACTIVATE = "branch-desktop:deactivate";
export const DESKTOP_ROLLBACK = "branch-desktop:rollback";
export const DESKTOP_DRAIN_STOP = "branch-desktop:drain-stop";
export const DESKTOP_TAKE_OVER = "branch-desktop:take-over";
export const ENGINE_STANDBY_READY = "branch-desktop:standby-ready";
export const ENGINE_TAKING_OVER = "branch-desktop:taking-over";

export type EngineMessage = { type: string; [key: string]: unknown };

export type HandoffEngine = {
  readonly name: string;
  readonly child: ChildProcess;
  readonly port: number;
  readonly env: NodeJS.ProcessEnv;
  /** Every IPC message the engine sent, in order. */
  readonly messages: EngineMessage[];
  readonly output: string[];
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  hasExited(): boolean;
};

/**
 * The engine's environment as the desktop gives it: the instance's state and config, its own profile directories
 * (so locks and app data never mix with a real engine's), and no test markers. `acquireGatewayLock` takes no lock
 * under VITEST or NODE_ENV=test, so a child that kept them would never exercise the handoff.
 */
export function handoffEngineEnv(
  instance: BranchTestInstance,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const profile = instance.homeDir;
  const env: NodeJS.ProcessEnv = {
    ...instance.env,
    HOME: profile,
    USERPROFILE: profile,
    LOCALAPPDATA: path.join(profile, "AppData", "Local"),
    APPDATA: path.join(profile, "AppData", "Roaming"),
    BRANCH_GATEWAY_TOKEN: instance.gatewayToken,
  };
  for (const key of ["VITEST", "VITEST_POOL_ID", "VITEST_WORKER_ID", "NODE_ENV", "NODE_OPTIONS"]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Spawns `branch gateway` on `port` with an IPC channel, as the desktop does; `standby` makes it a prepared standby. */
export async function spawnHandoffEngine(params: {
  name: string;
  instance: BranchTestInstance;
  port: number;
  standby?: boolean;
  env?: Record<string, string | undefined>;
}): Promise<HandoffEngine> {
  const entrypoint = await params.instance.entrypoint();
  const env = handoffEngineEnv(params.instance, {
    BRANCH_GATEWAY_PORT: String(params.port),
    // The instance port is the configured desktop port (19031 in installs; a free port in tests).
    BRANCH_GATEWAY_PREFERRED_PORT: String(params.instance.port),
    ...(params.standby ? { BRANCH_GATEWAY_STANDBY: "1" } : {}),
    ...params.env,
  });
  const child = spawn(
    process.execPath,
    [
      ...entrypoint,
      "gateway",
      "--port",
      String(params.port),
      "--bind",
      "loopback",
      "--allow-unconfigured",
    ],
    {
      // The instance's entrypoint is relative to the engine root, which is where tests run.
      cwd: process.cwd(),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const messages: EngineMessage[] = [];
  const output: string[] = [];
  let exited = false;
  child.on("message", (message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      typeof (message as EngineMessage).type === "string"
    ) {
      messages.push(message as EngineMessage);
    }
  });
  const keep = (chunk: Buffer) => {
    output.push(chunk.toString("utf8"));
    if (output.length > 4_000) output.splice(0, output.length - 4_000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  const exitedPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => {
        exited = true;
        resolve({ code, signal });
      });
    },
  );
  return {
    name: params.name,
    child,
    port: params.port,
    env,
    messages,
    output,
    exited: exitedPromise,
    hasExited: () => exited,
  };
}

/** Resolves with the first message of `type` (already received or still to come) that matches. */
export function waitForEngineMessage(
  engine: HandoffEngine,
  type: string,
  timeoutMs: number,
  matches: (message: EngineMessage) => boolean = () => true,
): Promise<EngineMessage> {
  const seen = engine.messages.find((message) => message.type === type && matches(message));
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${engine.name}: no ${type} within ${timeoutMs}ms\n${engineLog(engine)}`));
    }, timeoutMs);
    const onMessage = (message: unknown) => {
      const value = message as EngineMessage;
      if (value?.type !== type || !matches(value)) return;
      cleanup();
      resolve(value);
    };
    const onExit = () => {
      cleanup();
      reject(new Error(`${engine.name}: exited while waiting for ${type}\n${engineLog(engine)}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      engine.child.off("message", onMessage);
      engine.child.off("exit", onExit);
    };
    engine.child.on("message", onMessage);
    engine.child.once("exit", onExit);
  });
}

let nextRequestId = 1_000;

/**
 * Sends one desktop request and waits for its answer: deactivate → deactivate-result, rollback → rollback-result,
 * drain-stop → activity-result. Take-over has no answer of its own (the standby reports taking-over).
 */
export async function sendDesktopRequest(
  engine: HandoffEngine,
  type: typeof DESKTOP_DEACTIVATE | typeof DESKTOP_ROLLBACK | typeof DESKTOP_DRAIN_STOP,
  timeoutMs: number,
): Promise<EngineMessage> {
  const id = ++nextRequestId;
  const resultType =
    type === DESKTOP_DRAIN_STOP ? "branch-desktop:activity-result" : `${type}-result`;
  const answer = waitForEngineMessage(
    engine,
    resultType,
    timeoutMs,
    (message) => message.id === id,
  );
  engine.child.send({ type, id });
  return await answer;
}

export function sendTakeOver(engine: HandoffEngine): void {
  engine.child.send({ type: DESKTOP_TAKE_OVER });
}

/** The HTTP status of GET /readyz on `port`, or "down" when nothing answers. */
export async function probeReadyz(port: number, timeoutMs = 2_000): Promise<number | "down"> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer().catch(() => undefined);
    return response.status;
  } catch {
    return "down";
  }
}

export async function waitForReadyz(
  port: number,
  status: number,
  timeoutMs: number,
  engine?: HandoffEngine,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: number | "down" = "down";
  while (Date.now() < deadline) {
    last = await probeReadyz(port);
    if (last === status) return;
    if (engine?.hasExited()) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `/readyz on ${port} stayed ${String(last)} (wanted ${status})${engine ? `\n${engineLog(engine)}` : ""}`,
  );
}

/** The process that owns the state now, read from the real lock files. */
export async function readStateOwner(
  env: NodeJS.ProcessEnv,
): Promise<{ pid: number; port: number } | undefined> {
  const owner = await readActiveGatewayLockIdentity({ env });
  return owner ? { pid: owner.pid, port: owner.port } : undefined;
}

export async function waitForStateOwner(
  env: NodeJS.ProcessEnv,
  pid: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: { pid: number; port: number } | undefined;
  while (Date.now() < deadline) {
    last = await readStateOwner(env).catch(() => undefined);
    if (last?.pid === pid) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`state owner stayed ${JSON.stringify(last)} (wanted pid ${pid})`);
}

/** The session lanes with a handoff lease file on disk, and the pid holding each. */
export function listLeasedLanes(env: NodeJS.ProcessEnv): Array<{ lane: string; pid: number }> {
  return listSessionHandoffLeases(resolveSessionHandoffLeaseDir(env)).map(({ lease }) => ({
    lane: lease.lane,
    pid: lease.pid,
  }));
}

export function engineLog(engine: HandoffEngine, maxChars = 6_000): string {
  const text = engine.output.join("");
  return `--- ${engine.name} (pid ${engine.child.pid}) ---\n${text.slice(-maxChars)}`;
}

/** Kills the engine and everything it started; resolves once it has exited. */
export async function stopHandoffEngine(engine: HandoffEngine | undefined): Promise<void> {
  if (!engine || engine.hasExited() || engine.child.pid === undefined) return;
  killProcessTree(engine.child.pid, { force: true });
  await Promise.race([engine.exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
}
