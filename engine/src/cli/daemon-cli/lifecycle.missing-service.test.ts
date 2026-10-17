// Start and restart install a missing gateway service, then wait until it is ready.
import { beforeEach, describe, expect, it, vi } from "vitest";

const service = {
  readCommand: vi.fn(),
  readRuntime: vi.fn(),
};
const runServiceStart = vi.fn();
const runServiceRestart = vi.fn();
const recoverInstalledLaunchAgent = vi.fn();
const installMissingGatewayService = vi.fn();
const waitForGatewayHealthyRestart = vi.fn();
const resolveGatewayPort = vi.fn(() => 18_789);
const readBestEffortConfig = vi.fn(async () => ({}));

vi.mock("../../config/config.js", () => ({
  readBestEffortConfig: () => readBestEffortConfig(),
  resolveGatewayPort: () => resolveGatewayPort(),
}));
vi.mock("../../config/io.js", () => ({
  createConfigIO: () => ({ readBestEffortConfig: () => readBestEffortConfig() }),
}));
vi.mock("../../daemon/gateway-service-probe-hosts.js", () => ({
  resolveGatewayServiceProbeHosts: vi.fn(async () => ["127.0.0.1"]),
}));
vi.mock("../../daemon/service-update-authority.js", () => ({
  assertGatewayServiceFallbackAllowed: vi.fn(),
  assertGatewayServiceUpdateCurrent: vi.fn(),
}));
vi.mock("../../daemon/service.js", () => ({ resolveGatewayService: () => service }));
vi.mock("../../daemon/systemd.js", () => ({
  findInstalledSystemdGatewayScope: vi.fn(async () => null),
  restartSystemdService: vi.fn(),
  stopSystemdService: vi.fn(),
}));
vi.mock("../../infra/gateway-lock.js", () => ({
  readActiveGatewayLockIdentity: vi.fn(async () => undefined),
  readActiveGatewayLockPort: vi.fn(async () => undefined),
}));
vi.mock("../../infra/gateway-owner-lease.js", () => ({ readGatewayOwnerLease: vi.fn() }));
vi.mock("../../infra/gateway-processes.js", () => ({
  findVerifiedGatewayListenerPidsOnPortSync: vi.fn(() => []),
  formatGatewayPidList: (pids: number[]) => pids.join(", "),
  signalVerifiedGatewayPidSync: vi.fn(),
}));
vi.mock("../../infra/gateway-supervision.js", () => ({
  assertGatewayServiceMutationAllowed: vi.fn(),
  formatExternalSupervisorActionRequired: vi.fn(),
  isGatewayExternallySupervised: vi.fn(() => false),
  resolveGatewayServiceMutationError: vi.fn(() => undefined),
}));
vi.mock("../../infra/ports-probe.js", () => ({
  probePortUsage: vi.fn(async () => "free"),
}));
vi.mock("../../infra/restart.js", () => ({
  resolveGatewayRestartDeferralTimeoutMs: vi.fn(() => 0),
}));
vi.mock("../../gateway/call.js", () => ({ callGatewayCli: vi.fn() }));
vi.mock("../../gateway/probe.js", () => ({ probeGateway: vi.fn() }));
vi.mock("./launchd-recovery.js", () => ({
  recoverInstalledLaunchAgent: (args: unknown) => recoverInstalledLaunchAgent(args),
}));
vi.mock("./missing-service-install.js", () => ({
  installMissingGatewayService: (args: unknown) => installMissingGatewayService(args),
}));
vi.mock("./lifecycle-audit.js", () => ({
  appendGatewayLifecycleAudit: vi.fn(),
  createGatewayLifecycleMutationAudit: vi.fn(() => vi.fn()),
}));
vi.mock("./lifecycle-core.js", () => ({
  runServiceRestart,
  runServiceStart,
  runServiceStop: vi.fn(),
  runServiceUninstall: vi.fn(),
}));
vi.mock("./lifecycle-safe-restart.js", () => ({
  resolveGatewayRestartIntentOptions: vi.fn(() => undefined),
  runSafeGatewayRestart: vi.fn(),
}));
vi.mock("./lifecycle-unmanaged.js", () => ({
  signalGatewayRestart: vi.fn(),
}));
vi.mock("./restart-health.js", () => ({
  DEFAULT_RESTART_HEALTH_ATTEMPTS: 120,
  DEFAULT_RESTART_HEALTH_DELAY_MS: 500,
  formatGatewayRestartFailure: vi.fn(),
  renderGatewayPortHealthDiagnostics: vi.fn(() => []),
  renderRestartDiagnostics: vi.fn(() => []),
  terminateStaleGatewayPids: vi.fn(),
  waitForGatewayHealthyListener: vi.fn(),
  waitForGatewayHealthyRestart,
}));
vi.mock("./shared.js", () => ({ renderGatewayServiceStartHints: vi.fn(() => []) }));
vi.mock("./start-health.js", () => ({ verifyGatewayStartReadiness: vi.fn() }));
vi.mock("./start-repair.js", () => ({ repairLoadedGatewayServiceForStart: vi.fn() }));
vi.mock("../terminal-interactivity.js", () => ({
  isTerminalInteractive: vi.fn(() => true),
  NON_INTERACTIVE_GATEWAY_STOP_MESSAGE: "stop requires interaction",
}));

