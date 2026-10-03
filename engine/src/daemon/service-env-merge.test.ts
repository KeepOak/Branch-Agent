import path from "node:path";
import { describe, expect, it } from "vitest";
import { withMockedPlatform } from "../test-utils/vitest-spies.js";
import {
  mergeGatewayServiceEnv,
  resolveWindowsServiceCommandProfile,
} from "./service-env-merge.js";
import type { GatewayServiceCommandConfig } from "./service-types.js";

describe("Windows service command profile", () => {
  const profileCases: Array<
    Pick<GatewayServiceCommandConfig, "programArguments" | "environment"> & {
      name: string;
      profile: string;
      source: "argv" | "environment" | "default";
    }
  > = [
    {
      name: "Node runtime options before the entrypoint",
      programArguments: [
        "node.exe",
        "--import",
        "bootstrap.mjs",
        "branch.mjs",
        "--profile=ops",
        "gateway",
      ],
      environment: { BRANCH_PROFILE: "saved" },
      profile: "ops",
      source: "argv",
    },
    {
      name: "direct executable with root dev",
      programArguments: ["branch.exe", "--dev", "gateway"],
      environment: { BRANCH_PROFILE: "saved" },
      profile: "dev",
      source: "argv",
    },
    {
      name: "gateway-local dev does not select a profile",
      programArguments: ["branch.exe", "gateway", "--dev"],
      environment: { branch_profile: "saved" },
      profile: "saved",
      source: "environment",
    },
    {
      name: "terminator leaves following profile text as command arguments",
      programArguments: ["node.exe", "branch.mjs", "gateway", "--", "--profile", "other"],
      environment: { BRANCH_PROFILE: "saved" },
      profile: "saved",
      source: "environment",
    },
    {
      name: "implicit default",
      programArguments: ["branch.exe", "gateway"],
      environment: undefined,
      profile: "default",
      source: "default",
    },
    {
      name: "blank saved profile is absent",
      programArguments: ["branch.exe", "gateway"],
      environment: { BRANCH_PROFILE: " \t " },
      profile: "default",
      source: "default",
    },
    {
      name: "saved default normalization",
      programArguments: ["branch.exe", "gateway"],
      environment: { BRANCH_PROFILE: "Default" },
      profile: "default",
      source: "environment",
    },
  ];
  it.each(profileCases)(
    "resolves $name without rewriting captured command evidence",
    ({ programArguments, environment, profile, source }) => {
      const command: GatewayServiceCommandConfig = { programArguments, environment };
      const captured = structuredClone(command);

      expect(resolveWindowsServiceCommandProfile(command)).toEqual({
        kind: "resolved",
        profile,
        source,
      });
      expect(command).toEqual(captured);
    },
  );

  it.each([
    { programArguments: [], environment: undefined },
    { programArguments: ["node.exe", ""], environment: undefined },
    {
      programArguments: ["node.exe", "--unknown-runtime-flag", "branch.mjs", "gateway"],
      environment: undefined,
    },
    { programArguments: ["node.exe", "--eval", "code"], environment: undefined },
    {
      programArguments: ["branch.exe", "--profile", "bad profile", "gateway"],
      environment: undefined,
    },
    {
      programArguments: ["branch.exe", "--profile=rescue", "gateway"],
      environment: { BRANCH_PROFILE: "bad profile" },
    },
  ])("does not invent a default profile for unavailable command facts: %j", (command) => {
    expect(resolveWindowsServiceCommandProfile(command)).toEqual({ kind: "unavailable" });
  });
});

describe("mergeGatewayServiceEnv", () => {
  it.each([
    { platform: "win32", lowercase: false },
    { platform: "win32", lowercase: true },
    { platform: "linux", lowercase: false },
  ] as const)(
    "projects argv profile on $platform with lowercase=$lowercase without redirecting native service identity",
    ({ platform, lowercase }) => {
      withMockedPlatform(platform, () => {
        const home = path.resolve("service-profile-fixture");
        const caller = {
          HOME: home,
          BRANCH_WINDOWS_TASK_NAME: "Services\\Selected",
          BRANCH_LAUNCHD_LABEL: "caller-agent",
          BRANCH_SYSTEMD_UNIT: "caller-unit.service",
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/caller-bus",
          USER: "caller",
        };
        const command: GatewayServiceCommandConfig = {
          programArguments: [
            "node.exe",
            "--import",
            "bootstrap.mjs",
            "branch.mjs",
            "--profile",
            "rescue",
            "gateway",
          ],
          environment: {
            BRANCH_PROFILE: "saved",
            BRANCH_STATE_DIR: path.join(home, ".branch-saved"),
            BRANCH_CONFIG_PATH: path.join(home, ".branch-saved", "branch.json"),
            BRANCH_WINDOWS_TASK_NAME: "Branch Agent Gateway (saved)",
            BRANCH_LAUNCHD_LABEL: "ai.branch.saved",
            BRANCH_SYSTEMD_UNIT: "branch-gateway-saved.service",
            BRANCH_SERVICE_MARKER: "branch",
            BRANCH_SERVICE_KIND: "gateway",
            DBUS_SESSION_BUS_ADDRESS: "unix:path=/payload-bus",
            USER: "payload",
          },
        };
        const baseEnv = lowercase
          ? Object.fromEntries(
              Object.entries(caller).map(([key, value]) => [key.toLowerCase(), value]),
            )
          : caller;
        if (lowercase) {
          command.environment = Object.fromEntries(
            Object.entries(command.environment!).map(([key, value]) => [key.toLowerCase(), value]),
          );
        }
        const captured = structuredClone({ baseEnv, command });

        const merged = mergeGatewayServiceEnv(baseEnv, command);

        expect(merged).toMatchObject({
          BRANCH_PROFILE: platform === "win32" ? "rescue" : "saved",
          BRANCH_STATE_DIR: path.join(
            home,
            platform === "win32" ? ".branch-rescue" : ".branch-saved",
          ),
          BRANCH_WINDOWS_TASK_NAME: "Services\\Selected",
          BRANCH_LAUNCHD_LABEL: "caller-agent",
          BRANCH_SYSTEMD_UNIT: "caller-unit.service",
          DBUS_SESSION_BUS_ADDRESS: "unix:path=/caller-bus",
          USER: "caller",
        });
        expect(merged.BRANCH_CONFIG_PATH).toBe(
          platform === "win32" ? undefined : command.environment?.BRANCH_CONFIG_PATH,
        );
        expect({ baseEnv, command }).toEqual(captured);
      });
    },
  );

  it("projects a direct executable argv profile when no launcher environment exists", () => {
    withMockedPlatform("win32", () => {
      const home = path.resolve("direct-service-profile-fixture");
      const baseEnv = { HOME: home, BRANCH_WINDOWS_TASK_NAME: "Services\\Selected" };
      const merged = mergeGatewayServiceEnv(baseEnv, {
        programArguments: ["branch.exe", "--profile=rescue", "gateway"],
      });
      expect(merged).toMatchObject({
        BRANCH_PROFILE: "rescue",
        BRANCH_STATE_DIR: path.join(home, ".branch-rescue"),
        BRANCH_CONFIG_PATH: path.join(home, ".branch-rescue", "branch.json"),
        BRANCH_WINDOWS_TASK_NAME: "Services\\Selected",
      });
      expect(baseEnv).toEqual({ HOME: home, BRANCH_WINDOWS_TASK_NAME: "Services\\Selected" });
    });
  });
});
