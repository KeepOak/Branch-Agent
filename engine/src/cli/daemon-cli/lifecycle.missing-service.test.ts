// Drives runDaemonStart and runDaemonRestart for a missing or blocked service.
// Start and restart never install. The child is spawned once.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSystemAccountHome } from "../../daemon/service.test-helpers.js";
import { captureEnv } from "../../test-utils/env.js";

const service = {
  install: vi.fn(),
  readCommand: vi.fn(),
  readRuntime: vi.fn(),
  isLoaded: vi.fn(),
  restart: vi.fn(),
  stop: vi.fn(),
};

const runServiceStart = vi.fn();
const runServiceRestart = vi.fn();
const runServiceStop = vi.fn();
const runServiceUninstall = vi.fn();
const waitForGatewayHealthyListener = vi.fn();
const waitForGatewayHealthyRestart = vi.fn();
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
vi.mock("../../config/config.js", () => ({
  getRuntimeConfig: () => ({}),
  loadConfig: () => ({}),
  readBestEffortConfig: async () => ({}),
  resolveGatewayPort: () => resolveGatewayPort(),
}));
vi.mock("../../config/io.js", () => ({
  createConfigIO: () => ({ readBestEffortConfig: async () => ({}) }),
}));
vi.mock("../../daemon/service.js", () => ({
  resolveGatewayService: () => service,
}));
vi.mock("../../daemon/systemd.js", () => ({
  findInstalledSystemdGatewayScope: vi.fn(async () => null),
  refreshLegacySystemdServiceMetadata: vi.fn(async () => false),
  restartSystemdService: vi.fn(),
  stopSystemdService: vi.fn(),
}));
vi.mock("./launchd-recovery.js", () => ({
  recoverInstalledLaunchAgent: (args: { result: "started" | "restarted" }) =>
    recoverInstalledLaunchAgent(args),
}));
vi.mock("./lifecycle-core.js", () => ({
  runServiceRestart,
  runServiceStart,
  runServiceStop,
  runServiceUninstall,
}));
vi.mock("./restart-health.js", () => ({
  DEFAULT_RESTART_HEALTH_ATTEMPTS: 120,
  DEFAULT_RESTART_HEALTH_DELAY_MS: 500,
  waitForGatewayHealthyListener,
  waitForGatewayHealthyRestart,
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
vi.mock("../../daemon/service-update-authority.js", () => ({
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
const { GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE } = await import("./service-start-fallback.js");

function fakeChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> };
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
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
    service.install.mockReset().mockResolvedValue(undefined);
    service.stop.mockReset().mockResolvedValue(undefined);
    service.readCommand.mockReset().mockResolvedValue(null);
    service.readRuntime.mockReset().mockResolvedValue({ missingUnit: true, status: "stopped" });
    service.isLoaded.mockReset().mockResolvedValue(false);
    service.restart.mockReset();
    runServiceStart.mockReset();
    runServiceRestart.mockReset();
    runServiceStop.mockReset();
    runServiceUninstall.mockReset();
    recoverInstalledLaunchAgent.mockReset().mockResolvedValue(null);
    waitForGatewayHealthyListener.mockReset().mockResolvedValue({
      healthy: true,
      portUsage: { port: 18789, status: "busy", listeners: [], hints: [] },
    });
    waitForGatewayHealthyRestart.mockReset().mockResolvedValue({ healthy: true });
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

  it("start on a missing service supervises a child and never installs", async () => {
    let started: unknown;
    runServiceStart.mockImplementation(
      async (params: { onNotLoaded?: () => Promise<unknown> }) => {
        started = await params.onNotLoaded?.();
      },
    );

    await runDaemonStart({ json: true });

    expect(started).toEqual({
      result: "started",
      loaded: false,
      message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
      ready: true,
    });
    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
    expect(service.stop).toHaveBeenCalledWith(
      expect.not.objectContaining({ disable: true }),
    );
  });

  it("restart of a live child does not spawn a second gateway", async () => {
    runServiceStart.mockImplementation(
      async (params: { onNotLoaded?: () => Promise<unknown> }) => {
        await params.onNotLoaded?.();
      },
    );
    runServiceRestart.mockImplementation(
      async (params: { onNotLoaded?: () => Promise<unknown> }) => {
        await params.onNotLoaded?.();
        return true;
      },
    );

    await runDaemonStart({ json: true });
    expect(spawn).toHaveBeenCalledOnce();

    findVerifiedGatewayListenerPidsOnPortSync.mockReturnValue([4242]);
    readActiveGatewayLockIdentity.mockResolvedValue({
      pid: 4242,
      port: 18_789,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
    service.readRuntime.mockResolvedValue({ status: "running", pid: 4242 });

    await runDaemonRestart({ json: true });

    expect(spawn).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("does not install when start and restart run without the user action", async () => {
    runServiceStart.mockImplementation(
      async (params: { onNotLoaded?: () => Promise<unknown> }) => {
        await params.onNotLoaded?.();
      },
    );
    runServiceRestart.mockImplementation(
      async (params: { onNotLoaded?: () => Promise<unknown> }) => {
        await params.onNotLoaded?.();
        return true;
      },
    );

    await runDaemonStart({ json: true });
    findVerifiedGatewayListenerPidsOnPortSync.mockReturnValue([4242]);
    readActiveGatewayLockIdentity.mockResolvedValue({
      pid: 4242,
      port: 18_789,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
    service.readRuntime.mockResolvedValue({ status: "running", pid: 4242 });
    await runDaemonRestart({ json: true });

    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("does not fall back while an update is in progress", async () => {
    process.env.BRANCH_UPDATE_IN_PROGRESS = "1";
    let started: unknown;
    runServiceStart.mockImplementation(
      async (params: { onNotLoaded?: () => Promise<unknown> }) => {
        started = await params.onNotLoaded?.();
      },
    );

    await runDaemonStart({ json: true });

    expect(started).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
    expect(service.install).not.toHaveBeenCalled();
  });
});
