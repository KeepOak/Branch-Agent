// Drives the real runServiceStart and runServiceRestart wiring for a missing
// or blocked service. Start and restart never install. The parent is spawned
// once per attempt.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSystemAccountHome } from "../../daemon/service.test-helpers.js";
import { captureEnv } from "../../test-utils/env.js";
import {
  lifecycleTestRuntime,
  resetLifecycleRuntimeLogs,
  resetLifecycleServiceMocks,
  service,
} from "./test-helpers/lifecycle-core-harness.js";

const recoverInstalledLaunchAgent = vi.hoisted(() => vi.fn());
const resolveGatewayPort = vi.hoisted(() => vi.fn(() => 18_789));
const readActiveGatewayLockIdentity = vi.hoisted(() => vi.fn(async () => undefined));
const readActiveGatewayLockPort = vi.hoisted(() => vi.fn(async () => undefined));
const readGatewayOwnerLease = vi.hoisted(() => vi.fn(() => undefined));
const findVerifiedGatewayListenerPidsOnPortSync = vi.fn(() => [] as number[]);
const probePortUsage = vi.fn(async () => "free" as const);
const resolveGatewayServiceMutationError = vi.hoisted(() => vi.fn(() => null));
const assertGatewayServiceFallbackAllowed = vi.hoisted(() => vi.fn());
const runDaemonInstall = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
const waitForGatewayHealthyListener = vi.hoisted(() => vi.fn());
const waitForGatewayHealthyRestart = vi.hoisted(() => vi.fn());
const waitForGatewayHttpReadiness = vi.hoisted(() => vi.fn());

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
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawn(...args),
  };
});
vi.mock("../../runtime.js", () => ({ defaultRuntime: lifecycleTestRuntime }));
vi.mock("../../config/config.js", () => ({
  getRuntimeConfig: () => ({}),
  loadConfig: () => ({}),
  readBestEffortConfig: async () => ({ gateway: { port: 18_789 } }),
  resolveGatewayPort: () => resolveGatewayPort(),
}));
vi.mock("../../config/io.js", () => ({
  createConfigIO: () => ({ readBestEffortConfig: async () => ({ gateway: { port: 18_789 } }) }),
}));
vi.mock("../../daemon/service.js", async (original) => ({
  ...(await original<typeof import("../../daemon/service.js")>()),
  resolveGatewayService: () => service,
}));
vi.mock("../../daemon/systemd.js", async (original) => ({
  ...(await original<typeof import("../../daemon/systemd.js")>()),
  findInstalledSystemdGatewayScope: vi.fn(async () => null),
  refreshLegacySystemdServiceMetadata: vi.fn(async () => false),
  restartSystemdService: vi.fn(),
  stopSystemdService: vi.fn(),
}));
vi.mock("./launchd-recovery.js", () => ({
  recoverInstalledLaunchAgent: (args: { result: "started" | "restarted" }) =>
    recoverInstalledLaunchAgent(args),
}));
vi.mock("./lifecycle-action-preflight.js", () => ({
  getServiceActionPreflightFailure: async () => null,
}));
vi.mock("./restart-health.js", async (original) => ({
  ...(await original<typeof import("./restart-health.js")>()),
  waitForGatewayHealthyListener: (params: unknown) => waitForGatewayHealthyListener(params),
  waitForGatewayHealthyRestart: (params: unknown) => waitForGatewayHealthyRestart(params),
  waitForGatewayHttpReadiness: (params: unknown) => waitForGatewayHttpReadiness(params),
  renderGatewayPortHealthDiagnostics: vi.fn(() => []),
  renderRestartDiagnostics: vi.fn(() => []),
  terminateStaleGatewayPids: vi.fn(),
  formatGatewayRestartFailure: vi.fn(() => ({
    statusLine: "failed",
    failMessage: "failed",
  })),
}));
vi.mock("../../infra/gateway-lock.js", () => ({
  readActiveGatewayLockIdentity: () => readActiveGatewayLockIdentity(),
  readActiveGatewayLockPort: () => readActiveGatewayLockPort(),
  isSameGatewayLockIdentity: () => true,
}));
vi.mock("../../infra/gateway-owner-lease.js", () => ({
  readGatewayOwnerLease: () => readGatewayOwnerLease(),
}));
vi.mock("../../infra/gateway-processes.js", () => ({
  findVerifiedGatewayListenerPidsOnPortSync,
  signalVerifiedGatewayPidSync: vi.fn(),
  formatGatewayPidList: (pids: number[]) => pids.join(", "),
}));
vi.mock("../../infra/ports-probe.js", () => ({ probePortUsage }));
vi.mock("../../infra/gateway-supervision.js", () => ({
  resolveGatewayServiceMutationError: (action: string) =>
    resolveGatewayServiceMutationError(action),
  assertGatewayServiceMutationAllowed: vi.fn(),
  formatExternalSupervisorActionRequired: vi.fn(),
  isGatewayExternallySupervised: vi.fn(() => false),
}));
vi.mock("../../daemon/service-update-authority.js", async (original) => ({
  ...(await original<typeof import("../../daemon/service-update-authority.js")>()),
  assertGatewayServiceFallbackAllowed: (action: string) =>
    assertGatewayServiceFallbackAllowed(action),
  assertGatewayServiceUpdateCurrent: vi.fn(),
}));
vi.mock("./install.runtime.js", () => ({
  runDaemonInstall: (opts: unknown) => runDaemonInstall(opts),
}));
vi.mock("./start-repair.js", () => ({
  repairLoadedGatewayServiceForStart: vi.fn(),
}));
vi.mock("./lifecycle-audit.js", () => ({
  appendGatewayLifecycleAudit: vi.fn(),
  createGatewayLifecycleMutationAudit: vi.fn(() => vi.fn()),
  createServiceLifecycleMutationAudit: vi.fn(() => vi.fn()),
  appendServiceLifecycleRepairAudit: vi.fn(),
}));
vi.mock("../../gateway/call.js", () => ({
  callGatewayCli: vi.fn(async () => ({ ok: true, status: "emitted", pid: 4242 })),
}));
vi.mock("../../gateway/probe.js", () => ({
  probeGateway: vi.fn(async () => ({
    ok: true,
    configSnapshot: { commands: { restart: true } },
  })),
}));
vi.mock("../../infra/restart-intent.js", () => ({
  prepareGatewayRestartIntentLegacyProcess: async () => undefined,
  writeGatewayRestartIntentSync: vi.fn(() => true),
  writeGatewayServiceRestartIntentSync: vi.fn(() => true),
  clearGatewayRestartIntentSync: vi.fn(),
}));

