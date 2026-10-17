// Covers missing or blocked service fallback: stop any looping unit, supervise a
// child, and never install unless the user asked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const appendGatewayLifecycleAudit = vi.hoisted(() => vi.fn());
const waitForGatewayHealthyListener = vi.hoisted(() => vi.fn());
const runDaemonInstall = vi.hoisted(() => vi.fn());

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

const {
  buildUnmanagedGatewaySpawnEnv,
  GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
  GATEWAY_SERVICE_MISSING_CHILD_FALLBACK_MESSAGE,
  isGatewayServiceMissing,
  isGatewayServiceStartFailure,
  MISSING_GATEWAY_SERVICE_REASON,
  recoverGatewayAsAppChild,
  spawnUnmanagedGatewayChild,
} = await import("./service-start-fallback.js");

describe("recoverGatewayAsAppChild", () => {
  const service = { stop: vi.fn() };
  const stopLoopingService = vi.fn();
  const spawnChild = vi.fn();
  const waitUntilReady = vi.fn();

  beforeEach(() => {
    service.stop.mockReset().mockResolvedValue(undefined);
    stopLoopingService.mockReset().mockResolvedValue(undefined);
    spawnChild.mockReset().mockResolvedValue(undefined);
    waitUntilReady.mockReset().mockResolvedValue(true);
    appendGatewayLifecycleAudit.mockReset();
    waitForGatewayHealthyListener.mockReset().mockResolvedValue({ healthy: true });
    runDaemonInstall.mockReset();
  });

  it("starts a missing service as a child and does not install", async () => {
    const recovered = await recoverGatewayAsAppChild({
      result: "started",
      reason: MISSING_GATEWAY_SERVICE_REASON,
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });

    expect(stopLoopingService).toHaveBeenCalledOnce();
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(waitUntilReady).toHaveBeenCalledOnce();
    expect(runDaemonInstall).not.toHaveBeenCalled();
    expect(recovered).toEqual({
      result: "started",
      loaded: false,
      message: GATEWAY_SERVICE_MISSING_CHILD_FALLBACK_MESSAGE,
    });
  });

  it("stops a looping service after EPERM and starts a ready child", async () => {
    const recovered = await recoverGatewayAsAppChild({
      result: "started",
      reason: "/bin/sh: wrapper: Operation not permitted",
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });

    expect(stopLoopingService).toHaveBeenCalledOnce();
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(waitUntilReady).toHaveBeenCalledOnce();
    expect(runDaemonInstall).not.toHaveBeenCalled();
    expect(recovered).toEqual({
      result: "started",
      loaded: false,
      message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
    });
  });

  it("falls back after a service start timeout and comes back after restart", async () => {
    const first = await recoverGatewayAsAppChild({
      result: "started",
      reason: "Gateway start timed out after 45s waiting for /healthz and /readyz.",
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });
    const afterRestart = await recoverGatewayAsAppChild({
      result: "restarted",
      reason: "Gateway start timed out after 45s waiting for /healthz and /readyz.",
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });

    expect(first?.loaded).toBe(false);
    expect(afterRestart).toEqual({
      result: "restarted",
      loaded: false,
      message: GATEWAY_SERVICE_CHILD_FALLBACK_MESSAGE,
    });
    expect(spawnChild).toHaveBeenCalledTimes(2);
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("does not invent a child when the service error is unrelated", async () => {
    await expect(
      recoverGatewayAsAppChild({
        result: "started",
        reason: "Gateway token drifted; refuse start.",
        service,
        port: 18_789,
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      }),
    ).resolves.toBeNull();

    expect(stopLoopingService).not.toHaveBeenCalled();
    expect(spawnChild).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("surfaces a failed child start without inventing a recovery", async () => {
    waitUntilReady.mockResolvedValue(false);

    await expect(
      recoverGatewayAsAppChild({
        result: "restarted",
        reason: "Service failed to start (exit 126).",
        service,
        port: 18_789,
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      }),
    ).resolves.toBeNull();

    expect(stopLoopingService).toHaveBeenCalledOnce();
    expect(spawnChild).toHaveBeenCalledOnce();
    expect(appendGatewayLifecycleAudit).not.toHaveBeenCalled();
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("still starts the child when disable-stop fails", async () => {
    stopLoopingService.mockRejectedValue(new Error("launchctl bootout failed"));

    const recovered = await recoverGatewayAsAppChild({
      result: "started",
      reason: "Operation not permitted",
      service,
      port: 18_789,
      stopLoopingService,
      spawnChild,
      waitUntilReady,
    });

    expect(spawnChild).toHaveBeenCalledOnce();
    expect(recovered?.loaded).toBe(false);
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });

  it("never installs during missing or blocked recovery without the user action", async () => {
    for (const reason of [
      MISSING_GATEWAY_SERVICE_REASON,
      "Operation not permitted",
      "Service failed to start (exit 126).",
      "Gateway start timed out after 45s",
    ]) {
      await recoverGatewayAsAppChild({
        result: "started",
        reason,
        service,
        port: 18_789,
        stopLoopingService,
        spawnChild,
        waitUntilReady,
      });
    }

    expect(runDaemonInstall).not.toHaveBeenCalled();
  });
});

describe("unmanaged child spawn", () => {
  it("recognizes missing units, launchd EPERM, exit 126, and timeout as fallbacks", () => {
    expect(isGatewayServiceMissing("Service unit not found.")).toBe(true);
    expect(isGatewayServiceMissing("Gateway service not loaded")).toBe(true);
    expect(isGatewayServiceStartFailure("Operation not permitted")).toBe(true);
    expect(isGatewayServiceStartFailure("Service failed to start (exit 126).")).toBe(true);
    expect(isGatewayServiceStartFailure("Gateway start timed out after 45s")).toBe(true);
    expect(isGatewayServiceStartFailure("token drifted")).toBe(false);
    expect(isGatewayServiceMissing("token drifted")).toBe(false);
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

  it("spawns a hidden detached gateway run child", () => {
    const spawnImpl = vi.fn(() => {
      const child = {
        pid: 4242,
        on: vi.fn(),
        unref: vi.fn(),
      };
      return child;
    });

    const spawned = spawnUnmanagedGatewayChild({ spawnImpl: spawnImpl as never });

    expect(spawned.pid).toBe(4242);
    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["gateway", "run"]),
      expect.objectContaining({
        stdio: "ignore",
        windowsHide: true,
      }),
    );
  });
});
