// Covers missing or blocked service fallback: never install, never disable, never
// replace a slow or updating service, and never start a second gateway.
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const appendGatewayLifecycleAudit = vi.hoisted(() => vi.fn());
const waitForGatewayHealthyListener = vi.hoisted(() => vi.fn());
const runDaemonInstall = vi.hoisted(() => vi.fn());
const inspectExistingGateway = vi.hoisted(() => vi.fn());
const resolveGatewayServiceMutationError = vi.hoisted(() => vi.fn());
const assertGatewayServiceFallbackAllowed = vi.hoisted(() => vi.fn());

vi.mock("./lifecycle-audit.js", () => ({
  appendGatewayLifecycleAudit: (params: unknown) => appendGatewayLifecycleAudit(params),
}));

vi.mock("./restart-health.js", () => ({
  DEFAULT_RESTART_HEALTH_ATTEMPTS: 120,
  DEFAULT_RESTART_HEALTH_DELAY_MS: 500,
  waitForGatewayHealthyListener: (params: unknown) => waitForGatewayHealthyListener(params),
}));

vi.mock("./install.runtime.js", () => ({
  runDaemonInstall: (opts: unknown) => runDaemonInstall(opts),
}));

vi.mock("./app-child-supervisor.js", () => ({
  inspectExistingGateway: (params: unknown) => inspectExistingGateway(params),
  rememberAppChildSupervisor: vi.fn(),
  stopAppChildGateway: vi.fn(),
  AppChildGatewaySupervisor: class {
    constructor(private readonly params: { spawnImpl?: (cmd: string, args: string[], opts: object) => unknown }) {}
    async start() {
      this.params.spawnImpl?.(process.execPath, ["gateway", "run"], { stdio: "ignore", windowsHide: true });
      return { pid: 8080 };
    }
    waitForExitOrError() {
      return new Promise(() => {});
    }
    markReady() {}
  },
}));

vi.mock("../../infra/gateway-supervision.js", () => ({
  resolveGatewayServiceMutationError: (action: string) =>
    resolveGatewayServiceMutationError(action),
}));

vi.mock("../../daemon/service-update-authority.js", () => ({
  assertGatewayServiceFallbackAllowed: (action: string) =>
    assertGatewayServiceFallbackAllowed(action),
}));

const {
  failAfterGatewayChildFallback,
  GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE,
  GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
  recoverGatewayAsAppChild,
  resolveGatewayChildFallbackKind,
} = await import("./service-start-fallback.js");

function fakeChild(pid: number) {
  const child = new EventEmitter() as EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> };
  child.pid = pid;
  child.kill = vi.fn(() => true);
  return child;
}

