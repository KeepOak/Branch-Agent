import { describe, expect, it } from "vitest";
import { buildQaRuntimeEnv } from "./gateway-child-env.js";

function createParams(baseEnv: NodeJS.ProcessEnv) {
  return {
    baseEnv,
    configPath: "/tmp/branch-qa/branch.json",
    gatewayToken: "qa-token",
    homeDir: "/tmp/branch-qa/home",
    stateDir: "/tmp/branch-qa/state",
    tempRoot: "/tmp/branch-qa",
    xdgConfigHome: "/tmp/branch-qa/xdg-config",
    xdgDataHome: "/tmp/branch-qa/xdg-data",
    xdgCacheHome: "/tmp/branch-qa/xdg-cache",
    developmentSourceRoot: null,
  };
}

describe("QA child service identity", () => {
  it("keeps cron suppression under the child's runtime controls", () => {
    const params = createParams({ BRANCH_SKIP_CRON: "1" });

    expect(buildQaRuntimeEnv(params).BRANCH_SKIP_CRON).toBeUndefined();
    expect(
      buildQaRuntimeEnv({
        ...params,
        runtimeEnvPatch: { BRANCH_SKIP_CRON: "1" },
      }).BRANCH_SKIP_CRON,
    ).toBe("1");
  });

  it.each(["parent", "runtime patch"])(
    "keeps %s supervision out of QA-owned children",
    (source) => {
      const supervisorEnv = {
        BRANCH_SUPERVISOR_MODE: "external",
        BRANCH_LAUNCHD_LABEL: "ai.branch.gateway",
        LAUNCH_JOB_LABEL: "ai.branch.gateway",
        LAUNCH_JOB_NAME: "ai.branch.gateway",
        XPC_SERVICE_NAME: "ai.branch.gateway",
        BRANCH_SYSTEMD_UNIT: "branch-gateway.service",
        INVOCATION_ID: "synthetic-parent-invocation",
        SYSTEMD_EXEC_PID: "1234",
        JOURNAL_STREAM: "8:1234",
        BRANCH_WINDOWS_TASK_NAME: "Branch Agent Gateway",
        BRANCH_SERVICE_MARKER: "branch",
        BRANCH_SERVICE_KIND: "gateway",
      };
      const env = buildQaRuntimeEnv({
        ...createParams(
          source === "parent" ? { ...supervisorEnv, BRANCH_PROFILE: "operator" } : {},
        ),
        runtimeEnvPatch:
          source === "runtime patch"
            ? { ...supervisorEnv, BRANCH_PROFILE: "operator" }
            : undefined,
      });

      for (const key of Object.keys(supervisorEnv)) {
        expect(env[key], key).toBeUndefined();
      }
      expect(env.BRANCH_NO_RESPAWN).toBe("1");
      expect(env.BRANCH_GATEWAY_HOST_LIFELINE).toBe("stdin");
      expect(env.BRANCH_PROFILE).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/u);
      expect(env.BRANCH_PROFILE).not.toBe("operator");
      expect(env.BRANCH_PROFILE).not.toBe("default");
      expect(env.BRANCH_PROFILE).toBe(buildQaRuntimeEnv(createParams({})).BRANCH_PROFILE);
      expect(env.BRANCH_PROFILE).not.toBe(
        buildQaRuntimeEnv({ ...createParams({}), tempRoot: "/tmp/another-qa" }).BRANCH_PROFILE,
      );
      expect(env.BRANCH_STATE_DIR).toBe(createParams({}).stateDir);
      expect(env.BRANCH_CONFIG_PATH).toBe(createParams({}).configPath);
    },
  );
});