const { runDaemonStart, runDaemonRestart } = await import("./lifecycle.js");
const { SUPERVISE_APP_CHILD_COMMAND } = await import("./app-child-supervisor.js");

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

function expectSupervisorSpawn() {
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    expect.arrayContaining(["gateway", SUPERVISE_APP_CHILD_COMMAND]),
    expect.objectContaining({ detached: true, windowsHide: true }),
  );
}

describe("runDaemonStart and runDaemonRestart missing or blocked service", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-missing-service-"));
    envSnapshot = captureEnv(["BRANCH_UPDATE_IN_PROGRESS", "BRANCH_STATE_DIR"]);
    delete process.env.BRANCH_UPDATE_IN_PROGRESS;
    process.env.BRANCH_STATE_DIR = stateDir;
    mockSystemAccountHome();
    resetLifecycleServiceMocks();
    resetLifecycleRuntimeLogs();
    service.install.mockReset().mockResolvedValue(undefined);
    service.stop.mockReset().mockResolvedValue(undefined);
    service.start.mockReset().mockResolvedValue(undefined);
    service.restart.mockReset().mockResolvedValue({ outcome: "completed" });
    service.readCommand.mockReset().mockResolvedValue(null);
    service.readRuntime.mockReset().mockResolvedValue({ missingUnit: true, status: "stopped" });
    service.isLoaded.mockReset().mockResolvedValue(false);
    recoverInstalledLaunchAgent.mockReset().mockResolvedValue(null);
    waitForGatewayHealthyListener.mockReset().mockResolvedValue({
      healthy: true,
      portUsage: { port: 18789, status: "busy", listeners: [], hints: [] },
    });
    waitForGatewayHealthyRestart.mockReset().mockResolvedValue({
      healthy: false,
      staleGatewayPids: [],
      runtime: { status: "stopped" },
      portUsage: { status: "free" },
    });
    waitForGatewayHttpReadiness.mockReset().mockResolvedValue({
      healthz: 0,
      readyz: 0,
    });
    readActiveGatewayLockIdentity.mockReset().mockResolvedValue(undefined);
    readActiveGatewayLockPort.mockReset().mockResolvedValue(undefined);
    readGatewayOwnerLease.mockReset().mockReturnValue(undefined);
    findVerifiedGatewayListenerPidsOnPortSync.mockReset().mockReturnValue([]);
    probePortUsage.mockReset().mockResolvedValue("free");
    resolveGatewayServiceMutationError.mockReset().mockReturnValue(null);
    assertGatewayServiceFallbackAllowed.mockReset();
    runDaemonInstall.mockReset();
    spawn.mockReset().mockImplementation(() => fakeChild(4242));
  });

  afterEach(() => {
    envSnapshot.restore();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("start on a missing service supervises a parent and never installs", async () => {
    await runDaemonStart({ json: true });

    expectSupervisorSpawn();
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
    expect(service.stop).toHaveBeenCalledWith(expect.not.objectContaining({ disable: true }));
  });

  it("start-failed recovers through onStartFailed once", async () => {
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({ programArguments: ["gateway"], environment: {} });
    service.readRuntime.mockResolvedValue({ status: "stopped", missingUnit: true });
    service.start.mockRejectedValue(new Error("service start exploded"));

    await runDaemonStart({ json: true });

    expectSupervisorSpawn();
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
  });

  it("post-start health failure recovers through postStartCheck", async () => {
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({ programArguments: ["gateway"], environment: {} });
    service.readRuntime.mockResolvedValue({ status: "stopped", missingUnit: true });
    service.start.mockResolvedValue(undefined);

    await runDaemonStart({ json: true });

    expectSupervisorSpawn();
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
  });

  it("exit 126 from start falls back once and never installs", async () => {
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({ programArguments: ["gateway"], environment: {} });
    service.readRuntime
      .mockResolvedValueOnce({ status: "stopped" })
      .mockResolvedValue({ status: "stopped", lastExitStatus: 126 });
    service.start.mockResolvedValue(undefined);

    await runDaemonStart({ json: true });

    expectSupervisorSpawn();
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
  });

  it("restart-failed recovers through onRestartFailed", async () => {
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({ programArguments: ["gateway"], environment: {} });
    service.readRuntime.mockResolvedValue({ status: "stopped", missingUnit: true });
    service.restart.mockRejectedValue(new Error("restart exploded"));

    await runDaemonRestart({ json: true });

    expectSupervisorSpawn();
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
  });

  it("post-restart health failure recovers through postRestartCheck", async () => {
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({ programArguments: ["gateway"], environment: {} });
    service.readRuntime.mockResolvedValue({ status: "stopped", missingUnit: true });
    service.restart.mockResolvedValue({ outcome: "completed" });

    await runDaemonRestart({ json: true });

    expectSupervisorSpawn();
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
  });

  it("restart of a live healthy child does not spawn a second gateway", async () => {
    await runDaemonStart({ json: true });
    expect(spawn).toHaveBeenCalledOnce();

    findVerifiedGatewayListenerPidsOnPortSync.mockReturnValue([4242]);
    readActiveGatewayLockIdentity.mockResolvedValue({
      pid: 4242,
      port: 18_789,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
    service.isLoaded.mockResolvedValue(false);
    service.readRuntime.mockResolvedValue({ status: "stopped", missingUnit: true });

    await runDaemonRestart({ json: true });

    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("does not fall back while an update is in progress", async () => {
    process.env.BRANCH_UPDATE_IN_PROGRESS = "1";

    await expect(runDaemonStart({ json: true })).rejects.toThrow(/__exit__/);

    expect(spawn).not.toHaveBeenCalled();
    expect(service.install).not.toHaveBeenCalled();
  });

  it("failed start fallback runs only once when postStartCheck then onStartFailed fire", async () => {
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({ programArguments: ["gateway"], environment: {} });
    service.readRuntime.mockResolvedValue({ status: "stopped", missingUnit: true });
    service.start.mockResolvedValue(undefined);
    waitForGatewayHealthyListener.mockResolvedValue({ healthy: false });

    await expect(runDaemonStart({ json: true })).rejects.toThrow(/__exit__/);

    expect(spawn).toHaveBeenCalledOnce();
  });
});
