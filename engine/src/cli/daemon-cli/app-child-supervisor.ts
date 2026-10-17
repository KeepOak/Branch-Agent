// Supervises a gateway child started by the app. Records the pid, fails fast
// on spawn or exit during start, restarts the child if it exits later, and
// stops it on `branch gateway stop` or when this process is quitting.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { rewritePnpmVersionedBranchEntryPath } from "../../infra/branch-root.js";
import { readActiveGatewayLockIdentity } from "../../infra/gateway-lock.js";
import { readGatewayOwnerLease } from "../../infra/gateway-owner-lease.js";
import {
  findVerifiedGatewayListenerPidsOnPortSync,
  signalVerifiedGatewayPidSync,
} from "../../infra/gateway-processes.js";
import { probePortUsage } from "../../infra/ports-probe.js";
import { SUPERVISOR_HINT_ENV_VARS } from "../../infra/supervisor-markers.js";
import { isPidAlive } from "../../shared/pid-alive.js";

const APP_CHILD_RECORD_NAME = "gateway-app-child.json";
const MAX_CHILD_RESTARTS = 8;

export type AppChildRecord = {
  pid: number;
  port: number;
};

export type AppChildSpawnFn = typeof spawn;

export type ExistingGatewayCheck = {
  running: boolean;
  pid?: number;
  portHeld: boolean;
};

export function resolveAppChildRecordPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), APP_CHILD_RECORD_NAME);
}

export function readAppChildRecord(env: NodeJS.ProcessEnv = process.env): AppChildRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveAppChildRecordPath(env), "utf8")) as {
      pid?: unknown;
      port?: unknown;
    };
    if (
      typeof parsed.pid !== "number" ||
      !Number.isSafeInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.port !== "number"
    ) {
      return null;
    }
    return { pid: parsed.pid, port: parsed.port };
  } catch {
    return null;
  }
}

export function writeAppChildRecord(
  record: AppChildRecord,
  env: NodeJS.ProcessEnv = process.env,
): void {
  fs.mkdirSync(path.dirname(resolveAppChildRecordPath(env)), { recursive: true });
  fs.writeFileSync(resolveAppChildRecordPath(env), `${JSON.stringify(record)}\n`, "utf8");
}

export function clearAppChildRecord(env: NodeJS.ProcessEnv = process.env): void {
  try {
    fs.unlinkSync(resolveAppChildRecordPath(env));
  } catch {
    // The record is advisory; a missing file still means no child to stop.
  }
}

/** Drop launchd/systemd/task hints so the child restarts itself after a config change. */
export function buildUnmanagedGatewaySpawnEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const key of SUPERVISOR_HINT_ENV_VARS) {
    delete next[key];
  }
  return next;
}

export async function inspectExistingGateway(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  probePort?: typeof probePortUsage;
}): Promise<ExistingGatewayCheck> {
  const env = params.env ?? process.env;
  const lock = await readActiveGatewayLockIdentity({ env }).catch(() => undefined);
  const lease = readGatewayOwnerLease({ env });
  const listenerPids = findVerifiedGatewayListenerPidsOnPortSync(params.port, { env });
  const recorded = readAppChildRecord(env);
  const livePid =
    listenerPids[0] ??
    (lock && isPidAlive(lock.pid) ? lock.pid : undefined) ??
    (lease && lease.state === "live" && isPidAlive(lease.pid) ? lease.pid : undefined) ??
    (recorded && isPidAlive(recorded.pid) ? recorded.pid : undefined);
  const portUsage = await (params.probePort ?? probePortUsage)(params.port);
  return {
    running: livePid !== undefined,
    pid: livePid,
    portHeld: portUsage === "busy" || livePid !== undefined,
  };
}

