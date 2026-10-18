// Supervises a gateway child from a long-lived parent. The start command
// launches `gateway supervise-app-child` detached so the watcher outlives
// that CLI. The parent is tied to Branch (the desktop app or the process
// that started it): when that owner exits, the parent stops the child and
// exits. Stop signals the parent first so it cannot respawn the child.
import { spawn, type ChildProcess } from "node:child_process";
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
import {
  type AppChildSleepFn,
  type AppChildSpawnFn,
  DEFAULT_CHILD_STOP_WAIT_MS,
  forceKillPid,
  waitForPidExit,
} from "./app-child-process.js";
import { rememberAppChildSupervisor } from "./app-child-registry.js";
import type { AppChildStopOutcome } from "./app-child-stop.js";
import {
  type AppChildReadStartTime,
  type AppChildRecord,
  GATEWAY_CHILD_ESCALATED_STOP_MESSAGE,
  GATEWAY_CHILD_GAVE_UP_MESSAGE,
  GATEWAY_CHILD_START_FAILED_MESSAGE,
  GATEWAY_CHILD_STOP_FAILED_MESSAGE,
  GATEWAY_CHILD_STOPPED_MESSAGE,
  attachAppChildFallbackStatus,
  canEscalateRecordedPid,
  clearAppChildRecord,
  defaultReadStartTime,
  isOwnerProcessCurrent,
  isSameRecordedProcess,
  readAppChildRecord,
  resolveAppChildOwnerPid,
  resolveAppChildRecordPath,
  writeAppChildRecord,
  writeFailedAppChildRecord,
} from "./app-child-record.js";

export {
  GATEWAY_CHILD_ESCALATED_STOP_MESSAGE,
  GATEWAY_CHILD_GAVE_UP_MESSAGE,
  GATEWAY_CHILD_START_FAILED_MESSAGE,
  GATEWAY_CHILD_STOP_FAILED_MESSAGE,
  GATEWAY_CHILD_STOPPED_MESSAGE,
  attachAppChildFallbackStatus,
  clearAppChildRecord,
  readAppChildRecord,
  resolveAppChildOwnerPid,
  resolveAppChildRecordPath,
  writeAppChildRecord,
};
export { forceKillPid, DEFAULT_CHILD_STOP_WAIT_MS } from "./app-child-process.js";
export { stopAppChildGateway } from "./app-child-stop.js";
export {
  forgetAppChildSupervisor,
  getAppChildSupervisor,
  rememberAppChildSupervisor,
} from "./app-child-registry.js";
export type { AppChildRecord };
export type { AppChildSleepFn, AppChildSpawnFn } from "./app-child-process.js";
export type { AppChildStopOutcome } from "./app-child-stop.js";

export const SUPERVISE_APP_CHILD_COMMAND = "supervise-app-child";
export const MAX_CHILD_RESTARTS = 8;
export const CHILD_RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const DEFAULT_CHILD_STABLE_RUN_MS = 10 * 60 * 1000;
export const DEFAULT_OWNER_POLL_MS = 1_000;

export type ExistingGatewayCheck = {
  running: boolean;
  pid?: number;
  portHeld: boolean;
};

export type ParentSignal = "SIGINT" | "SIGTERM";

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

function isSupervisorRecordLive(
  record: AppChildRecord,
  readStartTime: AppChildReadStartTime,
): boolean {
  return isSameRecordedProcess(record.supervisorPid, record.supervisorStartedAt, readStartTime);
}

