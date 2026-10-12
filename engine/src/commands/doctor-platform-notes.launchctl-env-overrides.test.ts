// Doctor launchctl environment tests cover macOS gateway platform warnings for env overrides.
import fs from "node:fs";
import { expectDefined } from "@branch/normalization-core/expect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/config.js";

const mocks = vi.hoisted(() => ({
  runExec: vi.fn(),
  note: vi.fn(),
  readCommand: vi.fn(),
  findJobs: vi.fn(),
}));

vi.mock("../process/exec.js", () => ({
  runExec: mocks.runExec,
}));
vi.mock("../../packages/terminal-core/src/note.js", () => ({ note: mocks.note }));
vi.mock("../daemon/service.js", () => ({
  resolveGatewayService: () => ({ readCommand: mocks.readCommand }),
}));
vi.mock("../daemon/launchd.js", () => ({ findStaleBranchUpdateLaunchdJobs: mocks.findJobs }));

import {
  collectGatewayPlatformWarnings,
  noteMacLaunchctlGatewayEnvOverrides,
  noteMacStaleBranchUpdateLaunchdJobs,
} from "./doctor-platform-notes.js";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "darwin" });
  vi.stubEnv("HOME", "/tmp/branch-doctor-host");
  vi.stubEnv("BRANCH_STATE_DIR", "/tmp/branch-doctor-host-state");
  vi.spyOn(fs, "existsSync").mockReturnValue(false);
  mocks.runExec.mockResolvedValue({ stdout: "", stderr: "" });
  mocks.readCommand.mockResolvedValue(null);
  mocks.findJobs.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (platformDescriptor) {
    Object.defineProperty(process, "platform", platformDescriptor);
  }
});

