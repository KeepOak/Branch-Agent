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
      profile?: string;
      source?: "argv" | "environment" | "default";
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
    { name: "missing executable", programArguments: [] },
    { name: "missing entrypoint", programArguments: ["node.exe", ""] },
    {
      name: "unknown runtime flag",
      programArguments: ["node.exe", "--unknown-runtime-flag", "branch.mjs", "gateway"],
    },
    { name: "eval runtime", programArguments: ["node.exe", "--eval", "code"] },
    {
      name: "invalid argv profile",
      programArguments: ["branch.exe", "--profile", "bad profile", "gateway"],
    },
    {
      name: "invalid saved profile",
      programArguments: ["branch.exe", "--profile=rescue", "gateway"],
      environment: { BRANCH_PROFILE: "bad profile" },
    },
  ];
  it.each(profileCases)(
    "resolves $name without rewriting captured command evidence",
    ({ programArguments, environment, profile, source }) => {
      const command: GatewayServiceCommandConfig = { programArguments, environment };
      const captured = structuredClone(command);

      expect(resolveWindowsServiceCommandProfile(command)).toEqual(
        profile === undefined ? { kind: "unavailable" } : { kind: "resolved", profile, source },
      );
      expect(command).toEqual(captured);
    },
  );
});

describe("mergeGatewayServiceEnv", () => {
  it.each([
    { platform: "win32", lowercase: false, direct: false },
    { platform: "win32", lowercase: false, direct: true },
    { platform: "win32", lowercase: true, direct: false },
    { platform: "linux", lowercase: false, direct: false },
  ] as const)(
    "projects argv profile on $platform with lowercase=$lowercase direct=$direct without redirecting native service identity",
    ({ platform, lowercase, direct }) => {
      withMockedPlatform(platform, () => {
        const home = path.resolve("service-profile-fixture");
        const caller = direct
          ? { HOME: home, BRANCH_WINDOWS_TASK_NAME: "Services\\Selected" }
          : {
              HOME: home,
              BRANCH_WINDOWS_TASK_NAME: "Services\\Selected",
              BRANCH_LAUNCHD_LABEL: "caller-agent",
              BRANCH_SYSTEMD_UNIT: "caller-unit.service",
              DBUS_SESSION_BUS_ADDRESS: "unix:path=/caller-bus",
              USER: "caller",
            };
        const command: GatewayServiceCommandConfig = direct
          ? { programArguments: ["branch.exe", "--profile=rescue", "gateway"] }
          : {
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
          ...(!direct
            ? {
                BRANCH_LAUNCHD_LABEL: "caller-agent",
                BRANCH_SYSTEMD_UNIT: "caller-unit.service",
                DBUS_SESSION_BUS_ADDRESS: "unix:path=/caller-bus",
                USER: "caller",
              }
            : {}),
        });
        expect(merged.BRANCH_CONFIG_PATH).toBe(
          direct
            ? path.join(home, ".branch-rescue", "branch.json")
            : platform === "win32"
              ? undefined
              : command.environment?.BRANCH_CONFIG_PATH,
        );
        expect({ baseEnv, command }).toEqual(captured);
      });
    },
  );
});
