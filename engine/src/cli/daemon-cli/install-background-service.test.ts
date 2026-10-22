// Covers the explicit Install background service action. Start and restart must
// never call this; only the user action runs `branch gateway install`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const runDaemonInstall = vi.hoisted(() => vi.fn());
const resolveGatewayServiceMutationError = vi.hoisted(() => vi.fn());

vi.mock("./install.runtime.js", () => ({
  runDaemonInstall: (opts: unknown) => runDaemonInstall(opts),
}));

vi.mock("../../infra/gateway-supervision.js", () => ({
  resolveGatewayServiceMutationError: (action: string) =>
    resolveGatewayServiceMutationError(action),
}));

const {
  INSTALL_BACKGROUND_SERVICE_COMMAND,
  INSTALL_BACKGROUND_SERVICE_ID,
  INSTALL_BACKGROUND_SERVICE_LABEL,
  attachInstallBackgroundServiceAction,
  resolveInstallBackgroundServiceAction,
  runInstallBackgroundService,
} = await import("./install-background-service.js");

describe("Install background service action", () => {
  beforeEach(() => {
    runDaemonInstall.mockReset().mockResolvedValue(undefined);
    resolveGatewayServiceMutationError.mockReset().mockReturnValue(null);
  });

  it("offers the action when the service is missing", () => {
    const action = resolveInstallBackgroundServiceAction({});
    expect(action).toEqual({
      id: INSTALL_BACKGROUND_SERVICE_ID,
      label: INSTALL_BACKGROUND_SERVICE_LABEL,
      command: INSTALL_BACKGROUND_SERVICE_COMMAND,
    });
    expect(action?.label).toBe("Install background service");
    expect(action?.command).toBe("branch gateway install-background-service");

    const attached = attachInstallBackgroundServiceAction({
      service: { runtime: { missingUnit: true } },
    });
    expect(attached.actions).toEqual([action]);
  });

  it("offers the action when the service is not loaded", () => {
    const attached = attachInstallBackgroundServiceAction({
      service: { loadState: { status: "not-loaded" } },
    });
    expect(attached.actions?.[0]?.label).toBe("Install background service");
    expect(attached.actions?.[0]?.command).toBe("branch gateway install-background-service");
  });

  it("does not attach the action when the service is already loaded", () => {
    const attached = attachInstallBackgroundServiceAction({
      service: { loadState: { status: "loaded" }, runtime: { missingUnit: false } },
    });
    expect(attached.actions).toBeUndefined();
  });

  it("does not offer the action when service management is blocked", () => {
    resolveGatewayServiceMutationError.mockReturnValue(
      new Error("service management skipped: non-default state dir or config path"),
    );
    expect(resolveInstallBackgroundServiceAction({})).toBeNull();
    expect(
      attachInstallBackgroundServiceAction({
        service: { runtime: { missingUnit: true } },
      }).actions,
    ).toBeUndefined();
  });

  it("runs the existing branch gateway install path when the user chooses the action", async () => {
    await runInstallBackgroundService({ json: true });

    expect(resolveGatewayServiceMutationError).toHaveBeenCalledWith("install the gateway service");
    expect(runDaemonInstall).toHaveBeenCalledWith({ json: true });
  });

  it("wires the click-only CLI command to the install action", async () => {
    const { Command } = await import("commander");
    const { addGatewayServiceCommands } = await import("./register-service-commands.js");
    const program = new Command().exitOverride();
    addGatewayServiceCommands(program);
    await program.parseAsync(["install-background-service", "--json"], { from: "user" });
    expect(runDaemonInstall).toHaveBeenCalledWith({ json: true });
  });

  it("does not install when the user action is blocked", async () => {
    resolveGatewayServiceMutationError.mockReturnValue(
      new Error("service management skipped: non-default state dir or config path"),
    );

    await expect(runInstallBackgroundService({ json: false })).rejects.toThrow(
      "service management skipped",
    );
    expect(runDaemonInstall).not.toHaveBeenCalled();
  });
});
