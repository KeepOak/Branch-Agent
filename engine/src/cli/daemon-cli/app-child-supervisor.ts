// Supervises a gateway child from a long-lived parent. The start command
// launches `gateway supervise-app-child` detached so the watcher outlives
// that CLI. The parent restarts the child with backoff, stops it on SIGINT
// or SIGTERM and then exits, and escalates a stuck stop.
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
import { getFileLockProcessStartTime, isPidAlive } from "../../shared/pid-alive.js";

const APP_CHILD_RECORD_NAME = "gateway-app-child.json";
export const SUPERVISE_APP_CHILD_COMMAND = "supervise-app-child";
export const MAX_CHILD_RESTARTS = 8;
export const CHILD_RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const DEFAULT_CHILD_STOP_WAIT_MS = 3_000;
export const GATEWAY_CHILD_GAVE_UP_MESSAGE =
  "Branch's engine stopped too many times and will not restart. Run `branch doctor` or choose Install background service.";
export const GATEWAY_CHILD_STOPPED_MESSAGE = "Stopped Branch's engine.";
export const GATEWAY_CHILD_ESCALATED_STOP_MESSAGE =
  "Stopped Branch's engine after it ignored the first stop.";
export const GATEWAY_CHILD_STOP_FAILED_MESSAGE = "Could not stop Branch's engine.";

export type AppChildRecord = {
  pid?: number;
  port: number;
  startedAt?: number;
  supervisorPid?: number;
  error?: string;
};

export type AppChildSpawnFn = typeof spawn;
export type AppChildSleepFn = (ms: number) => Promise<void>;

export type ExistingGatewayCheck = {
  running: boolean;
  pid?: number;
  portHeld: boolean;
};

export type AppChildStopOutcome = {
  stopped: boolean;
  escalated: boolean;
  message: string;
};

export type ParentSignal = "SIGINT" | "SIGTERM";

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function resolveAppChildRecordPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), APP_CHILD_RECORD_NAME);
}

export function readAppChildRecord(env: NodeJS.ProcessEnv = process.env): AppChildRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveAppChildRecordPath(env), "utf8")) as {
      pid?: unknown;
      port?: unknown;
      startedAt?: unknown;
      supervisorPid?: unknown;
      error?: unknown;
    };
    if (typeof parsed.port !== "number") {
      return null;
    }
    const record: AppChildRecord = { port: parsed.port };
    if (typeof parsed.pid === "number" && Number.isSafeInteger(parsed.pid) && parsed.pid > 0) {
      record.pid = parsed.pid;
    }
    if (typeof parsed.startedAt === "number" && Number.isSafeInteger(parsed.startedAt)) {
      record.startedAt = parsed.startedAt;
    }
    if (
      typeof parsed.supervisorPid === "number" &&
      Number.isSafeInteger(parsed.supervisorPid) &&
      parsed.supervisorPid > 0
    ) {
      record.supervisorPid = parsed.supervisorPid;
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      record.error = parsed.error;
    }
    return record;
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

function isRecordedPidCurrent(
  record: AppChildRecord,
  readStartTime: (pid: number) => number | null,
): boolean {
  if (!record.pid || !isPidAlive(record.pid)) {
    return false;
  }
  if (record.startedAt !== undefined) {
    return readStartTime(record.pid) === record.startedAt;
  }
  return false;
}

function isSupervisorRecordLive(record: AppChildRecord): boolean {
  return Boolean(record.supervisorPid && isPidAlive(record.supervisorPid));
}

export async function inspectExistingGateway(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  probePort?: typeof probePortUsage;
  readStartTime?: (pid: number) => number | null;
}): Promise<ExistingGatewayCheck> {
  const env = params.env ?? process.env;
  const readStartTime =
    params.readStartTime ?? ((pid: number) => getFileLockProcessStartTime(pid, env));
  const lock = await readActiveGatewayLockIdentity({ env }).catch(() => undefined);
  const lease = readGatewayOwnerLease({ env });
  const listenerPids = findVerifiedGatewayListenerPidsOnPortSync(params.port, { env });
  const recorded = readAppChildRecord(env);
  if (
    recorded &&
    recorded.port === params.port &&
    !isRecordedPidCurrent(recorded, readStartTime) &&
    !isSupervisorRecordLive(recorded)
  ) {
    clearAppChildRecord(env);
  }
  const liveRecord = recorded && isRecordedPidCurrent(recorded, readStartTime) ? recorded : null;
  const livePid =
    listenerPids[0] ??
    (lock && listenerPids.includes(lock.pid) ? lock.pid : undefined) ??
    (lease && lease.state === "live" && listenerPids.includes(lease.pid) ? lease.pid : undefined) ??
    (liveRecord?.pid && listenerPids.includes(liveRecord.pid) ? liveRecord.pid : undefined);
  const portUsage = await (params.probePort ?? probePortUsage)(params.port);
  return {
    running: livePid !== undefined,
    pid: livePid,
    portHeld: portUsage === "busy" || livePid !== undefined,
  };
}

