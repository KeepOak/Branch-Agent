import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { ExitError } from "../../runtime.js";
import { withExistingBranchStateSchema } from "../../state/branch-state-db-schema-policy.js";
import { ensureConfigReady, testApi } from "./config-guard.js";

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(),
  prepareStartup: vi.fn(),
  setRuntimeConfig: vi.fn(),
  offerRecovery: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  readConfigFileSnapshot: mocks.readConfig,
  setRuntimeConfigSnapshot: mocks.setRuntimeConfig,
}));
vi.mock("../../commands/startup-config-preflight.js", () => ({
  runStartupConfigPreflight: mocks.prepareStartup,
}));
vi.mock("../invalid-config-recovery.js", () => ({
  offerInvalidConfigRecovery: mocks.offerRecovery,
}));

const temporary = useAutoCleanupTempDirTracker(afterEach);
let statePath: string;
const config = { plugins: { entries: { fixture: { enabled: true } } } };

function snapshot(valid = true) {
  return {
    path: path.join(path.dirname(path.dirname(statePath)), "branch.json"),
    exists: true,
    valid,
    raw: JSON.stringify(config),
    parsed: config,
    config,
    runtimeConfig: config,
    sourceConfig: config,
    issues: valid
      ? []
      : [{ path: "plugins.entries.fixture.config", message: "invalid plugin value" }],
    warnings: [],
    legacyIssues: [],
  };
}

function runtime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((code: number): never => {
      throw new ExitError(code);
    }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  testApi.resetConfigGuardStateForTests();
  const stateDir = temporary.make("managed-node-config-guard-");
  vi.stubEnv("BRANCH_STATE_DIR", stateDir);
  vi.stubEnv("BRANCH_NIX_MODE", undefined);
  vi.stubEnv("BRANCH_CONFIG_READONLY", undefined);
  statePath = path.join(stateDir, "state", "branch.sqlite");
  mocks.readConfig.mockImplementation(async () => snapshot());
  mocks.prepareStartup.mockImplementation(async () => ({
    snapshot: snapshot(),
    baseConfig: config,
  }));
});

afterEach(() => vi.unstubAllEnvs());

describe("managed node startup config", () => {
  it.each([["node", "run"], ["connect"]])(
    "validates %j without Doctor convergence or config health writes",
    async (...commandPath) => {
      const host = runtime();
      await withExistingBranchStateSchema({ path: statePath }, async () => {
        await ensureConfigReady({ runtime: host, commandPath });
      });

      expect(mocks.prepareStartup).not.toHaveBeenCalled();
      expect(mocks.readConfig).toHaveBeenCalledWith({ observe: false });
      expect(mocks.setRuntimeConfig).toHaveBeenCalledWith(config, config);
      expect(host.exit).not.toHaveBeenCalled();
    },
  );

  it("checks ordinary node readiness outside the managed scope", async () => {
    await ensureConfigReady({ runtime: runtime(), commandPath: ["node", "run"] });
    expect(mocks.prepareStartup).toHaveBeenCalledWith({ gateway: false });
  });

  it("rejects invalid plugin configuration without offering to repair shared state", async () => {
    mocks.readConfig.mockResolvedValue(snapshot(false));
    const host = runtime();
    await expect(
      withExistingBranchStateSchema({ path: statePath }, async () => {
        await ensureConfigReady({ runtime: host, commandPath: ["node", "run"] });
      }),
    ).rejects.toMatchObject({ name: "ExitError", code: 1 });

    expect(mocks.readConfig).toHaveBeenCalledWith({ observe: false });
    expect(mocks.prepareStartup).not.toHaveBeenCalled();
    expect(mocks.offerRecovery).not.toHaveBeenCalled();
    expect(mocks.setRuntimeConfig).not.toHaveBeenCalled();
    expect(host.error.mock.calls.join("\n")).toContain("invalid plugin value");
  });

  it("rejects changed state selectors before config or migration work", async () => {
    const otherDir = temporary.make("other-managed-node-state-");
    await expect(
      withExistingBranchStateSchema({ path: statePath }, async () => {
        vi.stubEnv("BRANCH_STATE_DIR", otherDir);
        await ensureConfigReady({ runtime: runtime(), commandPath: ["node", "run"] });
      }),
    ).rejects.toThrow(/state.*(?:bound|changed)/i);

    expect(mocks.readConfig).not.toHaveBeenCalled();
    expect(mocks.prepareStartup).not.toHaveBeenCalled();
  });
});