describe("recoverGatewayAsAppChild", () => {
  const service = {
    stop: vi.fn(),
    install: vi.fn(),
    readRuntime: vi.fn(),
    isLoaded: vi.fn(),
  };
  const stopLoopingService = vi.fn();
  const spawnChild = vi.fn();
  const waitUntilReady = vi.fn();

  beforeEach(() => {
    delete process.env.BRANCH_UPDATE_IN_PROGRESS;
    service.stop.mockReset().mockResolvedValue(undefined);
    service.install.mockReset().mockResolvedValue(undefined);
    service.readRuntime.mockReset().mockResolvedValue({ missingUnit: true, status: "stopped" });
    service.isLoaded.mockReset().mockResolvedValue(false);
    stopLoopingService.mockReset().mockResolvedValue(undefined);
    spawnChild.mockReset().mockResolvedValue({ pid: 4242 });
    waitUntilReady.mockReset().mockResolvedValue(true);
    appendGatewayLifecycleAudit.mockReset();
    waitForGatewayHealthyListener.mockReset().mockResolvedValue({ healthy: true });
    runDaemonInstall.mockReset();
    inspectExistingGateway.mockReset().mockResolvedValue({ running: false, portHeld: false });
    resolveGatewayServiceMutationError.mockReset().mockReturnValue(null);
    assertGatewayServiceFallbackAllowed.mockReset();
  });

  it("starts a missing service as a child and does not install or disable", async () => {
    const recovered = await recoverGatewayAsAppChild({
      result: "started",
      service,
      port: 18_789,
      knownLoadState: { status: "not-loaded" },
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });

    expect(stopLoopingService).toHaveBeenCalledOnce();
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
    expect(service.stop).not.toHaveBeenCalledWith(expect.objectContaining({ disable: true }));
    expect(recovered).toEqual({
      result: "started",
      loaded: false,
      message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
      ready: true,
    });
  });

  it("falls back after an immediate exit 126 and comes back after restart without a second child", async () => {
    service.readRuntime.mockResolvedValue({ status: "exited", lastExitStatus: 126 });
    const first = await recoverGatewayAsAppChild({
      result: "started",
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });
    inspectExistingGateway.mockResolvedValue({ running: true, pid: 4242, portHeld: true });
    const afterRestart = await recoverGatewayAsAppChild({
      result: "restarted",
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });

    expect(first?.ready).toBe(true);
    expect(afterRestart).toEqual({
      result: "restarted",
      loaded: false,
      message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
      ready: true,
    });
    expect(spawnChild).toHaveBeenCalledTimes(1);
    expect(service.install).not.toHaveBeenCalled();
  });

  it("does not replace a slow-starting service", async () => {
    await expect(
      recoverGatewayAsAppChild({
        result: "started",
        service,
        port: 18_789,
        state: { runtime: { status: "running" } },
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      }),
    ).resolves.toBeNull();
    expect(stopLoopingService).not.toHaveBeenCalled();
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("does not fall back during an update", async () => {
    process.env.BRANCH_UPDATE_IN_PROGRESS = "1";
    await expect(
      recoverGatewayAsAppChild({
        result: "restarted",
        service,
        port: 18_789,
        knownLoadState: { status: "not-loaded" },
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      }),
    ).resolves.toBeNull();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(assertGatewayServiceFallbackAllowed).not.toHaveBeenCalled();
  });

  it("skips stop when the profile guard blocks service mutation", async () => {
    resolveGatewayServiceMutationError.mockReturnValue(
      new Error("service management skipped: non-default state dir or config path"),
    );
    const recovered = await recoverGatewayAsAppChild({
      result: "started",
      service,
      port: 18_789,
      knownLoadState: { status: "not-loaded" },
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });
    expect(stopLoopingService).not.toHaveBeenCalled();
    expect(service.stop).not.toHaveBeenCalled();
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(recovered?.ready).toBe(true);
  });

  it("does not spawn when the port or lock is already held", async () => {
    inspectExistingGateway.mockResolvedValue({ running: false, portHeld: true });
    await expect(
      recoverGatewayAsAppChild({
        result: "started",
        service,
        port: 18_789,
        knownLoadState: { status: "not-loaded" },
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      }),
    ).resolves.toBeNull();
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("does not spawn after stop if the service process is still there", async () => {
    inspectExistingGateway
      .mockResolvedValueOnce({ running: false, portHeld: false })
      .mockResolvedValueOnce({ running: true, pid: 88, portHeld: true });
    await expect(
      recoverGatewayAsAppChild({
        result: "started",
        service,
        port: 18_789,
        knownLoadState: { status: "not-loaded" },
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      }),
    ).resolves.toBeNull();
    expect(stopLoopingService).toHaveBeenCalledOnce();
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it("never installs during missing or blocked recovery without the user action", async () => {
    for (const state of [
      { loadState: { status: "not-loaded" as const } },
      { runtime: { lastExitStatus: 126, status: "exited" as const } },
      { runtime: { missingUnit: true, status: "stopped" as const } },
    ]) {
      await recoverGatewayAsAppChild({
        result: "started",
        service,
        port: 18_789,
        state,
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      });
    }
    expect(service.install).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("keeps the original error when fallback does not apply", () => {
    const fail = vi.fn();
    failAfterGatewayChildFallback("token drifted", fail, ["hint"], "still-starting");
    expect(fail).toHaveBeenCalledWith("token drifted", ["hint"], "still-starting");
  });

  it("uses a plain error when fallback applied and the child also failed", () => {
    const fail = vi.fn();
    failAfterGatewayChildFallback("ignored", fail, undefined, undefined, true);
    expect(fail).toHaveBeenCalledWith(
      GATEWAY_SERVICE_BOTH_PATHS_FAILED_MESSAGE,
      undefined,
      undefined,
    );
  });

  it("decides fallback from service state, not error text", () => {
    expect(resolveGatewayChildFallbackKind({ loadState: { status: "not-loaded" } })).toBe(
      "missing",
    );
    expect(resolveGatewayChildFallbackKind({ runtime: { missingUnit: true } })).toBe("missing");
    expect(resolveGatewayChildFallbackKind({ runtime: { lastExitStatus: 126 } })).toBe(
      "blocked-exit",
    );
    expect(resolveGatewayChildFallbackKind({ runtime: { status: "running" } })).toBeNull();
    expect(
      resolveGatewayChildFallbackKind({
        runtime: { lastExitStatus: 126 },
        updateInProgress: true,
      }),
    ).toBeNull();
    expect(
      resolveGatewayChildFallbackKind({
        runtime: { status: "stopped" },
      }),
    ).toBeNull();
  });

  it("spawns a supervised child when no spawn hook is supplied", async () => {
    const child = fakeChild(8080);
    const recovered = await recoverGatewayAsAppChild({
      result: "started",
      service,
      port: 18_789,
      knownLoadState: { status: "not-loaded" },
      stopLoopingService,
      waitUntilReady,
      spawnImpl: vi.fn(() => child) as never,
    });
    expect(recovered?.ready).toBe(true);
    expect(service.install).not.toHaveBeenCalled();
  });
});
