// Covers app-child supervision: record the pid, fail fast on exit during start,
// restart after ready, and shut down on stop or quit.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureEnv } from "../../test-utils/env.js";

vi.mock("../../infra/gateway-lock.js", () => ({
  readActiveGatewayLockIdentity: vi.fn(async () => undefined),
}));
vi.mock("../../infra/gateway-owner-lease.js", () => ({
  readGatewayOwnerLease: vi.fn(() => undefined),
}));
vi.mock("../../infra/gateway-processes.js", () => ({
  findVerifiedGatewayListenerPidsOnPortSync: vi.fn(() => []),
  signalVerifiedGatewayPidSync: vi.fn(),
}));
vi.mock("../../infra/ports-probe.js", () => ({
  probePortUsage: vi.fn(async () => "free"),
}));
vi.mock("../../config/paths.js", () => ({
  resolveStateDir: (env: NodeJS.ProcessEnv = process.env) => env.BRANCH_STATE_DIR ?? "/tmp",
}));

const {
  AppChildGatewaySupervisor,
  buildUnmanagedGatewaySpawnEnv,
  clearAppChildRecord,
  readAppChildRecord,
  resolveAppChildRecordPath,
  stopAppChildGateway,
  writeAppChildRecord,
} = await import("./app-child-supervisor.js");

function fakeChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.pid = pid;
  child.kill = vi.fn(() => true);
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
  });

  afterEach(() => {
    clearAppChildRecord();
    envSnapshot.restore();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("records the child pid and does not detach or unref", async () => {
    const child = fakeChild(4242);
    const spawnImpl = vi.fn(() => child);
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: spawnImpl as never,
    });

    await expect(supervisor.start()).resolves.toEqual({ pid: 4242 });
    expect(readAppChildRecord()).toEqual({ pid: 4242, port: 18_789 });
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

  it("fails fast when the child exits before it is ready", async () => {
    const child = fakeChild(5001);
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
    });
    await supervisor.start();
    child.emit("exit", 126, null);
    await expect(supervisor.waitForExitOrError()).resolves.toEqual(expect.any(Error));
    expect(supervisor.process?.pid).toBe(5001);
  });

  it("restarts the child if it exits after it is ready", async () => {
    const first = fakeChild(6001);
    const second = fakeChild(6002);
    const spawnImpl = vi.fn(() => first).mockImplementationOnce(() => first).mockImplementationOnce(
      () => second,
    );
    const onRespawn = vi.fn();
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: spawnImpl as never,
      onRespawn,
    });
    await supervisor.start();
    supervisor.markReady();
    first.emit("exit", 1, null);
    expect(onRespawn).toHaveBeenCalledOnce();
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(readAppChildRecord()?.pid).toBe(6002);
  });

  it("stop and quit shut the child down", async () => {
    const child = fakeChild(7001);
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => child) as never,
    });
    await supervisor.start();
    await supervisor.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(readAppChildRecord()).toBeNull();

    const next = fakeChild(7002);
    const again = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => next) as never,
    });
    await again.start();
    again.quit();
    expect(next.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stopAppChildGateway signals a recorded pid after the supervisor is gone", async () => {
    writeAppChildRecord({ pid: process.pid, port: 18_789 });
    const signalPid = vi.fn();
    const supervisor = new AppChildGatewaySupervisor({
      port: 18_789,
      spawnImpl: vi.fn(() => fakeChild(0)) as never,
    });
    await supervisor.stop(signalPid as never);
    expect(fs.existsSync(resolveAppChildRecordPath())).toBe(false);
    await expect(stopAppChildGateway({ port: 19_001 })).resolves.toBe(false);
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
