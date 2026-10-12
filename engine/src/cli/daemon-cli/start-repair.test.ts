import type { DaemonRuntimePinSnapshot } from "../../daemon/runtime-pin-types.js";
const pinSnapshotMock = vi.hoisted(() =>
  vi.fn<() => DaemonRuntimePinSnapshot>(() => ({ revision: "empty", stored: false })),
);
vi.mock("../../daemon/runtime-pin-state.js", () => ({
  readDaemonRuntimePin: pinSnapshotMock,
}));
// Start repair tests cover stale service repair install-plan wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayServiceState } from "../../daemon/service.js";

const buildGatewayInstallPlanMock = vi.hoisted(() =>
  vi.fn(
    async (params: {
      existingEnvironment?: Record<string, string | undefined>;
      existingEnvironmentValueSources?: Record<
        string,
        "inline" | "file" | "inline-and-file" | undefined
      >;
    }) => {
      const preservedFileValue =
        params.existingEnvironmentValueSources?.TELEGRAM_DEFAULT_BOTTOKEN === "file";
      return {
        programArguments: ["/usr/bin/branch", "gateway", "run"],
        workingDirectory: "/tmp/branch",
        environment: {
          TELEGRAM_DEFAULT_BOTTOKEN: preservedFileValue
            ? params.existingEnvironment?.TELEGRAM_DEFAULT_BOTTOKEN
            : "placeholder-overwritten-token",
        },
        environmentValueSources: {
          TELEGRAM_DEFAULT_BOTTOKEN: preservedFileValue ? "file" : "inline",
        },
      };
    },
  ),
);
const resolveGatewayInstallTokenMock = vi.hoisted(() => vi.fn());
const readConfigFileSnapshotForWriteMock = vi.hoisted(() => vi.fn());
const resolveGatewayPortMock = vi.hoisted(() =>
  vi.fn(
    (config: { gateway?: { port?: number } } | undefined, env: NodeJS.ProcessEnv = process.env) => {
      const portMatch = env.BRANCH_GATEWAY_PORT?.trim().match(/(?:^|:)(\d+)$/);
      return Number(portMatch?.[1]) || config?.gateway?.port || 18_789;
    },
  ),
);
const resolveStateDirMock = vi.hoisted(() =>
  vi.fn((env: NodeJS.ProcessEnv) => env.BRANCH_STATE_DIR?.trim() || `${env.HOME}/.branch`),
);
const resolveConfigPathCandidateMock = vi.hoisted(() =>
  vi.fn(
    (env: NodeJS.ProcessEnv) =>
      env.BRANCH_CONFIG_PATH?.trim() ||
      `${env.BRANCH_STATE_DIR?.trim() || `${env.HOME}/.branch`}/branch.json`,
  ),
);
const resolveBranchWrapperPathMock = vi.hoisted(() => vi.fn());
const formatGatewayServiceStartRepairIssuesMock = vi.hoisted(() => vi.fn());
const defaultRuntimeLogMock = vi.hoisted(() => vi.fn());
const assertGatewayServiceMutationAllowedMock = vi.hoisted(() => vi.fn());
const resolveBunRuntimeInfoMock = vi.hoisted(() => vi.fn());

vi.mock("../../commands/daemon-install-helpers.js", () => ({
  buildGatewayInstallPlan: buildGatewayInstallPlanMock,
}));

vi.mock("../../commands/daemon-runtime.js", () => ({
  DEFAULT_GATEWAY_DAEMON_RUNTIME: "node",
  resolveGatewayDaemonRuntime: (programArguments: string[] | undefined) =>
    programArguments?.[0]?.endsWith("/bun") ? "bun" : "node",
}));

vi.mock("../../commands/gateway-install-token.js", () => ({
  resolveGatewayInstallToken: resolveGatewayInstallTokenMock,
}));

vi.mock("../../config/io.js", () => ({
  readConfigFileSnapshotForWrite: readConfigFileSnapshotForWriteMock,
}));

vi.mock("../../config/paths.js", () => ({
  resolveConfigPathCandidate: resolveConfigPathCandidateMock,
  resolveGatewayPort: resolveGatewayPortMock,
  resolveStateDir: resolveStateDirMock,
}));

vi.mock("../../daemon/program-args.js", () => ({
  BRANCH_WRAPPER_ENV_KEY: "BRANCH_WRAPPER",
  resolveBranchWrapperPath: resolveBranchWrapperPathMock,
}));

vi.mock("../../daemon/runtime-paths.js", () => ({
  resolveBunRuntimeInfo: resolveBunRuntimeInfoMock,
  resolvePinnedDaemonRuntimePath: vi.fn(async (path) => path),
}));

