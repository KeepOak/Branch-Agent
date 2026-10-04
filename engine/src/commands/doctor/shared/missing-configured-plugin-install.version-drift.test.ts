import fs from "node:fs";
import path from "node:path";
import { expectDefined } from "@branch/normalization-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../../config/types.js";
import type { PluginInstallRecord } from "../../../config/types.plugins.js";
import { parseRegistryNpmSpec } from "../../../infra/npm-registry-spec.js";
import { readPersistedInstalledPluginIndexInstallRecords } from "../../../plugins/installed-plugin-index-records.js";
import { createPluginMetadataSnapshotFixture } from "../../../plugins/plugin-metadata.test-support.js";
import { detectPluginVersionDrift } from "../../../plugins/plugin-version-drift.js";
import { invokePluginArtifactInstallMock } from "../../../plugins/test-helpers/install-fixtures.js";
import { convergePluginReleaseCohort } from "../../../plugins/update-cohort.js";
import { repairMissingConfiguredPluginInstalls } from "./missing-configured-plugin-install.js";
import {
  setupPluginInstallTestState,
  successfulInstall,
} from "./missing-configured-plugin-install.test-helpers.js";

const mocks = vi.hoisted(() => ({
  installPluginFromNpmSpec: vi.fn(),
  resolveNpmSpecMetadata: vi.fn(),
  loadManifestMetadataSnapshot: vi.fn(),
}));

vi.mock("../../../infra/install-source-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/install-source-utils.js")>()),
  resolveNpmSpecMetadata: mocks.resolveNpmSpecMetadata,
}));
vi.mock("../../../plugins/install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../plugins/install.js")>();
  return {
    ...actual,
    installPluginFromNpmSpec: (params: Parameters<typeof actual.installPluginFromNpmSpec>[0]) =>
      invokePluginArtifactInstallMock<Awaited<ReturnType<typeof actual.installPluginFromNpmSpec>>>(
        mocks.installPluginFromNpmSpec,
        params,
        { manifest: { providers: [], channels: [], channelConfigs: {}, providerAuthChoices: [] } },
      ),
  };
});
vi.mock("../../../plugins/manifest-contract-eligibility.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/manifest-contract-eligibility.js")>()),
  loadManifestMetadataSnapshot: mocks.loadManifestMetadataSnapshot,
}));
vi.mock("../../../plugins/bundled-sources.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/bundled-sources.js")>()),
  resolveBundledPluginSources: () => new Map(),
}));
vi.mock("../../../plugins/update-capability-consent.js", () => ({
  // The lower installer is stubbed; its staged artifact consent has separate owner tests.
  preparePluginUpdateCapabilityConsent: () => ({
    onBeforePluginArtifactCommit: async () => {},
    acceptInstallRecord: <T extends PluginInstallRecord>(record: T): T => record,
  }),
}));

const { testEnv, tempDirs } = setupPluginInstallTestState();
const oldVersion = "2026.9.3";
const coreVersion = "2026.9.5";