describe("noteMacLaunchctlGatewayEnvOverrides", () => {
  it("prints clear unsetenv instructions for token override", async () => {
    mocks.runExec.mockImplementation(async (_command, [, name]) => ({
      stdout: name === "BRANCH_GATEWAY_TOKEN" ? " \tlaunchctl-token\n" : " \n",
      stderr: "",
    }));
    const cfg: BranchConfig = {
      gateway: {
        auth: {
          token: "config-token",
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.note).toHaveBeenCalledTimes(1);
    expect(mocks.runExec).toHaveBeenCalledTimes(2);

    const [message, title] = expectDefined<unknown[]>(mocks.note.mock.calls[0], "note call 0");
    expect(title).toBe("Gateway (macOS)");
    expect(message).toContain("Host-wide launchctl gateway auth overrides detected");
    expect(message).toContain("Current managed Gateway installs do not need these values");
    expect(message).toContain("BRANCH_GATEWAY_TOKEN");
    expect(message).toContain("launchctl unsetenv BRANCH_GATEWAY_TOKEN");
    expect(message).not.toContain("BRANCH_GATEWAY_PASSWORD");
    expect(message).not.toContain("launchctl-token");
    expect(message).not.toContain("config-token");
  });

  it("does nothing when config has no gateway credentials", async () => {
    mocks.runExec.mockResolvedValue({ stdout: "launchctl-token", stderr: "" });

    await noteMacLaunchctlGatewayEnvOverrides({});

    expect(mocks.runExec).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("treats SecretRef-backed credentials as configured", async () => {
    mocks.runExec.mockImplementation(async (_command, [, name]) => ({
      stdout: name === "BRANCH_GATEWAY_PASSWORD" ? " \tlaunchctl-password\n" : " \n",
      stderr: "",
    }));
    const cfg: BranchConfig = {
      gateway: {
        auth: {
          password: { source: "env", provider: "default", id: "BRANCH_GATEWAY_PASSWORD" },
        },
      },
      secrets: {
        providers: {
          default: { source: "env" },
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.note).toHaveBeenCalledTimes(1);
    const [message] = expectDefined<unknown[]>(mocks.note.mock.calls[0], "note call 0");
    expect(message).toContain("BRANCH_GATEWAY_PASSWORD");
    expect(message).not.toContain("BRANCH_GATEWAY_TOKEN");
    expect(message).not.toContain("launchctl-password");
  });

  it("does nothing on non-darwin platforms", async () => {
    Object.defineProperty(process, "platform", { ...platformDescriptor, value: "linux" });
    mocks.runExec.mockResolvedValue({ stdout: "launchctl-token", stderr: "" });
    const cfg: BranchConfig = {
      gateway: {
        auth: {
          token: "config-token",
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.runExec).not.toHaveBeenCalled();
    expect(mocks.note).not.toHaveBeenCalled();
  });

  it("bounds launchctl getenv calls and ignores timeout failures", async () => {
    mocks.runExec.mockRejectedValue(new Error("timed out"));
    const cfg: BranchConfig = {
      gateway: {
        auth: {
          token: "config-token",
        },
      },
    };

    await noteMacLaunchctlGatewayEnvOverrides(cfg);

    expect(mocks.runExec).toHaveBeenNthCalledWith(
      1,
      "/bin/launchctl",
      ["getenv", "BRANCH_GATEWAY_TOKEN"],
      { logOutput: false, timeoutMs: 5_000 },
    );
    expect(mocks.runExec).toHaveBeenNthCalledWith(
      2,
      "/bin/launchctl",
      ["getenv", "BRANCH_GATEWAY_PASSWORD"],
      { logOutput: false, timeoutMs: 5_000 },
    );
    expect(mocks.note).not.toHaveBeenCalled();
  });
});

describe("noteMacStaleBranchUpdateLaunchdJobs", () => {
  it("uses service env for gateway platform stale updater warnings", async () => {
    const serviceEnv = {
      BRANCH_STATE_DIR: "/tmp/branch-daemon",
      BRANCH_LAUNCHD_LABEL: "ai.branch.manual-update.gateway",
    };
    mocks.readCommand.mockResolvedValue({
      programArguments: ["/bin/node", "cli", "gateway"],
      environment: serviceEnv,
    });

    await collectGatewayPlatformWarnings({});

    expect(mocks.readCommand).toHaveBeenCalledTimes(1);
    expect(mocks.findJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        HOME: "/tmp/branch-doctor-host",
        BRANCH_STATE_DIR: "/tmp/branch-daemon",
        BRANCH_LAUNCHD_LABEL: "ai.branch.manual-update.gateway",
      }),
    );
  });

  it("uses service env for doctor stale updater notes", async () => {
    const serviceEnv = {
      BRANCH_STATE_DIR: "/tmp/branch-daemon",
      BRANCH_LAUNCHD_LABEL: "ai.branch.manual-update.gateway",
    };
    mocks.readCommand.mockResolvedValue({
      programArguments: ["/bin/node", "cli", "doctor"],
      environment: serviceEnv,
    });

    await noteMacStaleBranchUpdateLaunchdJobs();

    expect(mocks.readCommand).toHaveBeenCalledTimes(1);
    expect(mocks.findJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        HOME: "/tmp/branch-doctor-host",
        BRANCH_STATE_DIR: "/tmp/branch-daemon",
        BRANCH_LAUNCHD_LABEL: "ai.branch.manual-update.gateway",
      }),
    );
  });

  it("prints stale updater job cleanup guidance on macOS", async () => {
    mocks.findJobs.mockResolvedValue([
      {
        label: "ai.branch.update.2026.5.12",
        lastExitStatus: 127,
      },
      {
        label: "ai.branch.manual-update.1717168800",
        lastExitStatus: 0,
      },
    ]);

    await noteMacStaleBranchUpdateLaunchdJobs();

    expect(mocks.findJobs).toHaveBeenCalledTimes(1);
    const [message, title] = expectDefined<unknown[]>(mocks.note.mock.calls[0], "note call 0");
    expect(title).toBe("Gateway (macOS)");
    expect(message).toContain("Stale Branch Agent updater launchd job(s) detected");
    expect(message).toContain("ai.branch.update.2026.5.12");
    expect(message).toContain("ai.branch.manual-update.1717168800");
    expect(message).toContain("launchctl remove <label>");
    expect(message).toContain("branch gateway restart");
  });

  it("does nothing when no stale updater jobs exist", async () => {
    await noteMacStaleBranchUpdateLaunchdJobs();

    expect(mocks.note).not.toHaveBeenCalled();
  });
});

describe("collectGatewayPlatformWarnings", () => {
  it("collects guidance when launch agent writes are disabled", async () => {
    vi.mocked(fs.existsSync).mockImplementation(
      (candidate) => candidate === "/tmp/branch-doctor-host/.branch/disable-launchagent",
    );
    mocks.readCommand.mockResolvedValue({ environment: { HOME: "/tmp/branch-doctor-service" } });
    const warnings = await collectGatewayPlatformWarnings({});

    expect(warnings).toEqual([expect.stringContaining("LaunchAgent writes are disabled")]);
    expect(warnings[0]).toContain("disable-launchagent");
  });

  it("does nothing when launch agent writes are not disabled", async () => {
    await expect(collectGatewayPlatformWarnings({})).resolves.toEqual([]);
  });
});
