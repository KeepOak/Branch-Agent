// Covers supervisor marker files used to identify managed Branch Agent processes.
import { describe, expect, it } from "vitest";
import {
  detectGatewayRespawnSupervisor,
  detectRespawnSupervisor,
  SUPERVISOR_HINT_ENV_VARS,
} from "./supervisor-markers.js";

describe("SUPERVISOR_HINT_ENV_VARS", () => {
  it("includes the cross-platform supervisor hint env vars", () => {
    const envVars = new Set(SUPERVISOR_HINT_ENV_VARS);
    expect(envVars.has("BRANCH_SUPERVISOR_MODE")).toBe(true);
    expect(envVars.has("LAUNCH_JOB_LABEL")).toBe(true);
    expect(envVars.has("INVOCATION_ID")).toBe(true);
    expect(envVars.has("BRANCH_WINDOWS_TASK_NAME")).toBe(true);
    expect(envVars.has("BRANCH_SERVICE_MARKER")).toBe(true);
    expect(envVars.has("BRANCH_SERVICE_KIND")).toBe(true);
  });
});

describe("detectRespawnSupervisor", () => {
  it("detects launchd from Branch Agent's explicit marker or current gateway launchd job", () => {
    expect(
      detectRespawnSupervisor({ BRANCH_LAUNCHD_LABEL: " ai.branch.gateway " }, "darwin"),
    ).toBe("launchd");
    expect(detectRespawnSupervisor({ BRANCH_LAUNCHD_LABEL: "   " }, "darwin")).toBeNull();
    expect(detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.branch.gateway" }, "darwin")).toBe(
      "launchd",
    );
    expect(
      detectRespawnSupervisor(
        { LAUNCH_JOB_NAME: "ai.branch.work", BRANCH_PROFILE: "work" },
        "darwin",
      ),
    ).toBe("launchd");
    expect(detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.branch.mac" }, "darwin")).toBeNull();
    expect(detectRespawnSupervisor({ XPC_SERVICE_NAME: "ai.branch.mac" }, "darwin")).toBeNull();
    expect(
      detectRespawnSupervisor(
        { XPC_SERVICE_NAME: "ai.branch.mac", BRANCH_PROFILE: "mac" },
        "darwin",
      ),
    ).toBeNull();
    expect(detectRespawnSupervisor({ XPC_SERVICE_NAME: "ai.branch.gateway" }, "darwin")).toBe(
      "launchd",
    );
  });

  it("detects systemd only from non-blank platform-specific hints", () => {
    expect(detectRespawnSupervisor({ INVOCATION_ID: "abc123" }, "linux")).toBe("systemd");
    expect(detectRespawnSupervisor({ JOURNAL_STREAM: "" }, "linux")).toBeNull();
  });

  it("detects Linux Branch Agent gateway service markers only for opt-in callers", () => {
    const gatewayServiceEnv = {
      BRANCH_SERVICE_MARKER: " branch ",
      BRANCH_SERVICE_KIND: " gateway ",
    };
    expect(detectRespawnSupervisor(gatewayServiceEnv, "linux")).toBeNull();
    expect(
      detectRespawnSupervisor(gatewayServiceEnv, "linux", {
        includeLinuxBranchGatewayServiceMarker: true,
      }),
    ).toBe("systemd");
    expect(
      detectRespawnSupervisor(
        {
          BRANCH_SERVICE_MARKER: "branch",
          BRANCH_SERVICE_KIND: "worker",
        },
        "linux",
        { includeLinuxBranchGatewayServiceMarker: true },
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor(
        {
          BRANCH_SERVICE_MARKER: "other",
          BRANCH_SERVICE_KIND: "gateway",
        },
        "linux",
        { includeLinuxBranchGatewayServiceMarker: true },
      ),
    ).toBeNull();
  });

  it("detects scheduled-task supervision on Windows from either hint family", () => {
    expect(
      detectRespawnSupervisor({ BRANCH_WINDOWS_TASK_NAME: "Branch Agent Gateway" }, "win32"),
    ).toBe("schtasks");
    expect(
      detectRespawnSupervisor(
        {
          BRANCH_SERVICE_MARKER: "branch",
          BRANCH_SERVICE_KIND: "gateway",
        },
        "win32",
      ),
    ).toBe("schtasks");
    expect(
      detectRespawnSupervisor(
        {
          BRANCH_SERVICE_MARKER: "branch",
          BRANCH_SERVICE_KIND: "worker",
        },
        "win32",
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor(
        {
          BRANCH_SERVICE_MARKER: "other",
          BRANCH_SERVICE_KIND: "gateway",
        },
        "win32",
      ),
    ).toBeNull();
  });

  it("ignores service markers on non-Windows platforms and unknown platforms", () => {
    expect(
      detectRespawnSupervisor(
        {
          BRANCH_SERVICE_MARKER: "branch",
          BRANCH_SERVICE_KIND: "gateway",
        },
        "linux",
      ),
    ).toBeNull();
    expect(
      detectRespawnSupervisor({ LAUNCH_JOB_LABEL: "ai.branch.gateway" }, "freebsd"),
    ).toBeNull();
  });
});

describe("detectGatewayRespawnSupervisor", () => {
  it("keeps external ownership separate from native supervisor detection", () => {
    const env = {
      BRANCH_SUPERVISOR_MODE: "external",
      BRANCH_LAUNCHD_LABEL: "ai.branch.gateway",
    };

    expect(detectGatewayRespawnSupervisor(env, "darwin")).toBe("external");
    expect(detectRespawnSupervisor(env, "darwin")).toBe("launchd");
  });
});