function createDriftedInstalls({
  hostVersion = coreVersion,
  installedVersion = oldVersion,
  dependencies,
  packages = [
    ["discord", "@branch/discord"],
    ["exa", "@branch/exa-plugin"],
    ["community", "@example/community"],
  ],
}: {
  hostVersion?: string;
  installedVersion?: string;
  dependencies?: Record<string, string>;
  packages?: [string, string][];
} = {}) {
  const stateDir = tempDirs.make("branch-doctor-plugin-version-drift-");
  const env = {
    ...testEnv,
    BRANCH_STATE_DIR: stateDir,
    BRANCH_COMPATIBILITY_HOST_VERSION: hostVersion,
  };
  const records: Record<string, PluginInstallRecord> = {};
  for (const [pluginId, packageName] of packages) {
    const installPath = path.join(stateDir, "extensions", pluginId);
    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(
      path.join(installPath, "package.json"),
      JSON.stringify({
        name: packageName,
        version: installedVersion,
        dependencies,
        branch: { extensions: ["./index.js"] },
      }),
    );
    fs.writeFileSync(path.join(installPath, "index.js"), "export default function register() {}\n");
    fs.writeFileSync(
      path.join(installPath, "branch.plugin.json"),
      JSON.stringify({ id: pluginId, configSchema: { type: "object" } }),
    );
    records[pluginId] = {
      source: "npm",
      spec: `${packageName}@${installedVersion}`,
      resolvedName: packageName,
      resolvedSpec: `${packageName}@${installedVersion}`,
      version: installedVersion,
      resolvedVersion: installedVersion,
      installPath,
    };
  }
  const cfg: BranchConfig = {
    update: { channel: hostVersion.includes("-beta.") ? "beta" : "stable" },
    plugins: {
      allow: Object.keys(records),
      entries: Object.fromEntries(Object.keys(records).map((id) => [id, { enabled: true }])),
    },
  };
  mocks.loadManifestMetadataSnapshot.mockReturnValue(
    createPluginMetadataSnapshotFixture({
      plugins: Object.entries(records).map(([id, record]) => ({
        id,
        origin: "global",
        rootDir: record.installPath,
        packageName: record.resolvedName,
        packageVersion: installedVersion,
        packageDependencies: dependencies,
      })),
    }),
  );
  mocks.installPluginFromNpmSpec.mockImplementation(
    async ({ spec, expectedPluginId }: { spec: string; expectedPluginId: string }) => {
      const parsed = parseRegistryNpmSpec(spec);
      if (!parsed) {
        throw new Error(`Invalid plugin target: ${spec}`);
      }
      const version = parsed.selectorKind === "exact-version" ? parsed.selector : "2026.9.6";
      const targetDir = expectDefined(
        records[expectedPluginId],
        "installed plugin fixture",
      ).installPath;
      const manifestPath = path.join(expectDefined(targetDir, "fixture path"), "package.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          name: parsed.name,
          version,
          dependencies,
          branch: { extensions: ["./index.js"] },
        }),
      );
      return successfulInstall({
        pluginId: expectedPluginId,
        npmSpec: parsed.name,
        version,
        targetDir,
      });
    },
  );
  return {
    cfg,
    env,
    records,
    repair: async (
      options: Partial<Parameters<typeof repairMissingConfiguredPluginInstalls>[0]> = {},
    ) => {
      const result = await repairMissingConfiguredPluginInstalls({
        cfg,
        env,
        baselineRecords: records,
        repairVersionDrift: true,
        ...options,
      });
      expect(readPersistedInstalledPluginIndexInstallRecords({ env })).toEqual(result.records);
      return result;
    },
  };
}

function driftIds(
  cfg: BranchConfig,
  records: Record<string, PluginInstallRecord>,
  hostVersion = coreVersion,
) {
  return detectPluginVersionDrift({
    config: cfg,
    gatewayVersion: hostVersion,
    installRecords: records,
  }).drifts.map(({ pluginId }) => pluginId);
}

