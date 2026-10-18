// Covers app-child supervision: parent link, backoff, signal exit, stop
// escalation, and stale pid rejection.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../../test-utils/env.js";

vi.mock("../../infra/runtime-process-entrypoints.js", () => ({
  runtimeProcessEntrypoints: [],
}));
vi.mock("../../infra/gateway-state-owner-heartbeat.js", () => ({}));
vi.mock("../../infra/gateway-state-owner.js", () => ({
  acquireGatewayStateOwner: vi.fn(),
  createGatewayStateProjection: vi.fn(),
  resolveGatewayStateOwnerPath: vi.fn(),
  tryBorrowGatewayStateOwner: vi.fn(),
  GatewayStateOwnerContentionError: class extends Error {},
}));

const findVerifiedGatewayListenerPidsOnPortSync = vi.hoisted(() => vi.fn(() => [] as number[]));
const probePortUsage = vi.hoisted(() => vi.fn(async () => "free" as const));
const readActiveGatewayLockIdentity = vi.hoisted(() => vi.fn(async () => undefined));
const readGatewayOwnerLease = vi.hoisted(() => vi.fn(() => undefined));
const signalVerifiedGatewayPidSync = vi.hoisted(() => vi.fn());

vi.mock("../../infra/gateway-lock.js", () => ({
  readActiveGatewayLockIdentity: (args: unknown) => readActiveGatewayLockIdentity(args),
}));
vi.mock("../../infra/gateway-owner-lease.js", () => ({
  readGatewayOwnerLease: (args: unknown) => readGatewayOwnerLease(args),
}));
vi.mock("../../infra/gateway-processes.js", () => ({
  findVerifiedGatewayListenerPidsOnPortSync: (port: number, args: unknown) =>
    findVerifiedGatewayListenerPidsOnPortSync(port, args),
  signalVerifiedGatewayPidSync: (...args: unknown[]) => signalVerifiedGatewayPidSync(...args),
}));
vi.mock("../../infra/ports-probe.js", () => ({
  probePortUsage: (port: number) => probePortUsage(port),
}));
vi.mock("../../config/paths.js", () => ({
  resolveStateDir: (env: NodeJS.ProcessEnv = process.env) => env.BRANCH_STATE_DIR ?? "/tmp",
}));

const {
  AppChildGatewaySupervisor,
  attachAppChildFallbackStatus,
  CHILD_RESTART_BACKOFF_MS,
  GATEWAY_CHILD_ESCALATED_STOP_MESSAGE,
  GATEWAY_CHILD_GAVE_UP_MESSAGE,
  GATEWAY_CHILD_START_FAILED_MESSAGE,
  GATEWAY_CHILD_STOPPED_MESSAGE,
  MAX_CHILD_RESTARTS,
  SUPERVISE_APP_CHILD_COMMAND,
  buildUnmanagedGatewaySpawnEnv,
  clearAppChildRecord,
  forceKillPid,
  inspectExistingGateway,
  readAppChildRecord,
  resolveAppChildRecordPath,
  spawnAppChildSupervisorProcess,
  stopAppChildGateway,
  writeAppChildRecord,
} = await import("./app-child-supervisor.js");

function fakeChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.kill = vi.fn(() => true);
  child.unref = vi.fn();
  return child;
}

