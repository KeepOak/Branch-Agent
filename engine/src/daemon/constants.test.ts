// Daemon constant tests cover platform constants used by service installers.
import { describe, expect, it } from "vitest";
import {
  resolveGatewayNativeServiceIdentityConflict,
  resolveGatewayProfileSuffix,
  resolveGatewayServiceDescription,
  resolveGatewaySystemdServiceNameCandidates,
} from "./constants.js";

describe("resolveGatewaySystemdServiceNameCandidates", () => {
  it("includes current default and legacy bare branch", () => {
    expect(resolveGatewaySystemdServiceNameCandidates()).toEqual(["branch-gateway", "branch"]);
    expect(resolveGatewaySystemdServiceNameCandidates("default")).toEqual([
      "branch-gateway",
      "branch",
    ]);
  });

  it("includes current and legacy names for a named profile", () => {
    expect(resolveGatewaySystemdServiceNameCandidates("lisa")).toEqual([
      "branch-gateway-lisa",
      "branch-lisa",
    ]);
  });

  it("omits legacy names that identify Node or another profile's gateway", () => {
    expect(resolveGatewaySystemdServiceNameCandidates("node")).toEqual(["branch-gateway-node"]);
    expect(resolveGatewaySystemdServiceNameCandidates("gateway")).toEqual([
      "branch-gateway-gateway",
    ]);
    expect(resolveGatewaySystemdServiceNameCandidates("gateway-lisa")).toEqual([
      "branch-gateway-gateway-lisa",
    ]);
  });
});

describe("resolveGatewayNativeServiceIdentityConflict", () => {
  it.each([
    {
      platform: "darwin" as const,
      envKey: "BRANCH_LAUNCHD_LABEL",
      value: "ai.branch.gateway",
    },
    {
      platform: "linux" as const,
      envKey: "BRANCH_SYSTEMD_UNIT",
      value: "branch-gateway.service",
    },
    {
      platform: "win32" as const,
      envKey: "BRANCH_WINDOWS_TASK_NAME",
      value: "Branch Agent Gateway",
    },
    {
      platform: "win32" as const,
      envKey: "BRANCH_WINDOWS_TASK_NAME",
      value: "\\Nested\\Branch Agent Gateway (work)",
    },
    {
      platform: "win32" as const,
      envKey: "BRANCH_WINDOWS_TASK_NAME",
      value: "\\Branch Agent Gateway (other)",
    },
  ])("rejects $envKey overrides for named profiles on $platform", ({ platform, envKey, value }) => {
    expect(
      resolveGatewayNativeServiceIdentityConflict(
        { BRANCH_PROFILE: "work", [envKey]: value },
        platform,
      ),
    ).toMatchObject({ envKey });
  });

  it.each([
    {
      name: "canonical named-profile systemd identity",
      platform: "linux",
      env: { BRANCH_PROFILE: "work", BRANCH_SYSTEMD_UNIT: "branch-gateway-work" },
    },
    {
      name: "default-profile systemd override",
      platform: "linux",
      env: { BRANCH_SYSTEMD_UNIT: "custom-gateway.service" },
    },
    ...["Branch Agent Gateway (work)", "\\Branch Agent Gateway (work)", "\\BRANCH GATEWAY (WORK)"].map(
      (taskName) => ({
        name: `native Windows identity ${taskName}`,
        platform: "win32" as const,
        env: { BRANCH_PROFILE: "work", BRANCH_WINDOWS_TASK_NAME: taskName },
      }),
    ),
    {
      name: "default-profile nested Windows override",
      platform: "win32",
      env: { BRANCH_WINDOWS_TASK_NAME: "\\Nested\\Custom Gateway" },
    },
  ] as const)("accepts $name", ({ env, platform }) => {
    expect(resolveGatewayNativeServiceIdentityConflict(env, platform)).toBeNull();
  });
});

describe("resolveGatewayProfileSuffix", () => {
  it("returns empty string for default profiles", () => {
    expect(resolveGatewayProfileSuffix("default")).toBe("");
    expect(resolveGatewayProfileSuffix(" Default ")).toBe("");
  });

  it("trims whitespace from profiles", () => {
    expect(resolveGatewayProfileSuffix("  staging  ")).toBe("-staging");
  });
});

describe("resolveGatewayServiceDescription", () => {
  it("includes profile when set", () => {
    expect(resolveGatewayServiceDescription({ env: { BRANCH_PROFILE: "work" } })).toBe(
      "Branch Agent Gateway (profile: work)",
    );
  });

  it("ignores legacy install-time version metadata", () => {
    expect(
      resolveGatewayServiceDescription({ env: { BRANCH_SERVICE_VERSION: "2026.1.10" } }),
    ).toBe("Branch Agent Gateway");
  });

  it("prefers explicit description override", () => {
    expect(
      resolveGatewayServiceDescription({
        env: { BRANCH_PROFILE: "work" },
        description: "Custom",
      }),
    ).toBe("Custom");
  });
});