vi.mock("../../daemon/service.js", () => ({
  formatGatewayServiceStartRepairIssues: formatGatewayServiceStartRepairIssuesMock,
}));

vi.mock("../../infra/gateway-supervision.js", () => ({
  assertGatewayServiceMutationAllowed: assertGatewayServiceMutationAllowedMock,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: { log: defaultRuntimeLogMock },
}));

const { repairLoadedGatewayServiceForStart } = await import("./start-repair.js");

function readFirstInstallPlanArg(): Record<string, unknown> {
  const [firstArg] = buildGatewayInstallPlanMock.mock.calls[0] ?? [];
  if (!firstArg) {
    throw new Error("expected first install plan call");
  }
  return firstArg as Record<string, unknown>;
}

function stoppedServiceState(
  command: GatewayServiceState["command"],
  env: GatewayServiceState["env"] = {},
): GatewayServiceState {
  return {
    installed: true,
    loadState: { status: "loaded" },
    running: false,
    env,
    command,
  };
}

describe("repairLoadedGatewayServiceForStart", () => {
  beforeEach(() => {
    pinSnapshotMock.mockReset().mockReturnValue({ revision: "empty", stored: false });
    vi.stubEnv("HOME", "/home/branch");
    vi.stubEnv("BRANCH_CONFIG_PATH", "");
    vi.stubEnv("BRANCH_GATEWAY_PORT", "");
    vi.stubEnv("BRANCH_HOME", "");
    vi.stubEnv("BRANCH_PROFILE", "");
    vi.stubEnv("BRANCH_STATE_DIR", "");
    buildGatewayInstallPlanMock.mockClear();
    resolveGatewayInstallTokenMock.mockReset();
    readConfigFileSnapshotForWriteMock.mockReset();
    resolveGatewayPortMock.mockClear();
    resolveBranchWrapperPathMock.mockReset();
    formatGatewayServiceStartRepairIssuesMock.mockReset();
    defaultRuntimeLogMock.mockClear();
    assertGatewayServiceMutationAllowedMock.mockReset();
    resolveBunRuntimeInfoMock.mockReset();
    resolveBunRuntimeInfoMock.mockResolvedValue({ status: "supported" });

    resolveGatewayInstallTokenMock.mockResolvedValue({
      warnings: [],
    });
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: { exists: true, valid: true, sourceConfig: {}, config: {} },
      writeOptions: { expectedConfigPath: "/tmp/branch.json" },
    });
    resolveBranchWrapperPathMock.mockResolvedValue("/usr/bin/branch");
    formatGatewayServiceStartRepairIssuesMock.mockReturnValue(
      "service port does not match current gateway config",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      kind: "sealed",
      reason: "foreign-owner",
      artifact: "service-file",
      guidance: "deployment owner",
    },
    {
      kind: "unknown",
      reason: "unsafe-permissions",
      artifact: "service-directory",
      guidance: "chmod go-w",
    },
    {
      kind: "unknown",
      reason: "inspection-failed",
      artifact: "service-file",
      guidance: "Inspect service definition access",
    },
  ] as const)(
    "explains $reason without exposing raw details or doing config/token work",
    async ({ guidance, ...capability }) => {
      const install = vi.fn();
      const service = {
        install,
        isLoaded: vi.fn(async () => true),
        readDefinitionMutationCapability: vi.fn(async () => ({
          ...capability,
          detail: "repair-inspection-secret-canary",
        })),
      };
      const state = stoppedServiceState(
        {
          programArguments: ["/usr/bin/branch", "gateway"],
          environment: { HOME: "/home/branch" },
        },
        { HOME: "/home/branch" },
      );
      const params = {
        service,
        state,
        issues: [{ code: "missing-program" as const, message: "missing" }],
        json: true,
        stdout: process.stdout,
      };
      for (const action of ["start", "restart"] as const) {
        const repair =
          action === "restart"
            ? repairLoadedGatewayServiceForStart({ ...params, action })
            : repairLoadedGatewayServiceForStart(params);
        await expect(repair).rejects.toThrow(`SERVICE_DEFINITION_${capability.kind.toUpperCase()}`);
        await expect(repair).rejects.toThrow(guidance);
        await expect(repair).rejects.not.toThrow("secret-canary");
      }
      expect(readConfigFileSnapshotForWriteMock).not.toHaveBeenCalled();
      expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
    },
  );

  it("preserves the managed base environment when an environment-only drop-in overrides it", async () => {
    const installMock = vi.fn(async () => {});
    const isLoadedMock = vi.fn(async () => true);
    const service = {
      install: installMock,
      isLoaded: isLoadedMock,
    };
    pinSnapshotMock.mockReturnValue({
      revision: "prior",
      stored: true,
      pin: { runtime: "bun", path: "/inactive/bun" },
    });
    const existingEnvironment = {
      HOME: "/home/branch",
      BRANCH_SERVICE_VERSION: "2026.4.24",
      BRANCH_WRAPPER: "/usr/bin/branch",

      TELEGRAM_DEFAULT_BOTTOKEN: "existing-env-file-token",
    };
    const existingEnvironmentValueSources = {
      BRANCH_SERVICE_VERSION: "inline" as const,
      TELEGRAM_DEFAULT_BOTTOKEN: "file" as const,
    };
    const programArguments = [
      "/usr/bin/node",
      "--max-old-space-size=24576",
      "--require=/tmp/service-preload.js",
      "/usr/local/bin/branch",
      "gateway",
    ];
    const state = stoppedServiceState({
      programArguments,
      environment: {
        ...existingEnvironment,
        BRANCH_WRAPPER: "/srv/operator/branch",
        OPERATOR_DROPIN_ONLY: "operator-owned",
        NODE_OPTIONS: "--max-old-space-size=512",
        TELEGRAM_DEFAULT_BOTTOKEN: "operator-drop-in-token",
      },
      environmentValueSources: {
        ...existingEnvironmentValueSources,
        TELEGRAM_DEFAULT_BOTTOKEN: "inline",
      },
      managedDefinition: {
        programArguments,
        environment: existingEnvironment,
        environmentValueSources: existingEnvironmentValueSources,
      },
      managedOverrides: { environment: { keys: ["NODE_OPTIONS"] } },
    });

    await repairLoadedGatewayServiceForStart({
      service,
      state,
      issues: [{ code: "port-mismatch", message: "old port" }],
      json: true,
      stdout: process.stdout,
    });

    const planArg = readFirstInstallPlanArg();
    expect(planArg.existingCommand).toBe(state.command);
    expect(planArg.existingEnvironment).toBe(existingEnvironment);
    expect(planArg.existingEnvironmentValueSources).toBe(existingEnvironmentValueSources);
    expect(planArg.env).not.toHaveProperty("OPERATOR_DROPIN_ONLY");
    expect(resolveBranchWrapperPathMock).toHaveBeenCalledWith("/usr/bin/branch");
    expect(planArg.pinnedRuntimePath).toBe("/inactive/bun");
    expect(resolveBunRuntimeInfoMock).not.toHaveBeenCalled();
    expect(installMock).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: { TELEGRAM_DEFAULT_BOTTOKEN: "existing-env-file-token" },
        environmentValueSources: { TELEGRAM_DEFAULT_BOTTOKEN: "file" },
      }),
    );
  });

  it.each([
    { status: "supported", expectedRuntime: "bun" },
    { status: "unsupported", expectedRuntime: "node" },
    { status: "probe-failed", expectedRuntime: null },
    { status: "unsupported", sqliteSelectionError: true, expectedRuntime: null },
  ])(
    "repairs an installed Bun Gateway only when its probe result is known ($status, selection error: $sqliteSelectionError)",
    async ({ status, sqliteSelectionError, expectedRuntime }) => {
      const error = new Error("Bun runtime probe failed (cwd /root): EACCES");
      const selectionError =
        "Cannot use SQLite library /opt/broken/libsqlite3.dylib: missing file. Fix or unset BRANCH_SQLITE_LIBRARY; install a supported library with brew install sqlite.";
      resolveBunRuntimeInfoMock.mockResolvedValue({
        status,
        error,
        ...(sqliteSelectionError ? { sqliteSelectionError: selectionError } : {}),
      });
      const service = {
        install: vi.fn(async () => {}),
        isLoaded: vi.fn(async () => true),
      };
      const state = stoppedServiceState({
        programArguments: [
          "/home/branch/.bun/bin/bun",
          "/usr/lib/branch/dist/index.js",
          "gateway",
          "--port",
          "18789",
        ],
        environment: { HOME: "/home/branch", BRANCH_GATEWAY_PORT: "18789" },
      });

      const repair = repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "port-mismatch", message: "old port" }],
        json: true,
        stdout: process.stdout,
      });
      if (expectedRuntime === null) {
        // Neither an unreadable probe nor an operator's broken override may rewrite the service to Node.
        await expect(repair).rejects.toThrow(
          status === "probe-failed" ? error.message : selectionError,
        );
        expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
        expect(service.install).not.toHaveBeenCalled();
        return;
      }
      await repair;

      const plan = readFirstInstallPlanArg();
      expect(plan.runtime).toBe(expectedRuntime);
      expect(plan.runtimePath).toBe(
        expectedRuntime === "bun" ? "/home/branch/.bun/bin/bun" : undefined,
      );
    },
  );

  it.each([
    ["command", { launcher: "command" as const }, undefined],
    ["working directory", { launcher: "working-directory" as const }, undefined],
    [
      "gateway target environment",
      { environment: { keys: ["BRANCH_STATE_DIR"] } },
      { HOME: "/home/branch", BRANCH_STATE_DIR: "/srv/operator-state" },
    ],
  ])(
    "refuses an ineffective stopped-service repair for a %s drop-in",
    async (_, overrides, effectiveEnvironment) => {
      const installMock = vi.fn(async () => {});
      const service = { install: installMock, isLoaded: vi.fn(async () => true) };
      const managedDefinition = {
        programArguments: ["/usr/bin/branch", "gateway", "run"],
        workingDirectory: "/srv/branch",
        environment: { HOME: "/home/branch" },
      };
      const state = stoppedServiceState({
        ...managedDefinition,
        ...(effectiveEnvironment ? { environment: effectiveEnvironment } : {}),
        sourcePath: "/home/branch/.config/systemd/user/branch-work.service",
        managedDefinition,
        managedOverrides: overrides,
      });

      await expect(
        repairLoadedGatewayServiceForStart({
          service,
          state,
          issues: [{ code: "missing-program", message: "missing program" }],
          json: true,
          stdout: process.stdout,
        }),
      ).rejects.toThrow(/systemd drop-in.*systemctl --user cat branch-work\.service/);

      expect(readConfigFileSnapshotForWriteMock).not.toHaveBeenCalled();
      expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
      expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
      expect(installMock).not.toHaveBeenCalled();
    },
  );

  it.each(["start", "restart"] as const)(
    "refuses %s repair when ambient state, config, and port target a different service",
    async (action) => {
      vi.stubEnv("BRANCH_STATE_DIR", "/home/branch/stress-state");
      vi.stubEnv("BRANCH_CONFIG_PATH", "/home/branch/stress-state/branch.json");
      readConfigFileSnapshotForWriteMock.mockResolvedValue({
        snapshot: {
          exists: true,
          valid: true,
          sourceConfig: { gateway: { port: 18_999 } },
          config: { gateway: { port: 18_999 } },
        },
        writeOptions: { expectedConfigPath: "/home/branch/stress-state/branch.json" },
      });

      const originalUnit = [
        "ExecStart=/usr/bin/branch gateway --port 18789",
        "EnvironmentFile=-/home/branch/.branch/gateway.systemd.env",
        "Environment=BRANCH_SERVICE_MANAGED_ENV_KEYS=OPENAI_API_KEY,BRANCH_GATEWAY_PASSWORD",
      ].join("\n");
      let unit = originalUnit;
      const installMock = vi.fn(async () => {
        unit = "rewritten";
      });
      const service = {
        install: installMock,
        isLoaded: vi.fn(async () => true),
      };
      const state = stoppedServiceState({
        programArguments: ["/usr/bin/branch", "gateway", "--port", "18789"],
        environment: {
          HOME: "/home/branch",
          OPENAI_API_KEY: "file-backed-openai-key",
          BRANCH_GATEWAY_PASSWORD: "file-backed-password",
          BRANCH_GATEWAY_PORT: "18789",
          BRANCH_SERVICE_MANAGED_ENV_KEYS: "OPENAI_API_KEY,BRANCH_GATEWAY_PASSWORD",
        },
        environmentValueSources: {
          HOME: "inline",
          OPENAI_API_KEY: "file",
          BRANCH_GATEWAY_PASSWORD: "file",
          BRANCH_GATEWAY_PORT: "inline",
          BRANCH_SERVICE_MANAGED_ENV_KEYS: "inline",
        },
      });

      const repairParams = {
        service,
        state,
        issues: [{ code: "port-mismatch" as const, message: "old port" }],
        json: true,
        stdout: process.stdout,
      };
      const repair =
        action === "restart"
          ? repairLoadedGatewayServiceForStart({ ...repairParams, action })
          : repairLoadedGatewayServiceForStart(repairParams);
      await expect(repair).rejects.toThrow(
        [
          "Refusing to repair the managed Gateway service because the current invocation targets a different Gateway:",
          '- BRANCH_STATE_DIR: installed="/home/branch/.branch", ambient="/home/branch/stress-state"',
          '- BRANCH_CONFIG_PATH: installed="/home/branch/.branch/branch.json", ambient="/home/branch/stress-state/branch.json"',
          '- gateway.port: installed="18789", ambient="18999"',
          `Run \`branch gateway ${action}\` with the installed state directory, config path, and port (or unset conflicting environment overrides). To retarget intentionally, run \`branch gateway install --force\`.`,
        ].join("\n"),
      );

      expect(unit).toBe(originalUnit);
      expect(installMock).not.toHaveBeenCalled();
      expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
      expect(resolveGatewayInstallTokenMock).not.toHaveBeenCalled();
    },
  );

  it("refuses a port-less stale service repair when ambient port overrides its config port", async () => {
    vi.stubEnv("BRANCH_GATEWAY_PORT", "18999");
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: {
        exists: true,
        valid: true,
        sourceConfig: { gateway: { port: 18_789 } },
        config: { gateway: { port: 18_789 } },
      },
      writeOptions: { expectedConfigPath: "/home/branch/.branch/branch.json" },
    });
    const installMock = vi.fn(async () => {});
    const service = {
      install: installMock,
      isLoaded: vi.fn(async () => true),
    };
    const state = stoppedServiceState({
      programArguments: ["/usr/bin/branch", "gateway"],
      environment: { HOME: "/home/branch" },
    });

    await expect(
      repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "port-mismatch", message: "old port" }],
        json: true,
        stdout: process.stdout,
      }),
    ).rejects.toThrow('- gateway.port: installed="18789", ambient="18999"');

    expect(installMock).not.toHaveBeenCalled();
    expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
  });

  it("resolves installed host-and-port environment syntax before comparing repair targets", async () => {
    const installMock = vi.fn(async () => {});
    const service = {
      install: installMock,
      isLoaded: vi.fn(async () => true),
    };
    const state = stoppedServiceState({
      programArguments: ["/usr/bin/branch", "gateway"],
      environment: {
        HOME: "/home/branch",
        BRANCH_GATEWAY_PORT: "127.0.0.1:19000",
      },
    });

    await expect(
      repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "port-mismatch", message: "old port" }],
        json: true,
        stdout: process.stdout,
      }),
    ).rejects.toThrow('- gateway.port: installed="19000", ambient="18789"');

    expect(installMock).not.toHaveBeenCalled();
    expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
  });

  it("refuses repair when a legacy service does not identify its installed state directory", async () => {
    vi.stubEnv("HOME", "/home/ambient-user");
    const installMock = vi.fn(async () => {});
    const service = {
      install: installMock,
      isLoaded: vi.fn(async () => true),
    };
    const state = stoppedServiceState({
      programArguments: ["/usr/bin/branch", "gateway", "--port", "18789"],
      environment: { BRANCH_GATEWAY_PORT: "18789" },
    });

    await expect(
      repairLoadedGatewayServiceForStart({
        service,
        state,
        issues: [{ code: "missing-program", message: "missing program" }],
        json: true,
        stdout: process.stdout,
      }),
    ).rejects.toThrow("installed state directory cannot be determined");

    expect(installMock).not.toHaveBeenCalled();
    expect(buildGatewayInstallPlanMock).not.toHaveBeenCalled();
  });

  it.each([
    { action: "start", probe: "throws" },
    { action: "restart", probe: "returns false" },
  ] as const)(
    "fails $action repair when the post-install probe $probe",
    async ({ action, probe }) => {
      const error = new Error("systemd show failed");
      const service = {
        install: vi.fn(async () => {}),
        isLoaded: vi.fn(async () => {
          if (probe === "throws") {
            throw error;
          }
          return false;
        }),
      };
      const state = stoppedServiceState({
        programArguments: ["/usr/bin/branch", "gateway", "run"],
        environment: { HOME: "/home/branch" },
      });
      const params = {
        service,
        state,
        issues: [{ code: "port-mismatch" as const, message: "old port" }],
        json: true,
        stdout: process.stdout,
      };
      const repair =
        action === "restart"
          ? repairLoadedGatewayServiceForStart({ ...params, action })
          : repairLoadedGatewayServiceForStart(params);

      if (probe === "throws") {
        await expect(repair).rejects.toBe(error);
      } else {
        await expect(repair).rejects.toThrow("Gateway service is not loaded after repair.");
      }
      expect(service.install).toHaveBeenCalledTimes(1);
    },
  );
});