export async function inspectExistingGateway(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  probePort?: typeof probePortUsage;
  readStartTime?: AppChildReadStartTime;
}): Promise<ExistingGatewayCheck> {
  const env = params.env ?? process.env;
  const readStartTime = params.readStartTime ?? ((pid: number) => defaultReadStartTime(pid, env));
  const lock = await readActiveGatewayLockIdentity({ env }).catch(() => undefined);
  const lease = readGatewayOwnerLease({ env });
  const listenerPids = findVerifiedGatewayListenerPidsOnPortSync(params.port, { env });
  const recorded = readAppChildRecord(env);
  if (
    recorded &&
    recorded.port === params.port &&
    !isSameRecordedProcess(recorded.pid, recorded.startedAt, readStartTime) &&
    !isSupervisorRecordLive(recorded, readStartTime)
  ) {
    clearAppChildRecord(env);
  }
  const liveRecord =
    recorded && isSameRecordedProcess(recorded.pid, recorded.startedAt, readStartTime)
      ? recorded
      : null;
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

export class AppChildGatewaySupervisor {
  private child: ChildProcess | null = null;
  private stopping = false;
  private starting = true;
  private spawnError: Error | null = null;
  private exitedDuringStart = false;
  private lastExitStatus: number | null = null;
  private restartCount = 0;
  private healthySince: number | null = null;
  private failedMessage: string | null = null;
  private unbindSignals: (() => void) | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerTimer: ReturnType<typeof setInterval> | null = null;
  private done: (() => void) | null = null;
  pid = 0;

  constructor(
    private readonly params: {
      port: number;
      env?: NodeJS.ProcessEnv;
      spawnImpl?: AppChildSpawnFn;
      onRespawn?: () => void;
      onGiveUp?: (message: string) => void;
      linkToParent?: boolean;
      bindSignals?: (handlers: Record<ParentSignal, () => void>) => () => void;
      raiseSignal?: (signal: ParentSignal) => void;
      sleep?: AppChildSleepFn;
      stopWaitMs?: number;
      forceKillPid?: (pid: number) => void;
      isAlive?: (pid: number) => boolean;
      readStartTime?: AppChildReadStartTime;
      waitUntilHealthy?: () => Promise<boolean>;
      ownerPid?: number;
      ownerStartedAt?: number;
      ownerPollMs?: number;
      stableRunMs?: number;
      now?: () => number;
    },
  ) {}

  get process(): ChildProcess | null {
    return this.child;
  }

  get restartAttempts(): number {
    return this.restartCount;
  }

  get isStarting(): boolean {
    return this.starting;
  }

  async start(): Promise<{ pid: number }> {
    this.stopping = false;
    this.starting = true;
    this.failedMessage = null;
    if (this.params.linkToParent) {
      this.installQuitHooks();
    }
    const started = this.spawnOnce();
    if (!started) {
      throw this.spawnError ?? new Error("Branch's engine did not start.");
    }
    return { pid: this.pid };
  }

  async run(): Promise<void> {
    await this.start();
    const healthy = await this.waitUntilChildHealthy();
    if (!healthy || this.exitedDuringStart || this.stopping) {
      if (!this.stopping) {
        this.giveUp(this.startFailedMessage());
        await this.stop({ keepError: this.failedMessage ?? GATEWAY_CHILD_START_FAILED_MESSAGE });
      }
      return;
    }
    this.markReady();
    await this.watchUntilDone();
  }

  markReady(): void {
    this.starting = false;
    this.writeLiveRecord();
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
    this.finishWatch();
    (this.params.raiseSignal ?? ((next: ParentSignal) => process.kill(process.pid, next)))(signal);
  }

  async stop(options: {
    signalPid?: typeof signalVerifiedGatewayPidSync;
    keepError?: string;
  } = {}): Promise<AppChildStopOutcome> {
    this.stopping = true;
    this.clearTimers();
    const env = this.params.env ?? process.env;
    const waitMs = this.params.stopWaitMs ?? DEFAULT_CHILD_STOP_WAIT_MS;
    const alive = this.params.isAlive ?? isPidAlive;
    const readStartTime = this.readStartTime;
    const signalPid = options.signalPid ?? signalVerifiedGatewayPidSync;
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
    const firstPid = this.pid > 0 ? this.pid : pid;
    let exited = !firstPid || !alive(firstPid);
    if (!exited && firstPid && waitMs > 0) {
      exited = await waitForPidExit({
        pid: firstPid,
        timeoutMs: waitMs,
        sleep: this.params.sleep,
        isAlive: alive,
        child: this.child,
      });
    }
    let escalated = false;
    const recorded = readAppChildRecord(env);
    const haveLiveChild = Boolean(this.child && this.pid === firstPid);
    if (
      !exited &&
      firstPid &&
      alive(firstPid) &&
      (haveLiveChild || canEscalateRecordedPid(firstPid, recorded?.startedAt, readStartTime, alive))
    ) {
      const targetPid = firstPid;
      escalated = true;
      (this.params.forceKillPid ?? ((target: number) => forceKillPid(target, this.params.spawnImpl)))(
        targetPid,
      );
      if (this.child && this.pid === targetPid) {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // forceKillPid already targeted the pid.
        }
      }
      exited = waitMs > 0
        ? await waitForPidExit({
            pid: targetPid,
            timeoutMs: waitMs,
            sleep: this.params.sleep,
            isAlive: alive,
            child: this.child,
          })
        : !alive(targetPid);
    }
    this.child = null;
    this.pid = 0;
    if (exited) {
      const keepError = options.keepError ?? this.failedMessage;
      if (keepError) {
        writeFailedAppChildRecord(this.params.port, keepError, env, {
          restartCount: this.restartCount,
        });
      } else {
        clearAppChildRecord(env);
      }
    }
    this.finishWatch();
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

  watchUntilDone(): Promise<void> {
    return new Promise((resolve) => {
      this.done = resolve;
      this.startOwnerWatch();
    });
  }

  private get readStartTime(): AppChildReadStartTime {
    const env = this.params.env ?? process.env;
    return this.params.readStartTime ?? ((pid: number) => defaultReadStartTime(pid, env));
  }

  private now(): number {
    return this.params.now?.() ?? Date.now();
  }

  private startFailedMessage(): string {
    if (this.lastExitStatus === 126 || this.lastExitStatus === 127) {
      return GATEWAY_CHILD_START_FAILED_MESSAGE;
    }
    return this.failedMessage ?? GATEWAY_CHILD_START_FAILED_MESSAGE;
  }

  private async waitUntilChildHealthy(): Promise<boolean> {
    if (this.exitedDuringStart || this.spawnError) {
      return false;
    }
    if (this.params.waitUntilHealthy) {
      const healthy = await Promise.race([
        this.params.waitUntilHealthy(),
        this.waitForExitOrError().then(() => false),
      ]);
      return Boolean(healthy) && !this.exitedDuringStart;
    }
    const { DEFAULT_RESTART_HEALTH_ATTEMPTS, DEFAULT_RESTART_HEALTH_DELAY_MS, waitForGatewayHealthyListener } =
      await import("./restart-health.js");
    const healthy = await Promise.race([
      waitForGatewayHealthyListener({
        port: this.params.port,
        attempts: DEFAULT_RESTART_HEALTH_ATTEMPTS,
        delayMs: DEFAULT_RESTART_HEALTH_DELAY_MS,
      }).then((result) => result.healthy),
      this.waitForExitOrError().then(() => false),
    ]);
    return Boolean(healthy) && !this.exitedDuringStart;
  }

  private startOwnerWatch(): void {
    if (this.ownerTimer) {
      return;
    }
    const poll = this.params.ownerPollMs ?? DEFAULT_OWNER_POLL_MS;
    this.ownerTimer = setInterval(() => {
      void this.pollOwnerOrStopRequest();
    }, poll);
    void this.pollOwnerOrStopRequest();
  }

  private async pollOwnerOrStopRequest(): Promise<void> {
    if (this.stopping) {
      return;
    }
    const env = this.params.env ?? process.env;
    const recorded = readAppChildRecord(env);
    if (recorded?.stopRequested) {
      await this.stop();
      return;
    }
    const ownerPid = this.params.ownerPid ?? recorded?.ownerPid;
    const ownerStartedAt = this.params.ownerStartedAt ?? recorded?.ownerStartedAt;
    if (!ownerPid) {
      return;
    }
    if (
      !isOwnerProcessCurrent(ownerPid, ownerStartedAt, this.readStartTime, this.params.isAlive ?? isPidAlive)
    ) {
      await this.stop();
    }
  }

  private clearTimers(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.ownerTimer) {
      clearInterval(this.ownerTimer);
      this.ownerTimer = null;
    }
  }

  private finishWatch(): void {
    this.clearTimers();
    this.removeQuitHooks();
    const done = this.done;
    this.done = null;
    done?.();
  }

  private writeLiveRecord(): void {
    const env = this.params.env ?? process.env;
    const previous = readAppChildRecord(env);
    writeAppChildRecord(
      {
        pid: this.pid || previous?.pid,
        port: this.params.port,
        startedAt:
          this.pid > 0 ? (this.readStartTime(this.pid) ?? previous?.startedAt) : previous?.startedAt,
        supervisorPid: previous?.supervisorPid ?? process.pid,
        supervisorStartedAt: previous?.supervisorStartedAt,
        ownerPid: this.params.ownerPid ?? previous?.ownerPid,
        ownerStartedAt: this.params.ownerStartedAt ?? previous?.ownerStartedAt,
        restartCount: this.restartCount,
        healthySince: this.healthySince ?? undefined,
      },
      env,
    );
  }

  private spawnOnce(): boolean {
    this.spawnError = null;
    this.exitedDuringStart = false;
    this.lastExitStatus = null;
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
      this.spawnError = new Error("Branch's engine did not start.");
      this.child = null;
      writeFailedAppChildRecord(this.params.port, this.spawnError.message, env);
      return false;
    }
    this.healthySince = this.now();
    this.writeLiveRecord();
    child.on("error", (error) => {
      this.spawnError = error;
    });
    child.on("exit", (code) => {
      this.lastExitStatus = typeof code === "number" ? code : null;
      if (this.stopping) {
        return;
      }
      if (this.starting) {
        this.exitedDuringStart = true;
        this.giveUp(GATEWAY_CHILD_START_FAILED_MESSAGE);
        return;
      }
      const stableMs = this.params.stableRunMs ?? DEFAULT_CHILD_STABLE_RUN_MS;
      if (this.healthySince !== null && this.now() - this.healthySince >= stableMs) {
        this.restartCount = 0;
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
    this.writeLiveRecord();
    const sleep = this.params.sleep;
    const run = () => {
      this.restartTimer = null;
      if (this.stopping || readAppChildRecord(this.params.env)?.stopRequested) {
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

  private giveUp(message = GATEWAY_CHILD_GAVE_UP_MESSAGE): void {
    const env = this.params.env ?? process.env;
    this.failedMessage = message;
    writeFailedAppChildRecord(this.params.port, message, env, {
      restartCount: this.restartCount,
    });
    this.child = null;
    this.pid = 0;
    this.params.onGiveUp?.(message);
    this.finishWatch();
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

export function spawnAppChildSupervisorProcess(params: {
  port: number;
  env?: NodeJS.ProcessEnv;
  spawnImpl?: AppChildSpawnFn;
  ownerPid?: number;
}): { pid: number } {
  const env = params.env ?? process.env;
  const ownerPid = params.ownerPid ?? resolveAppChildOwnerPid(env);
  const [entryArg] = process.argv.slice(1);
  const args = [
    ...process.execArgv,
    ...(entryArg ? [rewritePnpmVersionedBranchEntryPath(entryArg)] : []),
    "gateway",
    SUPERVISE_APP_CHILD_COMMAND,
    "--port",
    String(params.port),
  ];
  if (ownerPid) {
    args.push("--owner-pid", String(ownerPid));
  }
  const child = (params.spawnImpl ?? spawn)(process.execPath, args, {
    env: buildUnmanagedGatewaySpawnEnv(env),
    stdio: "ignore",
    detached: true,
    windowsHide: true,
  });
  child.unref?.();
  const pid = child.pid ?? 0;
  if (pid <= 0) {
    throw new Error("Branch's engine watcher did not start.");
  }
  const readStartTime = (target: number) => defaultReadStartTime(target, env);
  writeAppChildRecord(
    {
      port: params.port,
      supervisorPid: pid,
      supervisorStartedAt: readStartTime(pid) ?? undefined,
      ownerPid,
      ownerStartedAt: ownerPid ? (readStartTime(ownerPid) ?? undefined) : undefined,
    },
    env,
  );
  return { pid };
}

export async function runAppChildSupervisor(params: {
  port: number;
  ownerPid?: number;
}): Promise<void> {
  const env = process.env;
  const ownerPid = params.ownerPid ?? resolveAppChildOwnerPid(env);
  const supervisor = new AppChildGatewaySupervisor({
    port: params.port,
    ownerPid,
    ownerStartedAt: ownerPid ? (defaultReadStartTime(ownerPid, env) ?? undefined) : undefined,
    linkToParent: true,
  });
  rememberAppChildSupervisor(params.port, supervisor);
  await supervisor.run();
}