describe("Doctor official plugin version repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveNpmSpecMetadata.mockImplementation(async ({ spec }: { spec: string }) => {
      const parsed = parseRegistryNpmSpec(spec);
      if (!parsed) {
        throw new Error(`Invalid package spec: ${spec}`);
      }
      const version = parsed.selectorKind === "exact-version" ? parsed.selector : "2026.9.6";
      return {
        ok: true,
        metadata: { name: parsed.name, version, resolvedSpec: `${parsed.name}@${version}` },
      };
    });
  });

  it.each([
    ["Doctor repair", "next", oldVersion, coreVersion, "2026.9.6"],
    ["Doctor repair", "2026.9.6", "2026.9.6", coreVersion, "2026.9.6"],
    ["Doctor repair", "2026.9.5-1", oldVersion, "2026.9.5-2", "2026.9.5-1"],
    ["core-update convergence", "next", oldVersion, coreVersion, "2026.9.6"],
  ])(
    "%s honors @%s over the cohort with installed %s and core %s",
    async (caller, selector, installedVersion, hostVersion, expectedVersion) => {
      const { cfg, env, records, repair } = createDriftedInstalls({
        hostVersion,
        installedVersion,
        packages: [["discord", "@branch/discord"]],
      });
      const spec = `@branch/discord@${selector}`;
      const record = expectDefined(records.discord, "discord install");
      record.spec = spec;
      const updatedRecords =
        caller === "Doctor repair"
          ? (await repair()).records
          : (
              await convergePluginReleaseCohort({
                config: { ...cfg, plugins: { ...cfg.plugins, installs: records } },
                env,
                channel: "stable",
                coreVersion: hostVersion,
                timeoutMs: 60_000,
              })
            ).config.plugins?.installs;

      expect(mocks.resolveNpmSpecMetadata.mock.calls[0]?.[0].spec).toBe(spec);
      expect(updatedRecords?.discord).toMatchObject({
        spec,
        version: expectedVersion,
        resolvedVersion: expectedVersion,
        resolvedSpec: `@branch/discord@${expectedVersion}`,
      });
    },
  );

  it.each([
    ["@branch/discord@2026.9.6", coreVersion, "2026.9.6", "2026.9.6", "stable"],
    ["@branch/codex@latest", coreVersion, coreVersion, coreVersion, "stable"],
    ["@branch/codex@latest", coreVersion, "2026.9.6", "2026.9.6", "stable"],
    ["@branch/codex@latest", "2026.9.5-beta.2", "2026.9.5-beta.2", "2026.9.6", "beta"],
    ["@branch/codex", coreVersion, oldVersion, coreVersion, "stable"],
    ["@branch/codex@latest", "2026.9.5-beta.2", "2026.9.6", "2026.9.6", "beta"],
    ["@branch/codex@latest", coreVersion, "2026.9.6", coreVersion, "extended-stable"],
    ["@branch/codex@next", coreVersion, "2026.9.6", "2026.9.6", "extended-stable"],
    ["@branch/codex@latest", "2026.9.5-1", "2026.9.5-2", coreVersion, "stable"],
  ] as const)(
    "repairs incomplete %s at host %s from record %s to %s on %s",
    async (spec, hostVersion, installedVersion, expectedVersion, channel) => {
      const missingDependencies = spec.startsWith("@branch/discord");
      const pluginId = missingDependencies ? "discord" : "codex";
      const packageName = `@branch/${pluginId}`;
      const { cfg, records, repair } = createDriftedInstalls({
        hostVersion,
        installedVersion,
        dependencies: missingDependencies ? { "required-runtime": "1.0.0" } : undefined,
        packages: [[pluginId, packageName]],
      });
      cfg.update = { channel };
      const record = expectDefined(records[pluginId], "plugin install");
      record.spec = spec;
      const manifestPath = path.join(
        expectDefined(record.installPath, "fixture path"),
        "package.json",
      );
      if (!missingDependencies) {
        fs.unlinkSync(manifestPath);
      }
      const result = await repair(
        missingDependencies
          ? {}
          : { onCapabilityConsent: async ({ reviewToken }) => ({ reviewToken }) },
      );
      expect(result.records[pluginId]).toMatchObject({
        spec,
        version: expectedVersion,
        resolvedVersion: expectedVersion,
        resolvedSpec: `${packageName}@${expectedVersion}`,
      });
      expect(result.repairedPluginIds).toEqual([pluginId]);
      expect(result.warnings).toEqual([]);
      if (missingDependencies) {
        expect(mocks.installPluginFromNpmSpec.mock.calls.map(([request]) => request.spec)).toEqual([
          spec,
        ]);
        expect(result.changes).toEqual([
          'Repaired missing dependencies for installed plugin "discord".',
          "If the Gateway is not restarted by Doctor, run branch gateway restart to load the updated plugins.",
        ]);
      }
    },
  );

  it.each([coreVersion])(
    "keeps aligned floating official installs unchanged at core %s when the registry is ahead",
    async (hostVersion) => {
      const { cfg, env, records } = createDriftedInstalls({
        hostVersion,
        installedVersion: hostVersion,
        packages: [
          ["discord", "@branch/discord"],
          ["exa", "@branch/exa-plugin"],
        ],
      });
      expectDefined(records.discord, "discord install").spec = "@branch/discord";
      expectDefined(records.exa, "exa install").spec = "@branch/exa-plugin@latest";
      const config = { ...cfg, plugins: { ...cfg.plugins, installs: records } };

      const result = await convergePluginReleaseCohort({
        config,
        env,
        channel: hostVersion.includes("-beta.") ? "beta" : "stable",
        coreVersion: hostVersion,
        timeoutMs: 60_000,
      });

      expect(mocks.resolveNpmSpecMetadata.mock.calls.map(([request]) => request.spec)).toEqual([
        `@branch/discord@${hostVersion}`,
        `@branch/exa-plugin@${hostVersion}`,
      ]);
      expect(mocks.installPluginFromNpmSpec).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
      expect(result.npmChanged).toBe(false);
      expect(result.config).toEqual(config);
      expect(result.updateOutcomes).toMatchObject([
        { pluginId: "discord", status: "unchanged", currentVersion: hostVersion },
        { pluginId: "exa", status: "unchanged", currentVersion: hostVersion },
      ]);
    },
  );

  it.each(["2026.9.5-beta.2"])(
    "converges official installs to core %s and leaves third-party installs untouched",
    async (hostVersion) => {
      const { cfg, records, repair } = createDriftedInstalls({ hostVersion });
      expect(driftIds(cfg, records)).toEqual(["discord", "exa"]);

      const result = await repair();

      expect(result.repairedPluginIds).toEqual(["discord", "exa"]);
      expect(result.warnings).toEqual([]);
      expect(result.records.discord).toMatchObject({
        version: hostVersion,
        resolvedVersion: hostVersion,
      });
      expect(result.records.exa).toMatchObject({
        version: hostVersion,
        resolvedVersion: hostVersion,
      });
      expect(result.records.community).toEqual(records.community);
      expect(mocks.installPluginFromNpmSpec.mock.calls.map(([request]) => request.spec)).toEqual([
        `@branch/discord@${hostVersion}`,
        `@branch/exa-plugin@${hostVersion}`,
      ]);
      expect(driftIds(cfg, result.records, hostVersion)).toEqual([]);
    },
  );

  it("warns with the unavailable target reason, retains its install, and repairs the other official plugin", async () => {
    const { cfg, records, repair } = createDriftedInstalls();
    const resolveMetadata = expectDefined(
      mocks.resolveNpmSpecMetadata.getMockImplementation(),
      "metadata resolver",
    );
    mocks.resolveNpmSpecMetadata.mockImplementation((request: { spec: string }) =>
      request.spec.startsWith("@branch/discord")
        ? Promise.resolve({
            ok: false,
            category: "metadata-env",
            error: "ECONNREFUSED registry unreachable",
          })
        : resolveMetadata(request),
    );
    const onWarning = vi.fn();

    const result = await repair({ onWarning });

    expect(result.repairedPluginIds).toEqual(["exa"]);
    expect(result.records.discord).toEqual(records.discord);
    expect(result.records.community).toEqual(records.community);
    expect(result.warnings.join("\n")).toContain("ECONNREFUSED registry unreachable");
    expect(result.warnings.join("\n")).toContain("@branch/discord@2026.9.5");
    expect(onWarning).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("ECONNREFUSED") }),
    );
    expect(mocks.installPluginFromNpmSpec.mock.calls.map(([request]) => request.spec)).toEqual([
      "@branch/exa-plugin@2026.9.5",
    ]);
    expect(driftIds(cfg, result.records)).toEqual(["discord"]);
  });

  it.each(["not opted in", "core swap", "legacy id"])("retains installs for %s", async (reason) => {
    const { env, records, repair } = createDriftedInstalls(
      reason === "legacy id" ? { packages: [["fish-audio", "@branch/fish-audio-speech"]] } : {},
    );

    const result = await repair({
      repairVersionDrift: reason === "not opted in" ? undefined : true,
      env:
        reason === "core swap"
          ? {
              ...env,
              BRANCH_UPDATE_IN_PROGRESS: "1",
              BRANCH_UPDATE_DEFER_CONFIGURED_PLUGIN_INSTALL_REPAIR: "1",
            }
          : env,
    });

    expect(result.records).toEqual(records);
    expect(result.warnings).toEqual(
      reason === "legacy id"
        ? [expect.stringContaining("branch plugins update @branch/fish-audio-speech@2026.9.5")]
        : [],
    );
    expect(mocks.installPluginFromNpmSpec).not.toHaveBeenCalled();
    if (reason !== "legacy id") {
      expect(mocks.resolveNpmSpecMetadata).not.toHaveBeenCalled();
    }
    if (reason === "not opted in") {
      expect(result.changes).toEqual([]);
    } else if (reason === "core swap") {
      expect(result.repairedPluginIds ?? []).toEqual([]);
    }
  });
});
