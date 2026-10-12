import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertGatewayServiceMutationAllowed,
  formatExternalSupervisorUpdateRequired,
  isGatewayExternallySupervised,
  NON_DEFAULT_INSTALL_SERVICE_SKIP_REASON,
} from "./gateway-supervision.js";

// The env variable name is part of the observable contract the messages
// reference; the mode resolver is internal and proven through the public
// isGatewayExternallySupervised surface.
const GATEWAY_SUPERVISOR_MODE_ENV = "BRANCH_SUPERVISOR_MODE";

describe("gateway supervision", () => {
  it.each([
    { value: undefined, expected: "auto" },
    { value: "invalid", expected: "auto" },
    { value: " EXTERNAL ", expected: "external" },
  ])("resolves $value as $expected", ({ value, expected }) => {
    const env = { [GATEWAY_SUPERVISOR_MODE_ENV]: value };

    expect(isGatewayExternallySupervised(env)).toBe(expected === "external");
  });

  it("blocks native service mutation with actionable guidance", () => {
    expect(() =>
      assertGatewayServiceMutationAllowed("restart the gateway", {
        [GATEWAY_SUPERVISOR_MODE_ENV]: "external",
      }),
    ).toThrow(
      "Branch Agent gateway lifecycle is managed by an external supervisor " +
        "(BRANCH_SUPERVISOR_MODE=external). Use that supervisor to restart the gateway.",
    );
  });

  it.each([
    { BRANCH_STATE_DIR: "/tmp/copied-state" },
    { BRANCH_CONFIG_PATH: "/tmp/copied-branch.json" },
  ])("blocks native service mutation for non-default install identity %#", (override) => {
    expect(() =>
      assertGatewayServiceMutationAllowed("restart the gateway", {
        HOME: "/home/operator",
        ...override,
      }),
    ).toThrow(
      `${NON_DEFAULT_INSTALL_SERVICE_SKIP_REASON}. Rerun with HOME set to the OS account home, BRANCH_HOME either unset or pointing at that same home, and BRANCH_STATE_DIR and BRANCH_CONFIG_PATH either unset or pointing at the canonical paths for that account home and profile to restart the gateway.`,
    );
  });

  it("allows native service mutation for a named profile's canonical state dir", () => {
    const accountHome = os.userInfo().homedir;

    expect(() =>
      assertGatewayServiceMutationAllowed("restart the gateway", {
        HOME: accountHome,
        BRANCH_PROFILE: "work",
        BRANCH_STATE_DIR: path.join(accountHome, ".branch-work"),
        BRANCH_CONFIG_PATH: path.join(accountHome, ".branch-work", "branch.json"),
      }),
    ).not.toThrow();
  });

  it.each([
    {
      platform: "darwin" as const,
      platformName: "macOS",
      envKey: "BRANCH_LAUNCHD_LABEL",
      value: "ai.branch.gateway",
    },
    {
      platform: "linux" as const,
      platformName: "Linux",
      envKey: "BRANCH_SYSTEMD_UNIT",
      value: "branch-gateway.service",
    },
    {
      platform: "win32" as const,
      platformName: "Windows",
      envKey: "BRANCH_WINDOWS_TASK_NAME",
      value: "Branch Agent Gateway",
    },
  ])(
    "rejects named-profile $envKey overrides on $platformName",
    ({ platform, platformName, envKey, value }) => {
      const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      const accountHome = os.userInfo().homedir;
      try {
        expect(() =>
          assertGatewayServiceMutationAllowed("restart the gateway", {
            HOME: accountHome,
            BRANCH_PROFILE: "work",
            BRANCH_STATE_DIR: path.join(accountHome, ".branch-work"),
            BRANCH_CONFIG_PATH: path.join(accountHome, ".branch-work", "branch.json"),
            [envKey]: value,
          }),
        ).toThrow(
          `named profiles cannot override ${envKey} for ${platformName} service management`,
        );
      } finally {
        platformSpy.mockRestore();
      }
    },
  );

  it("rejects macOS profile names that collide with reserved LaunchAgent identities", () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    try {
      expect(() =>
        assertGatewayServiceMutationAllowed("restart the gateway", {
          BRANCH_PROFILE: "gateway",
        }),
      ).toThrow('macOS profile "gateway" conflicts with a reserved LaunchAgent identity');
    } finally {
      platformSpy.mockRestore();
    }
  });

  it.each([
    { platform: "darwin" as const, platformName: "macOS" },
    { platform: "win32" as const, platformName: "Windows" },
  ])(
    "rejects case-distinct native service identities on $platformName",
    ({ platform, platformName }) => {
      const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      try {
        expect(() =>
          assertGatewayServiceMutationAllowed("restart the gateway", {
            BRANCH_PROFILE: "Main",
          }),
        ).toThrow(
          `${platformName} profile "Main" is not lowercase-safe for case-insensitive state and native-service paths`,
        );
      } finally {
        platformSpy.mockRestore();
      }
    },
  );

  it("explains why self-update must be delegated", () => {
    expect(formatExternalSupervisorUpdateRequired()).toContain(
      "stop the gateway, update and finalize the runtime, then restart it safely",
    );
  });
});
