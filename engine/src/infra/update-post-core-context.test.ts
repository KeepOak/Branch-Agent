import { describe, expect, it } from "vitest";
import { buildPostCoreHandoffEnv } from "./update-post-core-context.js";

describe("buildPostCoreHandoffEnv", () => {
  it("replaces only current-run handoff values without mutating the base env", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      BRANCH_COMPATIBILITY_HOST_VERSION: "stale-version",
      BRANCH_UPDATE_POST_CORE_REQUESTED_CHANNEL: "beta",
      BRANCH_UPDATE_POST_CORE_SOURCE_CONFIG_PATH: "/tmp/stale-config.json",
      BRANCH_UNRELATED: "preserved",
    };

    const absent = buildPostCoreHandoffEnv({ baseEnv });
    expect(absent).toEqual({
      PATH: "/usr/bin",
      BRANCH_UNRELATED: "preserved",
    });

    const fresh = buildPostCoreHandoffEnv({
      baseEnv,
      compatHostVersion: "2026.8.11",
      requestedChannel: "dev",
      sourceConfigPath: "/tmp/current-config.json",
    });
    expect(fresh).toMatchObject({
      BRANCH_COMPATIBILITY_HOST_VERSION: "2026.8.11",
      BRANCH_UPDATE_POST_CORE_REQUESTED_CHANNEL: "dev",
      BRANCH_UPDATE_POST_CORE_SOURCE_CONFIG_PATH: "/tmp/current-config.json",
      BRANCH_UNRELATED: "preserved",
    });
    expect(baseEnv).toMatchObject({
      BRANCH_COMPATIBILITY_HOST_VERSION: "stale-version",
      BRANCH_UPDATE_POST_CORE_REQUESTED_CHANNEL: "beta",
      BRANCH_UPDATE_POST_CORE_SOURCE_CONFIG_PATH: "/tmp/stale-config.json",
      BRANCH_UNRELATED: "preserved",
    });
  });

  it("clears mixed-case inherited values with Windows environment semantics", () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      expect(
        buildPostCoreHandoffEnv({
          baseEnv: {
            Branch_Compatibility_Host_Version: "stale-version",
            Branch_Update_Post_Core_Requested_Channel: "beta",
            Branch_Update_Post_Core_Source_Config_Path: "C:\\stale-config.json",
            BRANCH_UNRELATED: "preserved",
          },
        }),
      ).toEqual({ BRANCH_UNRELATED: "preserved" });
    } finally {
      Object.defineProperty(process, "platform", platformDescriptor!);
    }
  });
});