describe("AppChildGatewaySupervisor", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-app-child-"));
    envSnapshot = captureEnv(["BRANCH_STATE_DIR", "BRANCH_HOME"]);
    process.env.BRANCH_STATE_DIR = stateDir;
    clearAppChildRecord();
    findVerifiedGatewayListenerPidsOnPortSync.mockReset().mockReturnValue([]);
    probePortUsage.mockReset().mockResolvedValue("free");
    readActiveGatewayLockIdentity.mockReset().mockResolvedValue(undefined);
    readGatewayOwnerLease.mockReset().mockReturnValue(undefined);
    signalVerifiedGatewayPidSync.mockReset();
  });

  afterEach(() => {
    clearAppChildRecord();
    envSnapshot.restore();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("records the child pid and does not detach the gateway child", async () => {
    const child = fakeChild(4242);
    const spawnImpl = vi.fn(() => child);
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: spawnImpl as never,
    });

    await expect(supervisor.start()).resolves.toEqual({ pid: 4242 });
    expect(readAppChildRecord()?.pid).toBe(4242);
    expect(readAppChildRecord()?.port).toBe(18_789);
    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["gateway", "run"]),
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    const spawnOpts = spawnImpl.mock.calls[0]?.[2] as { detached?: boolean };
    expect(spawnOpts.detached).toBeUndefined();
  });

  it("links the long-lived parent as a detached supervise-app-child process", () => {
    const parent = fakeChild(9_001);
    const spawnImpl = vi.fn(() => parent);
    const started = spawnAppChildSupervisorProcess({
      port: 18_789,
      spawnImpl: spawnImpl as never,
    });
    expect(started).toEqual({ pid: 9_001 });
    expect(parent.unref).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["gateway", SUPERVISE_APP_CHILD_COMMAND, "--port", "18789"]),
      expect.objectContaining({
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(readAppChildRecord()?.supervisorPid).toBe(9_001);
  });

  it("fails fast when the child exits before it is ready", async () => {
    const child = fakeChild(5001);
    const onGiveUp = vi.fn();
    const onRespawn = vi.fn();
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
      onGiveUp,
      onRespawn,
    });
    await supervisor.start();
    child.emit("exit", 126, null);
    await expect(supervisor.waitForExitOrError()).resolves.toEqual(expect.any(Error));
    expect(onGiveUp).toHaveBeenCalledWith(GATEWAY_CHILD_START_FAILED_MESSAGE);
    expect(onRespawn).not.toHaveBeenCalled();
    expect(readAppChildRecord()?.error).toBe(GATEWAY_CHILD_START_FAILED_MESSAGE);
  });

  it("does not mark ready until the child is healthy and then stops the supervisor", async () => {
    const child = fakeChild(5002);
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
      waitUntilHealthy: async () => false,
      stopWaitMs: 0,
      sleep: async () => {},
      isAlive: () => false,
    });
    await supervisor.run();
    expect(supervisor.isStarting).toBe(true);
    expect(readAppChildRecord()?.error).toBe(GATEWAY_CHILD_START_FAILED_MESSAGE);
  });

  it("restarts the child with backoff after it is ready and gives up after the limit", async () => {
    const delays: number[] = [];
    const children = Array.from({ length: MAX_CHILD_RESTARTS + 2 }, (_, index) =>
      fakeChild(6_001 + index),
    );
    let spawnIndex = 0;
    const spawnImpl = vi.fn(() => children[spawnIndex++] ?? fakeChild(0));
    const onRespawn = vi.fn();
    const onGiveUp = vi.fn();
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: spawnImpl as never,
      onRespawn,
      onGiveUp,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await supervisor.start();
    supervisor.markReady();
    for (let index = 0; index < MAX_CHILD_RESTARTS; index += 1) {
      children[index]?.emit("exit", 1, null);
      await Promise.resolve();
      await Promise.resolve();
    }
    children[MAX_CHILD_RESTARTS]?.emit("exit", 1, null);
    await Promise.resolve();
    await Promise.resolve();

    expect(delays).toEqual(
      Array.from({ length: MAX_CHILD_RESTARTS }, (_, index) => CHILD_RESTART_BACKOFF_MS[Math.min(index, CHILD_RESTART_BACKOFF_MS.length - 1)]),
    );
    expect(onRespawn).toHaveBeenCalledTimes(MAX_CHILD_RESTARTS);
    expect(onGiveUp).toHaveBeenCalledWith(GATEWAY_CHILD_GAVE_UP_MESSAGE);
    expect(readAppChildRecord()?.error).toBe(GATEWAY_CHILD_GAVE_UP_MESSAGE);
    expect(readAppChildRecord()?.pid).toBeUndefined();
  });

  it("clears a dead pid when a respawn fails", async () => {
    const first = fakeChild(6001);
    const spawnImpl = vi.fn(() => first).mockImplementationOnce(() => first).mockImplementationOnce(
      () => fakeChild(0),
    );
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: spawnImpl as never,
      sleep: async () => {},
    });
    await supervisor.start();
    supervisor.markReady();
    first.emit("exit", 1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(readAppChildRecord()?.pid).toBeUndefined();
    expect(readAppChildRecord()?.error).toBe(GATEWAY_CHILD_GAVE_UP_MESSAGE);
  });

  it("removes parent signal hooks and re-raises after the child stops", async () => {
    const child = fakeChild(7001);
    child.kill.mockImplementation((signal: string) => {
      if (signal === "SIGTERM") {
        child.emit("exit", 0, "SIGTERM");
      }
      return true;
    });
    let handlers: Record<"SIGINT" | "SIGTERM", () => void> | null = null;
    const raiseSignal = vi.fn();
    const unbind = vi.fn(() => {
      handlers = null;
    });
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
      linkToParent: true,
      bindSignals: (next) => {
        handlers = next;
        return unbind;
      },
      raiseSignal,
      stopWaitMs: 50,
      sleep: async () => {},
    });
    await supervisor.start();
    expect(handlers?.SIGTERM).toEqual(expect.any(Function));
    await handlers?.SIGTERM();
    expect(unbind).toHaveBeenCalledOnce();
    expect(handlers).toBeNull();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(raiseSignal).toHaveBeenCalledWith("SIGTERM");
    expect(readAppChildRecord()).toBeNull();
  });

  it("waits for stop, escalates when SIGTERM is ignored, and reports that", async () => {
    const child = fakeChild(7002);
    let alive = true;
    const force = vi.fn((pid: number) => {
      if (pid === 7002) {
        alive = false;
        child.emit("exit", null, "SIGKILL");
      }
    });
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
      stopWaitMs: 0,
      sleep: async () => {},
      forceKillPid: force,
      isAlive: () => alive,
    });
    await supervisor.start();
    const outcome = await supervisor.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(force).toHaveBeenCalledWith(7002);
    expect(outcome).toEqual({
      stopped: true,
      escalated: true,
      message: GATEWAY_CHILD_ESCALATED_STOP_MESSAGE,
    });
    expect(readAppChildRecord()).toBeNull();
  });

  it("stop from another process signals the supervisor first so the child does not respawn", async () => {
    const child = fakeChild(4242);
    child.kill.mockImplementation((signal: string) => {
      if (signal === "SIGTERM") {
        child.emit("exit", 0, "SIGTERM");
      }
      return true;
    });
    const onRespawn = vi.fn();
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
      onRespawn,
      stopWaitMs: 20,
      sleep: async () => {},
      raiseSignal: vi.fn(),
      linkToParent: true,
      bindSignals: () => () => {},
    });
    await supervisor.start();
    supervisor.markReady();
    writeAppChildRecord({
      pid: 4242,
      port: 18_789,
      startedAt: 11,
      supervisorPid: 9_001,
      supervisorStartedAt: 10,
    });
    let supervisorAlive = true;
    const outcome = await stopAppChildGateway({
      port: 18_789,
      signalSupervisor: (pid) => {
        expect(pid).toBe(9_001);
        supervisorAlive = false;
        void supervisor.handleParentSignal("SIGTERM");
      },
      signalPid: vi.fn() as never,
      stopWaitMs: 20,
      sleep: async () => {},
      forceKillPid: vi.fn(),
      isAlive: (pid) => (pid === 9_001 ? supervisorAlive : pid === 4242 && Boolean(supervisor.process)),
      readStartTime: (pid) => (pid === 9_001 ? 10 : pid === 4242 ? 11 : null),
    });
    expect(onRespawn).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(outcome.stopped).toBe(true);
  });

  it("failed start stop signals the supervisor before a child pid exists", async () => {
    writeAppChildRecord({ port: 18_789, supervisorPid: 9_001, supervisorStartedAt: 10 });
    let live = true;
    const signaled: number[] = [];
    const outcome = await stopAppChildGateway({
      port: 18_789,
      signalSupervisor: (pid) => {
        signaled.push(pid);
        live = false;
      },
      stopWaitMs: 0,
      sleep: async () => {},
      isAlive: (pid) => pid === 9_001 && live,
      readStartTime: (pid) => (pid === 9_001 ? 10 : null),
    });
    expect(signaled).toEqual([9_001]);
    expect(outcome.stopped).toBe(true);
    expect(readAppChildRecord()).toBeNull();
  });

  it("does not escalate a reused pid", async () => {
    writeAppChildRecord({ pid: 4242, port: 18_789, startedAt: 11 });
    const force = vi.fn();
    const signalPid = vi.fn();
    await stopAppChildGateway({
      port: 18_789,
      signalPid: signalPid as never,
      stopWaitMs: 0,
      sleep: async () => {},
      forceKillPid: force,
      isAlive: () => true,
      readStartTime: () => 99,
    });
    expect(force).not.toHaveBeenCalled();
    expect(signalPid).not.toHaveBeenCalled();
    expect(readAppChildRecord()).toBeNull();
  });

  it("does not signal a reused supervisor pid and clears the stale record", async () => {
    writeAppChildRecord({
      port: 18_789,
      supervisorPid: 9_001,
      supervisorStartedAt: 10,
    });
    const signaled: number[] = [];
    const outcome = await stopAppChildGateway({
      port: 18_789,
      signalSupervisor: (pid) => {
        signaled.push(pid);
      },
      stopWaitMs: 0,
      sleep: async () => {},
      isAlive: (pid) => pid === 9_001,
      readStartTime: (pid) => (pid === 9_001 ? 99 : null),
    });
    expect(signaled).toEqual([]);
    expect(outcome.stopped).toBe(true);
    expect(readAppChildRecord()).toBeNull();
  });

  it("stops the child when the owner process is gone", async () => {
    const child = fakeChild(4242);
    let ownerAlive = true;
    let childAlive = true;
    child.kill.mockImplementation((signal: string) => {
      if (signal === "SIGTERM") {
        childAlive = false;
        child.emit("exit", 0, "SIGTERM");
      }
      return true;
    });
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
      ownerPid: 55,
      ownerStartedAt: 7,
      ownerPollMs: 1,
      stopWaitMs: 20,
      sleep: async () => {},
      isAlive: (pid) => (pid === 55 ? ownerAlive : childAlive),
      readStartTime: (pid) => (pid === 55 ? 7 : 1),
    });
    await supervisor.start();
    supervisor.markReady();
    ownerAlive = false;
    await supervisor.watchUntilDone();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(readAppChildRecord()).toBeNull();
  });

  it("resets the restart count after a stable run", async () => {
    let now = 1_000;
    const children = [fakeChild(6_001), fakeChild(6_002), fakeChild(6_003)];
    let spawnIndex = 0;
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => children[spawnIndex++] ?? fakeChild(0)) as never,
      sleep: async () => {},
      stableRunMs: 50,
      now: () => now,
    });
    await supervisor.start();
    supervisor.markReady();
    now = 1_060;
    children[0]?.emit("exit", 1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.restartAttempts).toBe(1);
    children[1]?.emit("exit", 1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.restartAttempts).toBe(2);
  });

  it("gives up after rapid crashes even when the first run was stable", async () => {
    let now = 1_000;
    const children = Array.from({ length: MAX_CHILD_RESTARTS + 2 }, (_, index) =>
      fakeChild(6_101 + index),
    );
    let spawnIndex = 0;
    const onGiveUp = vi.fn();
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => children[spawnIndex++] ?? fakeChild(0)) as never,
      onGiveUp,
      sleep: async () => {},
      stableRunMs: 50,
      now: () => now,
    });
    await supervisor.start();
    supervisor.markReady();
    now = 1_060;
    children[0]?.emit("exit", 1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.restartAttempts).toBe(1);
    for (let index = 1; index <= MAX_CHILD_RESTARTS; index += 1) {
      children[index]?.emit("exit", 1, null);
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(onGiveUp).toHaveBeenCalledWith(GATEWAY_CHILD_GAVE_UP_MESSAGE);
    expect(readAppChildRecord()?.error).toBe(GATEWAY_CHILD_GAVE_UP_MESSAGE);
  });

  it("stopAppChildGateway signals a recorded pid and waits", async () => {
    writeAppChildRecord({ pid: 4242, port: 18_789, startedAt: 11 });
    const signalPid = vi.fn();
    const force = vi.fn();
    let live = true;
    signalPid.mockImplementation(() => {
      live = false;
    });
    const outcome = await stopAppChildGateway({
      port: 18_789,
      signalPid: signalPid as never,
      stopWaitMs: 20,
      sleep: async () => {},
      forceKillPid: force,
      isAlive: (pid) => pid === 4242 && live,
      readStartTime: () => 11,
    });
    expect(signalPid).toHaveBeenCalledWith(4242, "SIGTERM", {
      env: process.env,
      port: 18_789,
    });
    expect(force).not.toHaveBeenCalled();
    expect(outcome.message).toBe(GATEWAY_CHILD_STOPPED_MESSAGE);
    expect(fs.existsSync(resolveAppChildRecordPath())).toBe(false);
    await expect(stopAppChildGateway({ port: 19_001 })).resolves.toMatchObject({ stopped: false });
  });

  it("rejects a stale record pid that is not a verified gateway", async () => {
    writeAppChildRecord({ pid: process.pid, port: 18_789, startedAt: 1 });
    readActiveGatewayLockIdentity.mockResolvedValue({
      pid: process.pid,
      port: 18_789,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
    const existing = await inspectExistingGateway({
      port: 18_789,
      readStartTime: () => 99,
    });
    expect(existing.running).toBe(false);
    expect(existing.pid).toBeUndefined();
    expect(readAppChildRecord()).toBeNull();
  });

  it("does not treat a lock pid as running unless it is a verified listener", async () => {
    readActiveGatewayLockIdentity.mockResolvedValue({
      pid: 88,
      port: 18_789,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
    const existing = await inspectExistingGateway({ port: 18_789 });
    expect(existing.running).toBe(false);
    expect(existing.pid).toBeUndefined();
  });

  it("uses taskkill /T /F on Windows", () => {
    const spawnImpl = vi.fn(() => fakeChild(1));
    forceKillPid(4242, spawnImpl as never, "win32");
    expect(spawnImpl).toHaveBeenCalledWith(
      "taskkill",
      ["/T", "/F", "/PID", "4242"],
      expect.objectContaining({ windowsHide: true, stdio: "ignore" }),
    );
  });

  it("exposes the gave-up error on the status payload the app reads", () => {
    writeAppChildRecord({
      port: 18_789,
      error: GATEWAY_CHILD_GAVE_UP_MESSAGE,
      restartCount: 8,
    });
    expect(attachAppChildFallbackStatus({ service: { loaded: false } })).toEqual({
      service: { loaded: false },
      fallback: { error: GATEWAY_CHILD_GAVE_UP_MESSAGE, restartCount: 8 },
    });
  });

  it("strips supervisor hints so the child can restart itself", () => {
    const env = buildUnmanagedGatewaySpawnEnv({
      PATH: "/bin",
      BRANCH_LAUNCHD_LABEL: "ai.branch.gateway",
      XPC_SERVICE_NAME: "ai.branch.gateway",
      BRANCH_SYSTEMD_UNIT: "branch-gateway.service",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.BRANCH_LAUNCHD_LABEL).toBeUndefined();
    expect(env.XPC_SERVICE_NAME).toBeUndefined();
    expect(env.BRANCH_SYSTEMD_UNIT).toBeUndefined();
  });
});