export class AppChildGatewaySupervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private starting = true;
  private spawnError: Error | null = null;
  private exitedDuringStart = false;
  private restartCount = 0;
  private hooksInstalled = false;
  pid = 0;

  constructor(
    private readonly params: {
      port: number;
      env?: NodeJS.ProcessEnv;
      spawnImpl?: AppChildSpawnFn;
      onRespawn?: () => void;
      /** Keep the child tied to this process so quitting the app stops it. */
      linkToParent?: boolean;
    },
  ) {}

  get process(): ChildProcess | null {
    return this.child;
  }

  async start(): Promise<{ pid: number }> {
    this.stopping = false;
    this.starting = true;
    if (this.params.linkToParent) {
      this.installQuitHooks();
    }
    const started = this.spawnOnce();
    if (!started) {
      throw this.spawnError ?? new Error("Gateway child did not start.");
    }
    return { pid: this.pid };
  }

  markReady(): void {
    this.starting = false;
    if (!this.params.linkToParent) {
      this.child?.unref?.();
    }
  }

  waitForExitOrError(): Promise<Error | null> {
    return new Promise((resolve) => {
      const child = this.child;
      if (!child || this.exitedDuringStart || this.spawnError) {
        resolve(this.spawnError ?? (this.exitedDuringStart ? new Error("exited") : null));
        return;
      }
      const finish = (error: Error | null) => {
        child.off("error", onError);
        child.off("exit", onExit);
        resolve(error);
      };
      const onError = (error: Error) => finish(error);
      const onExit = () => finish(new Error("exited"));
      child.once("error", onError);
      child.once("exit", onExit);
    });
  }

  async stop(signalPid: typeof signalVerifiedGatewayPidSync = signalVerifiedGatewayPidSync): Promise<void> {
    this.stopping = true;
    const env = this.params.env ?? process.env;
    const pid = this.pid || readAppChildRecord(env)?.pid;
    if (this.child && this.pid > 0) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // The child may have already exited.
      }
    } else if (pid && isPidAlive(pid)) {
      signalPid(pid, "SIGTERM", { env, port: this.params.port });
    }
    this.child = null;
    this.pid = 0;
    clearAppChildRecord(env);
  }

  quit(): void {
    void this.stop();
  }

  private spawnOnce(): boolean {
    this.spawnError = null;
    this.exitedDuringStart = false;
    const env = this.params.env ?? process.env;
    const [entryArg] = process.argv.slice(1);
    const args = [
      ...process.execArgv,
      ...(entryArg ? [rewritePnpmVersionedBranchEntryPath(entryArg)] : []),
      "gateway",
      "run",
    ];
    const child = (this.params.spawnImpl ?? spawn)(process.execPath, args, {
      env: buildUnmanagedGatewaySpawnEnv(env),
      stdio: "ignore",
      windowsHide: true,
    });
    this.child = child;
    this.pid = child.pid ?? 0;
    if (this.pid <= 0) {
      this.spawnError = new Error("Gateway child did not start.");
      return false;
    }
    writeAppChildRecord({ pid: this.pid, port: this.params.port }, env);
    child.on("error", (error) => {
      this.spawnError = error;
    });
    child.on("exit", () => {
      if (this.stopping) {
        return;
      }
      if (this.starting) {
        this.exitedDuringStart = true;
        return;
      }
      if (this.restartCount >= MAX_CHILD_RESTARTS) {
        return;
      }
      this.restartCount += 1;
      this.params.onRespawn?.();
      this.spawnOnce();
    });
    return true;
  }

  private installQuitHooks(): void {
    if (this.hooksInstalled) {
      return;
    }
    this.hooksInstalled = true;
    const quit = () => this.quit();
    process.once("exit", quit);
    process.once("SIGINT", quit);
    process.once("SIGTERM", quit);
  }
}

const supervisors = new Map<number, AppChildGatewaySupervisor>();

export function getAppChildSupervisor(port: number): AppChildGatewaySupervisor | undefined {
  return supervisors.get(port);
}

export function rememberAppChildSupervisor(
  port: number,
  supervisor: AppChildGatewaySupervisor,
): void {
  supervisors.set(port, supervisor);
}

export async function stopAppChildGateway(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const env = params.env ?? process.env;
  const supervisor = supervisors.get(params.port);
  if (supervisor) {
    await supervisor.stop();
    supervisors.delete(params.port);
    return true;
  }
  const recorded = readAppChildRecord(env);
  if (!recorded || recorded.port !== params.port || !isPidAlive(recorded.pid)) {
    clearAppChildRecord(env);
    return false;
  }
  signalVerifiedGatewayPidSync(recorded.pid, "SIGTERM", { env, port: params.port });
  clearAppChildRecord(env);
  return true;
}
