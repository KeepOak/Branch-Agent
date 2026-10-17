// Covers the missing-service install recovery used by gateway start and restart.
import { beforeEach, describe, expect, it, vi } from "vitest";

const runDaemonInstall = vi.hoisted(() => vi.fn());
const resolveGatewayServiceMutationError = vi.hoisted(() => vi.fn());
const appendGatewayLifecycleAudit = vi.hoisted(() => vi.fn());

vi.mock("./install.runtime.js", () => ({
  runDaemonInstall: (opts: unknown) => runDaemonInstall(opts),
}));

vi.mock("../../infra/gateway-supervision.js", () => ({
  resolveGatewayServiceMutationError: (action: string) =>
    resolveGatewayServiceMutationError(action),
}));

vi.mock("./lifecycle-audit.js", () => ({
  appendGatewayLifecycleAudit: (params: unknown) => appendGatewayLifecycleAudit(params),
}));

const { installMissingGatewayService, MISSING_GATEWAY_SERVICE_INSTALLED_MESSAGE } =
  await import("./missing-service-install.js");

describe("installMissingGatewayService", () => {
  beforeEach(() => {
    runDaemonInstall.mockReset().mockResolvedValue(undefined);
    resolveGatewayServiceMutationError.mockReset().mockReturnValue(null);
    appendGatewayLifecycleAudit.mockReset();
  });

  it("installs a missing gateway service when start finds nothing loaded and the gateway becomes ready", async () => {
    const recovered = await installMissingGatewayService({
      result: "started",
      opts: { json: true },
    });

    expect(resolveGatewayServiceMutationError).toHaveBeenCalledWith("install the gateway service");
    expect(runDaemonInstall).toHaveBeenCalledWith({ json: true });
    expect(appendGatewayLifecycleAudit).toHaveBeenCalledWith({
      action: "start",
      source: "cli",
      mode: "bootstrap",
    });
    expect(recovered).toEqual({
      result: "started",
      loaded: true,
      message: MISSING_GATEWAY_SERVICE_INSTALLED_MESSAGE,
    });
  });

  it("installs a missing gateway service after an unmanaged restart exits and the gateway becomes ready", async () => {
    const recovered = await installMissingGatewayService({
      result: "restarted",
      opts: { json: false },
    });

    expect(runDaemonInstall).toHaveBeenCalledWith({ json: false });
    expect(appendGatewayLifecycleAudit).toHaveBeenCalledWith({
      action: "restart",
      source: "cli",
      mode: "bootstrap",
    });
    expect(recovered).toEqual({
      result: "restarted",
      loaded: true,
      message: MISSING_GATEWAY_SERVICE_INSTALLED_MESSAGE,
    });
  });

  it("does not install when service management is not allowed", async () => {
    resolveGatewayServiceMutationError.mockReturnValue(
      new Error("service management skipped: non-default state dir or config path"),
    );

    await expect(
      installMissingGatewayService({ result: "started", opts: { json: true } }),
    ).resolves.toBeNull();

    expect(runDaemonInstall).not.toHaveBeenCalled();
    expect(appendGatewayLifecycleAudit).not.toHaveBeenCalled();
  });

  it("surfaces a failed install without inventing a recovery", async () => {
    runDaemonInstall.mockRejectedValue(new Error("Gateway install blocked: Access is denied."));

    await expect(
      installMissingGatewayService({ result: "restarted", opts: { json: true } }),
    ).rejects.toThrow("Gateway install blocked: Access is denied.");

    expect(appendGatewayLifecycleAudit).not.toHaveBeenCalled();
  });
});