export function restartBackoffMs(restartCount: number): number {
  return CHILD_RESTART_BACKOFF_MS[Math.min(restartCount, CHILD_RESTART_BACKOFF_MS.length - 1)] ?? 30_000;
}

export function forceKillPid(
  pid: number,
  spawnImpl: AppChildSpawnFn = spawn,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") {
    spawnImpl("taskkill", ["/T", "/F", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process may have exited between the wait and the escalate.
  }
}

export class AppChildGatewaySupervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private starting = true;
  private spawnError: Error | null = null;
  private exitedDuringStart = false;
  private restartCount = 0;
  private unbindSignals: (() => void) | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  pid = 0;

  constructor(
    private readonly params: {
      port: number;
      env?: NodeJS.ProcessEnv;
      spawnImpl?: AppChildSpawnFn;
      onRespawn?: () => void;
      onGiveUp?: (message: string) => void;
      /** Keep the child tied to this process so quitting the parent stops it. */
      linkToParent?: boolean;
      bindSignals?: (handlers: Record<ParentSignal, () => void>) => () => void;
      raiseSignal?: (signal: ParentSignal) => void;
      sleep?: AppChildSleepFn;
      stopWaitMs?: number;
      forceKillPid?: (pid: number) => void;
      isAlive?: (pid: number) => boolean;
    },
  ) {}

  get process(): ChildProcess | null {
    return this.child;
  }

  get restartAttempts(): number {
    return this.restartCount;
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

  async handleParentSignal(signal: ParentSignal): Promise<void> {
    this.removeQuitHooks();
    await this.stop();
    (this.params.raiseSignal ?? ((next: ParentSignal) => process.kill(process.pid, next)))(signal);
  }

  async stop(
    signalPid: typeof signalVerifiedGatewayPidSync = signalVerifiedGatewayPidSync,
  ): Promise<AppChildStopOutcome> {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const env = this.params.env ?? process.env;
    const waitMs = this.params.stopWaitMs ?? DEFAULT_CHILD_STOP_WAIT_MS;
    const alive = this.params.isAlive ?? isPidAlive;
    const pid = this.pid || readAppChildRecord(env)?.pid;
    if (this.child && this.pid > 0) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // The child may have already exited.
      }
    } else if (pid && alive(pid)) {
      signalPid(pid, "SIGTERM", { env, port: this.params.port });
    }
    const firstPid = this.pid || pid;
    let exited = !firstPid || !alive(firstPid);
    if (!exited && waitMs > 0) {
      exited = await this.waitForPidExit(firstPid, waitMs);
    }
    let escalated = false;
    if (!exited && firstPid && alive(firstPid)) {
      escalated = true;
      (this.params.forceKillPid ?? ((target: number) => forceKillPid(target, this.params.spawnImpl)))(
        firstPid,
      );
      if (this.child && this.pid === firstPid) {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // forceKillPid already targeted the pid.
        }
      }
      exited =
        waitMs > 0 ? await this.waitForPidExit(firstPid, waitMs) : !alive(firstPid);
    }
    this.child = null;
    this.pid = 0;
    if (exited) {
      clearAppChildRecord(env);
    }
    return {
      stopped: exited,
      escalated,
      message: exited
        ? escalated
          ? GATEWAY_CHILD_ESCALATED_STOP_MESSAGE
          : GATEWAY_CHILD_STOPPED_MESSAGE
        : GATEWAY_CHILD_STOP_FAILED_MESSAGE,
    };
  }

  quit(): void {
    void this.stop();
  }

  removeQuitHooks(): void {
    this.unbindSignals?.();
    this.unbindSignals = null;
  }

  private async waitForPidExit(pid: number, timeoutMs: number): Promise<boolean> {
    const child = this.child;
    const sleep = this.params.sleep ?? defaultSleep;
    const alive = this.params.isAlive ?? isPidAlive;
    const deadline = Date.now() + timeoutMs;
    const exited = child
      ? new Promise<boolean>((resolve) => {
          child.once("exit", () => resolve(true));
        })
      : null;
    while (Date.now() < deadline && alive(pid)) {
      const remaining = Math.max(0, deadline - Date.now());
      const finished = exited
        ? await Promise.race([exited, sleep(Math.min(50, remaining)).then(() => false)])
        : await sleep(Math.min(50, remaining)).then(() => false);
      if (finished) {
        return true;
      }
    }
    return !alive(pid);
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
      this.child = null;
      writeFailedAppChildRecord(this.params.port, this.spawnError.message, env);
      return false;
    }
    writeAppChildRecord(
      {
        pid: this.pid,
        port: this.params.port,
        startedAt: getFileLockProcessStartTime(this.pid, env) ?? undefined,
        supervisorPid: process.pid,
      },
      env,
    );
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
      this.scheduleRestart();
    });
    return true;
  }

  private scheduleRestart(): void {
    if (this.restartCount >= MAX_CHILD_RESTARTS) {
      this.giveUp();
      return;
    }
    const delay = restartBackoffMs(this.restartCount);
    this.restartCount += 1;
    const sleep = this.params.sleep;
    const run = () => {
      this.restartTimer = null;
      if (this.stopping) {
        return;
      }
      this.params.onRespawn?.();
      if (!this.spawnOnce()) {
        this.giveUp();
      }
    };
    if (sleep) {
      void sleep(delay).then(run);
      return;
    }
    this.restartTimer = setTimeout(run, delay);
  }

  private giveUp(): void {
    const env = this.params.env ?? process.env;
    writeFailedAppChildRecord(this.params.port, GATEWAY_CHILD_GAVE_UP_MESSAGE, env);
    this.child = null;
    this.pid = 0;
    this.params.onGiveUp?.(GATEWAY_CHILD_GAVE_UP_MESSAGE);
  }

  private installQuitHooks(): void {
    if (this.unbindSignals) {
      return;
    }
    const handlers: Record<ParentSignal, () => void> = {
      SIGINT: () => {
        void this.handleParentSignal("SIGINT");
      },
      SIGTERM: () => {
        void this.handleParentSignal("SIGTERM");
      },
    };
    if (this.params.bindSignals) {
      this.unbindSignals = this.params.bindSignals(handlers);
      return;
    }
    process.once("SIGINT", handlers.SIGINT);
    process.once("SIGTERM", handlers.SIGTERM);
    this.unbindSignals = () => {
      process.removeListener("SIGINT", handlers.SIGINT);
      process.removeListener("SIGTERM", handlers.SIGTERM);
    };
  }
}