const { runDaemonStart, runDaemonRestart } = await import("./lifecycle.js");

const INSTALLED = {
  loaded: true as const,
  message: "Gateway service was missing; installed and started it.",
};

describe("missing gateway service install", () => {
  beforeEach(() => {
    service.readCommand.mockReset().mockResolvedValue(null);
    service.readRuntime.mockReset().mockResolvedValue({ status: "stopped" });
    runServiceStart.mockReset();
    runServiceRestart.mockReset();
    recoverInstalledLaunchAgent.mockReset().mockResolvedValue(null);
    installMissingGatewayService.mockReset();
    waitForGatewayHealthyRestart.mockReset().mockResolvedValue({
      healthy: true,
      staleGatewayPids: [],
      runtime: { status: "running" },
      portUsage: { port: 18_789, status: "busy", listeners: [], hints: [] },
    });
    resolveGatewayPort.mockReset().mockReturnValue(18_789);
    readBestEffortConfig.mockReset().mockResolvedValue({});
  });

  it("installs a missing gateway service when start finds nothing loaded and the gateway becomes ready", async () => {
    installMissingGatewayService.mockResolvedValue({ ...INSTALLED, result: "started" });
    let recovery: unknown;
    runServiceStart.mockImplementation(async (params: { onNotLoaded?: () => Promise<unknown> }) => {
      recovery = await params.onNotLoaded?.();
    });

    await runDaemonStart({ json: true });

    expect(installMissingGatewayService).toHaveBeenCalledWith({
      result: "started",
      opts: { json: true },
    });
    expect(recovery).toEqual({ ...INSTALLED, result: "started" });
  });

  it("installs a missing gateway service after an unmanaged restart exits and the gateway becomes ready", async () => {
    installMissingGatewayService.mockResolvedValue({ ...INSTALLED, result: "restarted" });
    runServiceRestart.mockImplementation(
      async (params: {
        onNotLoaded?: () => Promise<unknown>;
        postRestartCheck?: (ctx: {
          activationAccepted: boolean;
          json: boolean;
          stdout: NodeJS.WritableStream;
          warnings: string[];
          fail: (message: string) => void;
        }) => Promise<void>;
        opts?: { json?: boolean };
      }) => {
        const handled = await params.onNotLoaded?.();
        expect(handled).toEqual({ ...INSTALLED, result: "restarted" });
        await params.postRestartCheck?.({
          activationAccepted: true,
          json: true,
          stdout: process.stdout,
          warnings: [],
          fail: (message) => {
            throw new Error(message);
          },
        });
        return true;
      },
    );

    await runDaemonRestart({ json: true });

    expect(installMissingGatewayService).toHaveBeenCalledWith({
      result: "restarted",
      opts: { json: true },
    });
    expect(waitForGatewayHealthyRestart).toHaveBeenCalledWith(
      expect.objectContaining({ port: 18_789 }),
    );
  });
});