function writeFailedAppChildRecord(
  port: number,
  error: string,
  env: NodeJS.ProcessEnv,
): void {
  writeAppChildRecord({ port, error }, env);
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

export function spawnAppChildSupervisorProcess(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: AppChildSpawnFn;
}): { pid: number } {
  const env = params.env ?? process.env;
  const [entryArg] = process.argv.slice(1);
  const args = [
    ...process.execArgv,
    ...(entryArg ? [rewritePnpmVersionedBranchEntryPath(entryArg)] : []),
    "gateway",
    SUPERVISE_APP_CHILD_COMMAND,
    "--port",
    String(params.port),
  ];
  const child = (params.spawnImpl ?? spawn)(process.execPath, args, {
    env: buildUnmanagedGatewaySpawnEnv(env),
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref?.();
  const pid = child.pid ?? 0;
  if (pid <= 0) {
    throw new Error("Gateway supervisor did not start.");
  }
  writeAppChildRecord(
    {
      port: params.port,
      supervisorPid: pid,
      startedAt: getFileLockProcessStartTime(pid, env) ?? undefined,
    },
    env,
  );
  return { pid };
}

export async function runAppChildSupervisor(params: { port: number }): Promise<void> {
  const supervisor = new AppChildGatewaySupervisor({
    port: params.port,
    linkToParent: true,
  });
  await supervisor.start();
  supervisor.markReady();
  rememberAppChildSupervisor(params.port, supervisor);
}

export async function stopAppChildGateway(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  signalPid?: typeof signalVerifiedGatewayPidSync;
  stopWaitMs?: number;
  sleep?: AppChildSleepFn;
  forceKillPid?: (pid: number) => void;
  isAlive?: (pid: number) => boolean;
}): Promise<AppChildStopOutcome> {
  const env = params.env ?? process.env;
  const supervisor = supervisors.get(params.port);
  if (supervisor) {
    const outcome = await supervisor.stop(params.signalPid);
    supervisors.delete(params.port);
    return outcome;
  }
  const recorded = readAppChildRecord(env);
  if (!recorded || recorded.port !== params.port) {
    clearAppChildRecord(env);
    return { stopped: false, escalated: false, message: GATEWAY_CHILD_STOPPED_MESSAGE };
  }
  const isolated = new AppChildGatewaySupervisor({
    port: params.port,
    env,
    stopWaitMs: params.stopWaitMs,
    sleep: params.sleep,
    forceKillPid: params.forceKillPid,
    isAlive: params.isAlive,
  });
  writeAppChildRecord(recorded, env);
  const outcome = await isolated.stop(params.signalPid ?? signalVerifiedGatewayPidSync);
  return outcome;
}
