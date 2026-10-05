import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expectDefined } from "@branch/normalization-core";
import { bundledPluginRootAt } from "branch/plugin-sdk/test-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/config.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import type { SpawnResult } from "../process/exec.js";
import { withEnvAsync } from "../test-utils/env.js";
import { npmCommandArgs } from "../test-utils/npm-command.js";
import { resolvePluginArtifactDeclaredSurface } from "./capability-artifact.js";
import { computeDeclaredSurfaceHash } from "./capability-summary.js";
import { resolvePluginInstallOwnerMigrations } from "./install-transaction.js";
import { makeTrackedTempDir } from "./test-helpers/fs-fixtures.js";

const APP_ROOT = "/app";

type NpmInstallIntegrityDrift = {
  spec: string;
  expectedIntegrity: string;
  actualIntegrity: string;
  resolution: {
    integrity?: string;
    resolvedSpec?: string;
    version?: string;
  };
};

const appBundledPluginRoot = (pluginId: string) => bundledPluginRootAt(APP_ROOT, pluginId);

const installPluginFromNpmSpecMock = vi.fn();
const installPluginFromMarketplaceMock = vi.fn();
const installPluginFromClawHubMock = vi.fn();
const fetchClawHubPackageDetailMock = vi.fn();
const installPluginFromGitSpecMock = vi.fn();
const resolveBundledPluginSourcesMock = vi.fn();
const runCommandWithTimeoutMock = vi.fn();
const failedNpmVersionQueryResult: SpawnResult = {
  code: 1,
  stdout: "",
  stderr: "npm version query failed",
  signal: null,
  killed: false,
  termination: "exit",
};
const validatePackageExtensionEntriesForInstallMock = vi.fn();
const markClawPackageIndependentlyOwnedMock = vi.fn();
const withClawPackageLifecycleLeaseMock = vi.fn(
  async (_artifact: unknown, operation: () => Promise<unknown>, _options?: unknown) =>
    await operation(),
);
const tempDirs: string[] = [];
const capabilityConsentMode = vi.hoisted(() => ({ real: false }));

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

vi.mock("./capability-consent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./capability-consent.js")>();
  return {
    ...actual,
    // Channel routing fixtures stub installers; update-channel.consent.test.ts owns staged proof.
    prepareManagedPluginArtifactConsentHandler: async () => ({
      onBeforePluginArtifactCommit: async () => {},
      applyAcceptedSurface: <T extends PluginInstallRecord>(_pluginId: string, record: T): T =>
        record,
    }),
  };
});

vi.mock("./update-capability-consent.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./update-capability-consent.js")>();
  return {
    preparePluginUpdateCapabilityConsent: (
      params: Parameters<typeof actual.preparePluginUpdateCapabilityConsent>[0],
    ) => {
      // Routing fixtures stub installers; capability cases below exercise the real staged owner.
      if (capabilityConsentMode.real) {
        return actual.preparePluginUpdateCapabilityConsent(params);
      }
      return {
        onBeforePluginArtifactCommit: async () => {},
        acceptInstallRecord: <T extends PluginInstallRecord>(record: T): T => record,
      };
    },
  };
});

vi.mock("./install.js", () => ({
  installPluginFromNpmSpec: (...args: unknown[]) => installPluginFromNpmSpecMock(...args),
  resolvePluginInstallDir: (pluginId: string, extensionsDir = "/tmp") => {
    const separator = process.platform === "win32" ? "\\" : "/";
    return `${extensionsDir.replace(/[\\/]+$/, "")}${separator}${pluginId}`;
  },
  PLUGIN_INSTALL_ERROR_CODE: {
    NPM_METADATA_FAILURE: "npm_metadata_failure",
    NPM_PACKAGE_NOT_FOUND: "npm_package_not_found",
  },
}));

vi.mock("./git-install.js", () => ({
  installPluginFromGitSpec: (...args: unknown[]) => installPluginFromGitSpecMock(...args),
}));

vi.mock("./marketplace.js", () => ({
  installPluginFromMarketplace: (...args: unknown[]) => installPluginFromMarketplaceMock(...args),
}));

vi.mock("./clawhub.js", () => ({
  CLAWHUB_INSTALL_ERROR_CODE: {
    PACKAGE_NOT_FOUND: "package_not_found",
    VERSION_NOT_FOUND: "version_not_found",
    ARTIFACT_UNAVAILABLE: "artifact_unavailable",
    ARCHIVE_INTEGRITY_MISMATCH: "archive_integrity_mismatch",
    ARTIFACT_DOWNLOAD_UNAVAILABLE: "artifact_download_unavailable",
    CLAWHUB_SECURITY_UNAVAILABLE: "clawhub_security_unavailable",
    CLAWHUB_DOWNLOAD_BLOCKED: "clawhub_download_blocked",
  },
  installPluginFromClawHub: (...args: unknown[]) => installPluginFromClawHubMock(...args),
}));

vi.mock("../infra/clawhub-packages.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/clawhub-packages.js")>();
  return {
    ...actual,
    fetchClawHubPackageDetail: (...args: unknown[]) => fetchClawHubPackageDetailMock(...args),
  };
});

vi.mock("../state/grove-package-adoption.js", () => ({
  markClawPackageIndependentlyOwned: (...args: unknown[]) =>
    markClawPackageIndependentlyOwnedMock(...args),
}));

vi.mock("../state/grove-package-lifecycle-lease.js", () => ({
  withClawPackageLifecycleLease: (
    artifact: unknown,
    operation: () => Promise<unknown>,
    options?: unknown,
  ) => withClawPackageLifecycleLeaseMock(artifact, operation, options),
}));

vi.mock("./bundled-sources.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bundled-sources.js")>()),
  resolveBundledPluginSources: (...args: unknown[]) => resolveBundledPluginSourcesMock(...args),
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

vi.mock("./package-entry-resolution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./package-entry-resolution.js")>();
  return {
    ...actual,
    validatePackageExtensionEntriesForInstall: async (
      ...args: Parameters<typeof actual.validatePackageExtensionEntriesForInstall>
    ) => {
      validatePackageExtensionEntriesForInstallMock(...args);
      return await actual.validatePackageExtensionEntriesForInstall(...args);
    },
  };
});

const { syncPluginsForUpdateChannel, updateNpmInstalledPlugins } = await import("./update.js");

function createSuccessfulNpmUpdateResult(params?: {
  pluginId?: string;
  targetDir?: string;
  version?: string;
  packageName?: string;
  resolvedSpec?: string;
}) {
  const version = params?.version ?? "0.2.6";
  return {
    ok: true,
    pluginId: params?.pluginId ?? "opik-branch",
    targetDir: params?.targetDir ?? "/tmp/opik-branch",
    version,
    extensions: ["index.ts"],
    ...(params?.packageName
      ? {
          npmResolution: {
            name: params.packageName,
            version,
            resolvedSpec: params.resolvedSpec ?? `${params.packageName}@${version}`,
          },
        }
      : {}),
  };
}

function mockSuccessfulNpmUpdate(params: Parameters<typeof createSuccessfulNpmUpdateResult>[0]) {
  installPluginFromNpmSpecMock.mockResolvedValue(createSuccessfulNpmUpdateResult(params));
}

function createSuccessfulClawHubUpdateResult(params?: {
  pluginId?: string;
  targetDir?: string;
  version?: string;
  clawhubPackage?: string;
}) {
  return {
    ok: true,
    pluginId: params?.pluginId ?? "legacy-chat",
    targetDir: params?.targetDir ?? "/tmp/branch-plugins/legacy-chat",
    version: params?.version ?? "2026.5.1-beta.2",
    extensions: ["index.ts"],
    packageName: params?.clawhubPackage ?? "legacy-chat",
    clawhub: {
      source: "clawhub" as const,
      clawhubUrl: "https://clawhub.ai",
      clawhubPackage: params?.clawhubPackage ?? "legacy-chat",
      clawhubFamily: "code-plugin" as const,
      clawhubChannel: "official" as const,
      version: params?.version ?? "2026.5.1-beta.2",
      integrity: "sha256-clawpack",
      resolvedAt: "2026-05-01T00:00:00.000Z",
      artifactKind: "npm-pack" as const,
      artifactFormat: "tgz" as const,
      npmIntegrity: "sha512-clawpack",
      npmShasum: "2".repeat(40),
      npmTarballName: `${params?.clawhubPackage ?? "legacy-chat"}-${params?.version ?? "2026.5.1-beta.2"}.tgz`,
      clawpackSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      clawpackSpecVersion: 1,
      clawpackManifestSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      clawpackSize: 4096,
    },
  };
}

function pluginConfig(
  installs: Record<string, PluginInstallRecord>,
  plugins: Omit<NonNullable<BranchConfig["plugins"]>, "installs"> = {},
): BranchConfig {
  return { plugins: { ...plugins, installs } };
}

function createNpmInstallConfig(
  pluginId: string,
  spec: string,
  installPath: string,
  record: Omit<PluginInstallRecord, "source" | "spec" | "installPath"> = {},
): BranchConfig {
  return pluginConfig({ [pluginId]: { source: "npm", spec, installPath, ...record } });
}

function resolvedNpmInstall(
  name: string,
  version: string,
  record: PluginInstallRecord,
): PluginInstallRecord {
  return {
    ...record,
    resolvedName: name,
    resolvedVersion: version,
    resolvedSpec: `${name}@${version}`,
  };
}

function createClawHubInstallConfig(
  params: {
    pluginId?: string;
    installPath?: string;
    clawhubUrl?: string;
    clawhubPackage?: string;
    clawhubFamily?: "bundle-plugin" | "code-plugin";
    clawhubChannel?: "community" | "official" | "private";
    spec?: string;
  } = {},
): BranchConfig {
  const pluginId = params.pluginId ?? "demo";
  const clawhubPackage = params.clawhubPackage ?? pluginId;
  return pluginConfig({
    [pluginId]: {
      source: "clawhub" as const,
      spec: params.spec ?? `clawhub:${clawhubPackage}`,
      installPath: params.installPath ?? `/tmp/${pluginId}`,
      clawhubUrl: params.clawhubUrl ?? "https://clawhub.ai",
      clawhubPackage,
      clawhubFamily: params.clawhubFamily ?? "code-plugin",
      clawhubChannel: params.clawhubChannel ?? "official",
    },
  });
}

function createEnabledDemoClawHubInstallConfig(): BranchConfig {
  const installPath = createInstalledPackageDir("demo", "1.2.3");
  const config = createClawHubInstallConfig({ installPath });
  config.plugins = {
    ...config.plugins,
    entries: {
      demo: {
        enabled: true,
        config: { preserved: true },
      },
    },
    allow: ["demo"],
    slots: {
      memory: "demo",
    },
  };
  return config;
}

function writeJson(filePath: string, value: Record<string, unknown>, space?: number) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, space));
}

function createInstalledPackageDir(
  name: string | undefined,
  version: string,
  params: {
    peerDependencies?: Record<string, string>;
    runnable?: boolean;
    installPath?: string;
  } = {},
): string {
  const dir =
    params.installPath ?? fs.mkdtempSync(path.join(os.tmpdir(), "branch-plugin-update-test-"));
  if (params.installPath) {
    fs.mkdirSync(dir, { recursive: true });
  } else {
    tempDirs.push(dir);
  }
  writeJson(
    path.join(dir, "package.json"),
    {
      name: name ?? "test-plugin",
      version,
      ...(params.peerDependencies ? { peerDependencies: params.peerDependencies } : {}),
      ...(params.runnable ? { branch: { extensions: ["./index.js"] } } : {}),
    },
    2,
  );
  if (params.runnable) {
    fs.writeFileSync(path.join(dir, "index.js"), "export default function register() {}\n");
  }
  return dir;
}

function createCapabilityConsentPackage(params: {
  pluginId: string;
  version: string;
  childProviders: string[];
}): string {
  const packageName = `@acme/${params.pluginId}`;
  const rootDir = createInstalledPackageDir(packageName, params.version);
  const childDir = path.join(rootDir, "children", "addon");
  fs.mkdirSync(childDir, { recursive: true });
  writeJson(path.join(rootDir, "package.json"), {
    name: packageName,
    version: params.version,
    branch: { extensions: ["./index.js", "./children/addon/addon.js"] },
  });
  fs.writeFileSync(path.join(rootDir, "index.js"), "export default () => {};\n");
  fs.writeFileSync(path.join(childDir, "addon.js"), "export default () => {};\n");
  writeJson(path.join(rootDir, "branch.plugin.json"), {
    id: params.pluginId,
    name: "Consent fixture",
    version: params.version,
    providers: ["root-provider"],
    configSchema: { type: "object" },
  });
  writeJson(path.join(childDir, "branch.plugin.json"), {
    id: `${params.pluginId}-addon`,
    providers: params.childProviders,
    configSchema: { type: "object" },
  });
  return rootDir;
}

function createBranchPeerLinkFixtures(plugins: Array<{ pluginId: string; packageName: string }>) {
  const stateDir = makeTrackedTempDir("branch-plugin-update-owner", tempDirs);
  const peerTarget = fs.realpathSync(process.cwd());
  const installPaths = Object.fromEntries(
    plugins.map(({ pluginId, packageName }) => [
      pluginId,
      createInstalledPackageDir(packageName, "2026.5.4", {
        peerDependencies: { branch: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", pluginId),
      }),
    ]),
  );
  const peerLinkPath = (pluginId: string) =>
    path.join(
      expectDefined(installPaths[pluginId], "installPaths[pluginId] test invariant"),
      "node_modules",
      "branch",
    );
  const linkPeer = (pluginId: string) => {
    fs.mkdirSync(path.dirname(peerLinkPath(pluginId)), { recursive: true });
    fs.symlinkSync(peerTarget, peerLinkPath(pluginId), "junction");
  };
  return { stateDir, installPaths, peerLinkPath, linkPeer };
}

function createPeerLinkInstallConfig(params: {
  plugins: Array<{ pluginId: string; packageName: string }>;
  installPaths: Record<string, string>;
  extraInstalls?: Record<string, PluginInstallRecord>;
}): BranchConfig {
  return pluginConfig({
    ...params.extraInstalls,
    ...Object.fromEntries(
      params.plugins.map(({ pluginId, packageName }) => [
        pluginId,
        resolvedNpmInstall(packageName, "2026.5.4", {
          source: "npm",
          spec: packageName,
          installPath: params.installPaths[pluginId],
          integrity: "sha512-same",
          shasum: "same",
        }),
      ]),
    ),
  });
}

function mockNpmViewMetadata(params: {
  name: string;
  version: string;
  integrity?: string;
  shasum?: string;
  branch?: Record<string, unknown>;
}) {
  runCommandWithTimeoutMock.mockResolvedValueOnce({
    code: 0,
    stdout: JSON.stringify({
      name: params.name,
      version: params.version,
      "dist.integrity": params.integrity,
      "dist.shasum": params.shasum,
      branch: params.branch,
    }),
    stderr: "",
  });
}

function createNpmUpdateFixture(params: {
  pluginId: string;
  packageName: string;
  installedVersion: string;
  registryVersion?: string;
  registryIntegrity?: string;
  registryShasum?: string;
  registryBranch?: Record<string, unknown>;
  spec?: string;
  integrity?: string;
  shasum?: string;
  installerVersion?: string;
  installerResolvedSpec?: string;
}) {
  const installPath = createInstalledPackageDir(params.packageName, params.installedVersion);
  if (params.registryVersion) {
    mockNpmViewMetadata({
      name: params.packageName,
      version: params.registryVersion,
      ...(params.registryIntegrity ? { integrity: params.registryIntegrity } : {}),
      ...(params.registryShasum ? { shasum: params.registryShasum } : {}),
      ...(params.registryBranch ? { branch: params.registryBranch } : {}),
    });
  }
  if (params.installerVersion) {
    mockSuccessfulNpmUpdate({
      pluginId: params.pluginId,
      targetDir: installPath,
      version: params.installerVersion,
      ...(params.installerResolvedSpec
        ? {
            packageName: params.packageName,
            resolvedSpec: params.installerResolvedSpec,
          }
        : {}),
    });
  }
  return {
    installPath,
    config: pluginConfig({
      [params.pluginId]: resolvedNpmInstall(params.packageName, params.installedVersion, {
        source: "npm",
        spec: params.spec ?? params.packageName,
        installPath,
        ...(params.integrity ? { integrity: params.integrity } : {}),
        ...(params.shasum ? { shasum: params.shasum } : {}),
      }),
    }),
  };
}

function npmInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromNpmSpecMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function clawHubInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromClawHubMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function gitInstallCall(index = 0): Record<string, unknown> | undefined {
  const calls = installPluginFromGitSpecMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  return calls[index]?.[0];
}

function npmViewCall(): [unknown, Record<string, unknown>] | undefined {
  const calls = runCommandWithTimeoutMock.mock.calls as [unknown, Record<string, unknown>][];
  return calls.find(([argv]) => Array.isArray(argv) && npmCommandArgs(argv)?.[0] === "view");
}

function expectRecordFields(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(expected)) {
    expect(actual?.[key]).toEqual(value);
  }
}

function expectNpmUpdateCall(params: {
  spec: string;
  expectedIntegrity?: string;
  expectedPluginId?: string;
}) {
  const call = npmInstallCall();
  expect(call?.spec).toBe(params.spec);
  expect(call?.expectedIntegrity).toBe(params.expectedIntegrity);
  if (params.expectedPluginId) {
    expect(call?.expectedPluginId).toBe(params.expectedPluginId);
  }
}

const QQBOT_EXPECTED_INTEGRITY =
  "sha512-yngu/2cPeZjJfIfHWCXWB2/6KlDHrb9vpOUjKLdQxePLSp6wCn3CFOALcBIVq/9o6jlYz9WTU9idW6nfX1xpFA==";

function createBundledSource(pluginId = "feishu", localPath = appBundledPluginRoot(pluginId)) {
  return { pluginId, localPath, npmSpec: `@branch/${pluginId}` };
}

type ExternalizedPluginBridge = NonNullable<
  Parameters<typeof syncPluginsForUpdateChannel>[0]["externalizedBundledPluginBridges"]
>[number];

function createExternalizedPluginConfig(params?: {
  pluginId?: string;
  channelEnabled?: boolean;
  entryEnabled?: boolean;
  loadPaths?: string[];
  install?: PluginInstallRecord;
}): BranchConfig {
  const pluginId = params?.pluginId ?? "legacy-chat";
  const bundledRoot = appBundledPluginRoot(pluginId);
  return {
    ...(params?.channelEnabled === false ? {} : { channels: { [pluginId]: { enabled: true } } }),
    plugins: {
      ...(params?.entryEnabled === undefined
        ? {}
        : { entries: { [pluginId]: { enabled: params.entryEnabled } } }),
      load: { paths: params?.loadPaths ?? [bundledRoot] },
      installs: {
        [pluginId]:
          params?.install ??
          ({ source: "path", sourcePath: bundledRoot, installPath: bundledRoot } as const),
      },
    },
  };
}

function syncExternalizedPlugin(params: {
  config?: BranchConfig;
  bridge?: Partial<ExternalizedPluginBridge>;
  channel?: "stable" | "beta" | "extended-stable";
  coreVersion?: string;
}) {
  return syncPluginsForUpdateChannel({
    channel: params.channel ?? "stable",
    ...(params.coreVersion ? { coreVersion: params.coreVersion } : {}),
    externalizedBundledPluginBridges: [
      {
        bundledPluginId: "legacy-chat",
        npmSpec: "@branch/legacy-chat",
        channelIds: ["legacy-chat"],
        ...params.bridge,
      },
    ],
    config: params.config ?? createExternalizedPluginConfig(),
  });
}

function mockBundledSources(...sources: ReturnType<typeof createBundledSource>[]) {
  resolveBundledPluginSourcesMock.mockReturnValue(
    new Map(sources.map((source) => [source.pluginId, source])),
  );
}

type UpdateInstalledPluginParams = Parameters<typeof updateNpmInstalledPlugins>[0];

function updatePlugin(
  config: BranchConfig,
  pluginId: string,
  params: Omit<UpdateInstalledPluginParams, "config" | "pluginIds"> = {},
) {
  return updateNpmInstalledPlugins({ config, pluginIds: [pluginId], ...params });
}

function createDuplicateQqbotConfig(
  params: {
    canonicalInstallPath?: string;
  } = {},
): BranchConfig {
  const qqbot = {
    source: "npm",
    spec: "@branch/qqbot@1.9.0",
    resolvedName: "@branch/qqbot",
    resolvedSpec: "@branch/qqbot@1.9.0",
    installPath: "/tmp/branch-qqbot-legacy",
  } satisfies PluginInstallRecord;
  const canonical = {
    source: "npm",
    spec: "@tencent-connect/branch-qqbot@2.0.1",
    resolvedName: "@tencent-connect/branch-qqbot",
    resolvedSpec: "@tencent-connect/branch-qqbot@2.0.1",
    installPath: params.canonicalInstallPath ?? "/tmp/branch-qqbot-canonical",
  } satisfies PluginInstallRecord;
  return {
    plugins: {
      entries: { qqbot: { enabled: true } },
      installs: { qqbot, "branch-qqbot": canonical },
    },
  };
}

describe("updateNpmInstalledPlugins", () => {
  beforeEach(() => {
    installPluginFromNpmSpecMock.mockReset();
    installPluginFromMarketplaceMock.mockReset();
    installPluginFromClawHubMock.mockReset();
    fetchClawHubPackageDetailMock.mockReset();
    installPluginFromGitSpecMock.mockReset();
    resolveBundledPluginSourcesMock.mockReset();
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());
    runCommandWithTimeoutMock.mockReset();
    validatePackageExtensionEntriesForInstallMock.mockReset();
  });

  it("propagates a managed installer ownership refusal before later updates", async () => {
    const { createManagedPluginArtifactConsentHandler } =
      await vi.importActual<typeof import("./capability-consent.js")>("./capability-consent.js");
    const { installPluginDirectoryIntoExtensions } = await import("./install-shared.js");
    const pluginId = "consent-fixture";
    const packageName = `@acme/${pluginId}`;
    const installedDir = createCapabilityConsentPackage({
      pluginId,
      version: "1.0.0",
      childProviders: ["existing-child-provider"],
    });
    const sourceDir = createCapabilityConsentPackage({
      pluginId,
      version: "2.0.0",
      childProviders: ["existing-child-provider", "new-child-provider"],
    });
    const laterDir = createInstalledPackageDir("@acme/later", "1.0.0");
    const record: PluginInstallRecord = {
      source: "npm",
      spec: packageName,
      installPath: installedDir,
    };
    const records = {
      [pluginId]: record,
      alias: { ...record },
      later: { source: "npm" as const, spec: "@acme/later", installPath: laterDir },
    };
    const config = pluginConfig(records, {
      entries: { [pluginId]: { enabled: true }, later: { enabled: true } },
    });
    const originalConfig = structuredClone(config);
    const originalFiles = [
      "package.json",
      "branch.plugin.json",
      "index.js",
      path.join("children", "addon", "branch.plugin.json"),
      path.join("children", "addon", "addon.js"),
    ].map((file) => ({ file, bytes: fs.readFileSync(path.join(installedDir, file)) }));
    const originalLaterPackage = fs.readFileSync(path.join(laterDir, "package.json"));
    const onCapabilityConsent =
      vi.fn<NonNullable<UpdateInstalledPluginParams["onCapabilityConsent"]>>();
    const beforePersistentEffect = vi.fn();
    const warn = vi.fn();
    const consent = createManagedPluginArtifactConsentHandler({
      config,
      source: "npm",
      spec: packageName,
      previousRecords: records,
      onCapabilityConsent,
      beforePersistentEffect,
    });
    mockNpmViewMetadata({ name: packageName, version: "2.0.0" });
    // Exercise the installer boundary with an intrinsic refusal from the managed ownership owner.
    installPluginFromNpmSpecMock.mockImplementationOnce(async () =>
      installPluginDirectoryIntoExtensions({
        sourceDir,
        targetDir: installedDir,
        pluginId,
        extensions: ["index.js"],
        logger: {},
        timeoutMs: 1_000,
        mode: "update",
        dryRun: false,
        copyErrorPrefix: "failed to copy plugin",
        hasDeps: false,
        depsLogMessage: "Installing dependencies…",
        onBeforePluginArtifactCommit: consent.onBeforePluginArtifactCommit,
      }),
    );

    await expect(
      updateNpmInstalledPlugins({
        config,
        pluginIds: [pluginId, "later"],
        onCapabilityConsent,
        beforePersistentEffect,
        disableOnFailure: true,
        logger: { warn },
      }),
    ).rejects.toMatchObject({
      name: "ManagedPluginLifecycleError",
      kind: "invalid-request",
      message: `Plugin "${pluginId}" matches multiple installed package owners.`,
      capabilityConsent: undefined,
    });

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledOnce();
    expect(onCapabilityConsent).not.toHaveBeenCalled();
    expect(beforePersistentEffect).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(config).toEqual(originalConfig);
    for (const { file, bytes } of originalFiles) {
      expect(fs.readFileSync(path.join(installedDir, file))).toEqual(bytes);
    }
    expect(fs.readFileSync(path.join(laterDir, "package.json"))).toEqual(originalLaterPackage);
  });

  it.each<{
    label: string;
    nextProviders?: string[];
    review?: string;
    priorAcceptance?: string;
    rejected?: boolean;
    ownerEnabled?: boolean;
    childEnabled?: boolean;
    previousPayload?: string;
    disableOnFailure?: boolean;
    omitStageReview?: boolean;
    reviewRetryStage?: boolean;
  }>([
    {
      label: "rejects widened sibling capabilities before replacing the installed artifact",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      rejected: true,
      ownerEnabled: false,
      childEnabled: true,
    },
    {
      label: "accepts widened sibling capabilities and refreshes the artifact-bound acceptance",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "accept",
    },
    {
      label: "silently refreshes existing acceptance when package capabilities are unchanged",
    },
    {
      label: "asks for consent when an enabled legacy record lacks artifact acceptance",
      review: "accept",
      priorAcceptance: "missing",
    },
    {
      label: "defers missing artifact acceptance for a disabled legacy record",
      priorAcceptance: "missing",
      ownerEnabled: false,
    },
    {
      label: "rejects an unchanged replacement when prior acceptance has no artifact integrity",
      priorAcceptance: "unanchored",
      rejected: true,
    },
    {
      label: "rejects staged capabilities changed while the operator reviews the artifact",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review: "mutate",
      rejected: true,
    },
    ...(["corrupt"] as const).map((previousPayload) => ({
      label: `repairs a ${previousPayload} previous payload only after fresh staged consent`,
      review: "accept",
      previousPayload,
    })),
    {
      label: "keeps a missing-payload repair pending when no consent handler is available",
      rejected: true,
      previousPayload: "missing",
      disableOnFailure: true,
    },
    {
      label: "repairs a disabled missing payload without retaining unverifiable acceptance",
      ownerEnabled: false,
      previousPayload: "missing",
    },
    {
      label: "rejects a missing-payload replacement that omitted staged artifact review",
      previousPayload: "missing",
      omitStageReview: true,
    },
    {
      label: "does not carry acceptance from an earlier stage into a widened disabled retry",
      nextProviders: ["existing-child-provider", "new-child-provider"],
      ownerEnabled: false,
      reviewRetryStage: true,
    },
    ...(["throw-undefined"] as const).map((review) => ({
      label: `preserves the original consent callback failure (${review})`,
      nextProviders: ["existing-child-provider", "new-child-provider"],
      review,
      disableOnFailure: true,
    })),
  ])(
    "$label",
    async ({
      nextProviders = ["existing-child-provider"],
      review = "none",
      priorAcceptance = "valid",
      rejected = false,
      ownerEnabled = true,
      childEnabled = false,
      previousPayload,
      disableOnFailure = false,
      omitStageReview = false,
      reviewRetryStage = false,
    }) => {
      capabilityConsentMode.real = true;
      const pluginId = "consent-fixture";
      const rootPluginId = `${pluginId}/index`;
      const packageName = `@acme/${pluginId}`;
      const installedDir = createCapabilityConsentPackage({
        pluginId,
        version: "1.0.0",
        childProviders: ["existing-child-provider"],
      });
      const stagedDir = createCapabilityConsentPackage({
        pluginId,
        version: "2.0.0",
        childProviders: nextProviders,
      });
      const load = { paths: [path.join(installedDir, "children", "addon", "addon.js")] };
      const previousDeclared = resolvePluginArtifactDeclaredSurface(installedDir, process.env, {
        config: { plugins: { load } },
      });
      const previousAcceptedAt = "2026-01-01T00:00:00.000Z";
      const childManifestPath = path.join(
        installedDir,
        "children",
        "addon",
        "branch.plugin.json",
      );
      const previousChildManifest = fs.readFileSync(childManifestPath, "utf8");
      const config = {
        plugins: {
          load,
          entries: {
            [rootPluginId]: { enabled: ownerEnabled },
            [`${pluginId}-addon`]: { enabled: childEnabled },
          },
          installs: {
            [pluginId]: {
              source: "npm" as const,
              spec: packageName,
              installPath: installedDir,
              ...(priorAcceptance !== "unanchored" ? { integrity: "sha512-previous" } : {}),
              ...(priorAcceptance !== "missing"
                ? {
                    acceptedSurface: previousDeclared,
                    acceptedSurfaceHash: computeDeclaredSurfaceHash(previousDeclared),
                    acceptedSurfaceAt: previousAcceptedAt,
                    ...(priorAcceptance !== "unanchored"
                      ? { acceptedSurfaceIntegrity: "sha512-previous" }
                      : {}),
                  }
                : {}),
            },
          },
        },
      } satisfies BranchConfig;
      if (previousPayload === "missing") {
        fs.rmSync(installedDir, { recursive: true, force: true });
      } else if (previousPayload === "corrupt") {
        fs.writeFileSync(path.join(installedDir, "branch.plugin.json"), "{");
      }
      mockNpmViewMetadata({ name: packageName, version: "2.0.0", integrity: "sha512-next" });
      installPluginFromNpmSpecMock.mockImplementationOnce(
        async (options: {
          onBeforePluginArtifactCommit?: (request: {
            pluginId: string;
            currentArtifactDir: string;
            stagedArtifactDir: string;
            mode: "update";
          }) => Promise<void>;
        }) => {
          if (reviewRetryStage) {
            await options.onBeforePluginArtifactCommit?.({
              pluginId,
              currentArtifactDir: installedDir,
              stagedArtifactDir: createCapabilityConsentPackage({
                pluginId,
                version: "1.0.0",
                childProviders: ["existing-child-provider"],
              }),
              mode: "update",
            });
          }
          if (!omitStageReview) {
            await options.onBeforePluginArtifactCommit?.({
              pluginId,
              currentArtifactDir: installedDir,
              stagedArtifactDir: stagedDir,
              mode: "update",
            });
          }
          fs.cpSync(stagedDir, installedDir, { recursive: true });
          return {
            ok: true,
            pluginId,
            targetDir: installedDir,
            version: "2.0.0",
            extensions: ["index.js"],
            npmResolution: {
              name: packageName,
              version: "2.0.0",
              resolvedSpec: `${packageName}@2.0.0`,
              integrity: "sha512-next",
            },
          };
        },
      );

      const beforePersistentEffect = vi.fn();
      let reviewed = false;
      const onCapabilityConsent: UpdateInstalledPluginParams["onCapabilityConsent"] =
        review === "none"
          ? undefined
          : async (details) => {
              expect(beforePersistentEffect).not.toHaveBeenCalled();
              reviewed = true;
              if (review === "throw-undefined") {
                // oxlint-disable-next-line typescript/only-throw-error -- JavaScript callbacks may throw undefined; preserve that exact failure.
                throw undefined;
              }
              expect(details.reviewToken).toBe(computeDeclaredSurfaceHash(details.declared));
              expect(details.source?.integrity).not.toBe("sha512-previous");
              if (review === "mutate") {
                writeJson(path.join(stagedDir, "children", "addon", "branch.plugin.json"), {
                  id: `${pluginId}-addon`,
                  providers: [...nextProviders, "changed-during-review"],
                  configSchema: { type: "object" },
                });
              }
              return { reviewToken: details.reviewToken };
            };
      const pendingUpdate = updatePlugin(config, pluginId, {
        onCapabilityConsent,
        beforePersistentEffect,
        disableOnFailure,
        packagePluginIds: { [pluginId]: [rootPluginId, `${pluginId}-addon`] },
      });
      if (omitStageReview) {
        await expect(pendingUpdate).rejects.toThrow("did not expose its verified artifact");
        return;
      }
      if (review === "throw-undefined") {
        await expect(pendingUpdate).rejects.toBeUndefined();
        expect(fs.readFileSync(childManifestPath, "utf8")).toBe(previousChildManifest);
        expect(config.plugins.entries[rootPluginId].enabled).toBe(ownerEnabled);
        return;
      }
      const result = await pendingUpdate;
      expect(reviewed).toBe(review !== "none");

      if (rejected) {
        expect(result.changed).toBe(false);
        expect(result.outcomes).toEqual([
          expect.objectContaining({
            pluginId,
            status: "error",
            message: expect.stringContaining("--accept-capabilities"),
            code: "PLUGIN_CAPABILITY_CONSENT_REQUIRED",
          }),
        ]);
        if (previousPayload === "missing") {
          expect(fs.existsSync(installedDir)).toBe(false);
        } else {
          expect(fs.readFileSync(childManifestPath, "utf8")).toBe(previousChildManifest);
        }
        expect(result.config).toBe(config);
        expect(result.config.plugins?.installs?.[pluginId]).toBe(config.plugins.installs[pluginId]);
        return;
      }

      const install = result.config.plugins?.installs?.[pluginId];
      expect(beforePersistentEffect).toHaveBeenCalledTimes(reviewRetryStage ? 2 : 1);
      expect(result.outcomes).toEqual([expect.objectContaining({ pluginId, status: "updated" })]);
      if (!ownerEnabled && !childEnabled) {
        expect(result.config.plugins?.entries).toEqual(config.plugins.entries);
        expect(install?.acceptedSurface).toBeUndefined();
        expect(install?.acceptedSurfaceHash).toBeUndefined();
        expect(install?.acceptedSurfaceAt).toBeUndefined();
        expect(install?.acceptedSurfaceIntegrity).toBeUndefined();
        return;
      }
      expect(install?.acceptedSurface?.providers).toEqual(
        ["root-provider", ...nextProviders].toSorted(),
      );
      expect(install?.acceptedSurfaceHash).toBe(
        computeDeclaredSurfaceHash(
          resolvePluginArtifactDeclaredSurface(installedDir, process.env, {
            config: result.config,
          }),
        ),
      );
      expect(install?.acceptedSurfaceAt).not.toBe(previousAcceptedAt);
      expect(install?.acceptedSurfaceIntegrity).toBe("sha512-next");
    },
  );

  it("moves only the replaced npm plugin's exact explicit load path", async () => {
    const previousInstallPath = createInstalledPackageDir("@acme/demo", "1.0.0");
    const nextInstallPath = createInstalledPackageDir("@acme/demo", "2.0.0");
    const adjacentInstallPath = createInstalledPackageDir("@acme/adjacent", "1.0.0");
    const customPath = path.join(previousInstallPath, "custom-child");
    mockNpmViewMetadata({ name: "@acme/demo", version: "2.0.0" });
    mockSuccessfulNpmUpdate({
      pluginId: "demo",
      targetDir: nextInstallPath,
      version: "2.0.0",
      packageName: "@acme/demo",
    });
    const adjacentRecord = {
      source: "npm" as const,
      spec: "@acme/adjacent@1.0.0",
      installPath: adjacentInstallPath,
    };

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          load: {
            paths: [customPath, previousInstallPath, adjacentInstallPath],
          },
          installs: {
            demo: {
              source: "npm",
              spec: "@acme/demo@1.0.0",
              installPath: previousInstallPath,
              resolvedName: "@acme/demo",
              resolvedSpec: "@acme/demo@1.0.0",
              resolvedVersion: "1.0.0",
            },
            adjacent: adjacentRecord,
          },
        },
      },
      pluginIds: ["demo"],
    });

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.load?.paths).toEqual([
      customPath,
      nextInstallPath,
      adjacentInstallPath,
    ]);
    expect(result.config.plugins?.installs?.adjacent).toEqual(adjacentRecord);
  });

  afterEach(() => {
    capabilityConsentMode.real = false;
    vi.unstubAllEnvs();
  });

  it("does not treat inherited prototype names as install records", async () => {
    const config: BranchConfig = { plugins: { installs: {} } };

    const result = await updatePlugin(config, "constructor");

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "constructor",
        status: "skipped",
        message: 'No install record for "constructor".',
      },
    ]);
  });

  it("targets the activated core for version-bound post-update plugin @branch/codex@latest", async () => {
    const spec = "@branch/codex@latest";
    const targetVersion = "2026.9.4";
    const { config } = createNpmUpdateFixture({
      pluginId: "codex",
      packageName: "@branch/codex",
      installedVersion: "2026.9.2",
      spec,
      installerVersion: targetVersion,
      installerResolvedSpec: `@branch/codex@${targetVersion}`,
    });
    runCommandWithTimeoutMock.mockImplementation(async (argv) => ({
      code: 0,
      stdout: JSON.stringify({
        name: "@branch/codex",
        version: argv.includes(`@branch/codex@${targetVersion}`) ? targetVersion : "2026.9.2",
      }),
      stderr: "",
    }));
    const result = await updatePlugin(config, "codex", {
      updateChannel: "stable",
      coreVersion: "2026.9.4",
      versionBoundPluginIds: new Set(["codex"]),
      syncOfficialPluginInstalls: true,
    });
    expect(npmInstallCall()?.spec).toBe(`@branch/codex@${targetVersion}`);
    expect(result.config.plugins?.installs?.codex?.spec).toBe(spec);
  });

  it("converges after one beta-channel update when latest is newer and preserves @branch/codex@beta", async () => {
    const spec = "@branch/codex@beta";
    const packageName = "@branch/codex";
    const { config, installPath } = createNpmUpdateFixture({
      pluginId: "codex",
      packageName,
      spec,
      installedVersion: "2026.9.1-beta.1",
    });
    installPluginFromNpmSpecMock.mockImplementation(async () => {
      createInstalledPackageDir(packageName, "2026.9.2", {
        installPath,
      });
      return createSuccessfulNpmUpdateResult({
        pluginId: "codex",
        targetDir: installPath,
        version: "2026.9.2",
        packageName,
      });
    });
    const updateOptions = {
      officialPluginUpdateChannel: "beta" as const,
      syncOfficialPluginInstalls: true,
      coreVersion: "2026.9.2",
    };
    mockNpmViewMetadata({ name: packageName, version: "2026.9.1-beta.1" });
    mockNpmViewMetadata({ name: packageName, version: "2026.9.2" });

    const updated = await updatePlugin(config, "codex", updateOptions);

    expect(updated.outcomes[0]?.status).toBe("updated");
    expect(npmInstallCall()?.spec).toBe(`${packageName}@2026.9.2`);
    expect(updated.config.plugins?.installs?.codex?.spec).toBe(spec);
    mockNpmViewMetadata({ name: packageName, version: "2026.9.1-beta.1" });
    mockNpmViewMetadata({ name: packageName, version: "2026.9.2" });

    const repeated = await updatePlugin(updated.config, "codex", updateOptions);

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    expect(repeated.changed).toBe(false);
    expect(repeated.config).toBe(updated.config);
    expect(repeated.outcomes[0]).toMatchObject({
      status: "unchanged",
      currentVersion: "2026.9.2",
      nextVersion: "2026.9.2",
    });
  });

  it.each(["updated", "unchanged", "failed"] as const)(
    "recovers an official npm release pin only after a successful %s replacement",
    async (outcome) => {
      const packageName = "@branch/discord";
      const unchanged = outcome === "unchanged";
      const installedVersion = unchanged ? "2027.2.1" : "2027.1.1";
      const prefix = outcome === "updated" ? "v" : "";
      const spec = `${packageName}@${prefix}${installedVersion}`;
      const { config } = createNpmUpdateFixture({
        pluginId: "discord",
        packageName,
        installedVersion,
        spec,
        registryVersion: "2027.2.1",
        ...(unchanged ? { registryIntegrity: "sha512-same", integrity: "sha512-same" } : {}),
        ...(outcome === "updated"
          ? {
              installerVersion: "2027.2.1",
              installerResolvedSpec: `${packageName}@2027.2.1`,
            }
          : {}),
      });
      if (unchanged) {
        installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));
      } else if (outcome === "failed") {
        expectDefined(config.plugins, "plugin config fixture").entries = {
          discord: { enabled: true, config: { preserved: true } },
        };
        installPluginFromNpmSpecMock.mockResolvedValue({
          ok: false,
          error: "replacement entry not found",
        });
      }
      const result = await updatePlugin(config, "discord", {
        ...(outcome !== "failed"
          ? { syncOfficialPluginInstalls: unchanged, updateChannel: "stable" }
          : {}),
        coreVersion: `${prefix}2027.2.1`,
      });
      if (unchanged) {
        expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
        expect(result.changed).toBe(true);
        expect(result.config.plugins?.installs?.discord).toMatchObject({
          spec: packageName,
          resolvedVersion: "2027.2.1",
          integrity: "sha512-same",
        });
        expect(config.plugins?.installs?.discord?.spec).toBe(spec);
      } else {
        expect(npmInstallCall()?.spec).toBe(packageName);
        if (outcome === "updated") {
          expect(result.config.plugins?.installs?.discord).toMatchObject({
            spec: packageName,
            resolvedVersion: "2027.2.1",
          });
        } else {
          expect(result.changed).toBe(false);
          expect(result.config).toBe(config);
          expect(result.config.plugins?.installs?.discord?.spec).toBe(spec);
          expect(result.config.plugins?.entries?.discord).toEqual({
            enabled: true,
            config: { preserved: true },
          });
          expect(result.outcomes[0]?.status).toBe("error");
        }
      }
    },
  );

  it("preserves independently versioned official pins and integrity during beta bulk sync", async () => {
    const channel = "beta";
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@branch/acpx",
      installedVersion: "2.13.1",
      registryVersion: "2.13.1",
      registryIntegrity: "sha512-new",
      spec: "@branch/acpx@2.13.1",
      integrity: "sha512-old",
      installerVersion: "2.13.1",
      installerResolvedSpec: "@branch/acpx@2.13.1",
    });
    await updatePlugin(config, "acpx", {
      syncOfficialPluginInstalls: true,
      updateChannel: channel,
      coreVersion: "2026.7.33",
    });
    expectNpmUpdateCall({
      spec: "@branch/acpx@2.13.1",
      expectedPluginId: "acpx",
      expectedIntegrity: "sha512-old",
    });
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
  });

  it("restores automatic updates for a trusted official Seedbank release pin (installed=2027.1.1, dryRun=false)", async () => {
    const installedVersion = "2027.1.1";
    const packageName = "@branch/discord";
    const installPath = createInstalledPackageDir(packageName, installedVersion);
    const config = createClawHubInstallConfig({
      pluginId: "discord",
      clawhubPackage: packageName,
      spec: `clawhub:${packageName}@${installedVersion}`,
      installPath,
    });
    installPluginFromClawHubMock.mockResolvedValue(
      createSuccessfulClawHubUpdateResult({
        pluginId: "discord",
        clawhubPackage: packageName,
        version: "2027.2.1",
        targetDir: installPath,
      }),
    );
    fetchClawHubPackageDetailMock.mockResolvedValue({
      package: {
        name: packageName,
        latestVersion: "2027.3.1",
        tags: { latest: "2027.3.1" },
      },
    });

    const result = await updatePlugin(config, "discord", {
      updateChannel: "extended-stable",
      coreVersion: "2027.2.1",
    });

    expect(clawHubInstallCall()?.spec).toBe(`clawhub:${packageName}@2027.2.1`);
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.config.plugins?.installs?.discord).toMatchObject({
      source: "clawhub",
      spec: `clawhub:${packageName}`,
      clawhubPackage: packageName,
    });
    expect(result.outcomes[0]).toMatchObject({
      status: "updated",
      nextVersion: "2027.2.1",
    });
    expect(result.outcomes[0]?.message).not.toContain("is pinned");
  });

  it("does not skip trusted official default updates when latest resolves to the installed prerelease", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@branch/acpx",
      installedVersion: "2026.5.2-beta.2",
      registryVersion: "2026.5.2-beta.2",
      registryIntegrity: "sha512-beta",
      registryShasum: "beta",
      spec: "@branch/acpx",
      integrity: "sha512-beta",
      shasum: "beta",
      installerVersion: "2026.5.2",
      installerResolvedSpec: "@branch/acpx@2026.5.2",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce(failedNpmVersionQueryResult);
    const result = await updatePlugin(config, "acpx", { syncOfficialPluginInstalls: true });

    expect(npmInstallCall()?.spec).toBe("@branch/acpx");
    expect(npmInstallCall()?.expectedIntegrity).toBeUndefined();
    expect(npmInstallCall()?.expectedPluginId).toBe("acpx");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.outcomes[0]?.pluginId).toBe("acpx");
    expect(result.outcomes[0]?.status).toBe("updated");
    expect(result.outcomes[0]?.currentVersion).toBe("2026.5.2-beta.2");
    expect(result.outcomes[0]?.nextVersion).toBe("2026.5.2");
  });

  it("does not grant official trust to a vendor package using an official plugin id", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "acpx",
      packageName: "@vendor/acpx-fork",
      installedVersion: "1.0.0",
      registryVersion: "1.0.1",
      installerVersion: "1.0.1",
    });

    await updatePlugin(config, "acpx", { timeoutMs: 1_800_000 });
    expect(npmViewCall()?.[1]?.timeoutMs).toBe(1_800_000);

    expect(npmInstallCall()).toMatchObject({
      spec: "@vendor/acpx-fork",
      expectedPluginId: "acpx",
      trustedSourceLinkedOfficialInstall: false,
      timeoutMs: 1_800_000,
    });
  });

  it("reports a newer latest release when the beta line for an exact pin is unavailable", async () => {
    const { config } = createNpmUpdateFixture({
      pluginId: "demo",
      packageName: "@acme/demo",
      installedVersion: "1.2.3",
      registryVersion: "1.2.3",
      registryIntegrity: "sha512-same",
      registryShasum: "same",
      spec: "@acme/demo@1.2.3",
      integrity: "sha512-same",
      shasum: "same",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "npm error code E404",
    });
    mockNpmViewMetadata({
      name: "@acme/demo",
      version: "1.2.4",
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await updatePlugin(config, "demo", { updateChannel: "beta" });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(runCommandWithTimeoutMock.mock.calls).toHaveLength(3);
    expect(runCommandWithTimeoutMock.mock.calls[2]?.[0]).toContain("@acme/demo@latest");
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "unchanged",
        currentVersion: "1.2.3",
        nextVersion: "1.2.4",
        message:
          "demo is pinned to @acme/demo@1.2.3 (installed 1.2.3); registry latest resolves to 1.2.4. " +
          "Pass `branch plugins update @acme/demo@latest` to replace this version pin.",
      },
    ]);
  });

  it.each([
    {
      name: "does not skip unchanged npm plugins when package metadata requires a newer plugin API",
      compatibility: { compat: { pluginApi: ">=2026.5.28-beta.4" } },
      assertFullOutcome: true,
    },
    {
      name: "does not skip unchanged npm plugins when package metadata requires a newer host",
      compatibility: { install: { minHostVersion: ">=2026.5.28-beta.4" } },
      assertFullOutcome: false,
    },
  ] as const)("$name", async ({ compatibility, assertFullOutcome }) => {
    vi.stubEnv("BRANCH_COMPATIBILITY_HOST_VERSION", "2026.5.28-beta.3");
    const { config } = createNpmUpdateFixture({
      pluginId: "msteams",
      packageName: "@branch/msteams",
      installedVersion: "2026.5.28-beta.4",
      registryVersion: "2026.5.28-beta.4",
      registryIntegrity: "sha512-newer",
      registryShasum: "newer",
      registryBranch: { extensions: ["./dist/index.js"], ...compatibility },
      integrity: "sha512-newer",
      shasum: "newer",
      installerVersion: "2026.5.28-beta.3",
      installerResolvedSpec: "@branch/msteams@2026.5.28-beta.3",
    });
    runCommandWithTimeoutMock.mockResolvedValueOnce(failedNpmVersionQueryResult);

    const result = await updatePlugin(config, "msteams");

    expect(npmInstallCall()?.spec).toBe("@branch/msteams");
    expect(npmInstallCall()?.mode).toBe("update");
    if (assertFullOutcome) {
      expect(npmInstallCall()?.expectedPluginId).toBe("msteams");
    }
    expect(result.changed).toBe(true);
    expectRecordFields(result.config.plugins?.installs?.msteams, {
      source: "npm",
      version: "2026.5.28-beta.3",
      resolvedName: "@branch/msteams",
      resolvedVersion: "2026.5.28-beta.3",
      resolvedSpec: "@branch/msteams@2026.5.28-beta.3",
    });
    if (assertFullOutcome) {
      expect(result.outcomes).toEqual([
        {
          pluginId: "msteams",
          status: "updated",
          currentVersion: "2026.5.28-beta.4",
          nextVersion: "2026.5.28-beta.3",
          message: "Downgraded msteams: 2026.5.28-beta.4 -> 2026.5.28-beta.3.",
        },
      ]);
    }
  });

  it("repairs every copied stale dependencies host for unchanged npm plugins without reinstalling them", async () => {
    const dependencyField = "dependencies";
    const stateDir = makeTrackedTempDir("branch-plugin-update-legacy", tempDirs);
    const plugins = ["email", "calendar"].map((pluginId) => {
      const packageName = `@groveemail/${pluginId}`;
      const installPath = path.join(stateDir, "extensions", pluginId);
      const staleHostDir = path.join(installPath, "node_modules", "branch");
      fs.mkdirSync(staleHostDir, { recursive: true });
      writeJson(path.join(installPath, "package.json"), {
        name: packageName,
        version: "2026.7.1",
        [dependencyField]: { branch: ">=2026.7.1" },
      });
      writeJson(path.join(staleHostDir, "package.json"), {
        name: "branch",
        version: "2026.7.1-beta.2",
      });
      mockNpmViewMetadata({
        name: packageName,
        version: "2026.7.1",
        integrity: "sha512-same",
        shasum: "same",
      });
      return { pluginId, packageName, installPath, staleHostDir };
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await withEnvAsync({ BRANCH_STATE_DIR: stateDir }, async () =>
      updateNpmInstalledPlugins({
        config: {
          plugins: {
            installs: Object.fromEntries(
              plugins.map(({ pluginId, packageName, installPath }) => [
                pluginId,
                {
                  source: "npm" as const,
                  spec: packageName,
                  installPath,
                  resolvedName: packageName,
                  resolvedVersion: "2026.7.1",
                  resolvedSpec: `${packageName}@2026.7.1`,
                  integrity: "sha512-same",
                  shasum: "same",
                },
              ]),
            ),
          },
        },
        pluginIds: plugins.map(({ pluginId }) => pluginId),
      }),
    );

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    for (const { staleHostDir } of plugins) {
      expect(fs.lstatSync(staleHostDir).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(staleHostDir)).toBe(fs.realpathSync(process.cwd()));
    }
    expect(result.changed).toBe(true);
    expect(result.outcomes.map(({ pluginId, status }) => ({ pluginId, status }))).toEqual(
      plugins.map(({ pluginId }) => ({ pluginId, status: "unchanged" })),
    );
  });

  it.runIf(process.platform !== "win32")(
    "repairs managed Seedbank hosts without traversing external or developer aliases after an npm update",
    async () => {
      const plugins = [
        { pluginId: "sibling", packageName: "@acme/sibling" },
        { pluginId: "updated", packageName: "@acme/updated" },
      ];
      const { stateDir, installPaths, peerLinkPath, linkPeer } =
        createBranchPeerLinkFixtures(plugins);
      linkPeer("sibling");

      const outsideInstallPath = createInstalledPackageDir("@acme/outside", "2026.5.4", {
        peerDependencies: { branch: ">=2026.5.4" },
      });
      const developerInstallPath = createInstalledPackageDir("@acme/developer", "2026.5.4", {
        peerDependencies: { branch: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", "developer"),
      });
      const marketplaceInstallPath = createInstalledPackageDir("@acme/marketplace", "2026.5.4", {
        peerDependencies: { branch: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", "marketplace"),
      });
      const clawhubInstallPath = createInstalledPackageDir("@acme/clawhub", "2026.5.4", {
        peerDependencies: { branch: ">=2026.5.4" },
        installPath: path.join(stateDir, "extensions", "clawhub"),
      });
      const copiedHosts = [
        outsideInstallPath,
        developerInstallPath,
        marketplaceInstallPath,
        clawhubInstallPath,
      ].map((installPath) => {
        const copiedHostDir = path.join(installPath, "node_modules", "branch");
        fs.mkdirSync(copiedHostDir, { recursive: true });
        writeJson(path.join(copiedHostDir, "package.json"), {
          name: "branch",
          version: "2026.4.1",
        });
        return copiedHostDir;
      });
      const outsideAliasPath = path.join(stateDir, "extensions", "outside-alias");
      const developerAliasPath = path.join(stateDir, "extensions", "developer-alias");
      fs.symlinkSync(outsideInstallPath, outsideAliasPath, "dir");
      fs.symlinkSync(developerInstallPath, developerAliasPath, "dir");

      mockNpmViewMetadata({
        name: "@acme/updated",
        version: "2026.5.5",
        integrity: "sha512-same",
        shasum: "same",
      });
      installPluginFromNpmSpecMock.mockImplementation(() => {
        fs.rmSync(peerLinkPath("sibling"), { recursive: true, force: true });
        fs.rmSync(peerLinkPath("updated"), { recursive: true, force: true });
        linkPeer("updated");
        return Promise.resolve(
          createSuccessfulNpmUpdateResult({
            pluginId: "updated",
            targetDir: installPaths.updated,
            version: "2026.5.5",
            packageName: "@acme/updated",
          }),
        );
      });

      await withEnvAsync({ BRANCH_STATE_DIR: stateDir }, async () =>
        updateNpmInstalledPlugins({
          config: createPeerLinkInstallConfig({
            plugins,
            installPaths,
            extraInstalls: {
              outside: { source: "npm", installPath: outsideInstallPath },
              "outside-alias": { source: "npm", installPath: outsideAliasPath },
              developer: { source: "path", installPath: developerInstallPath },
              "developer-alias": { source: "npm", installPath: developerAliasPath },
              marketplace: { source: "marketplace", installPath: marketplaceInstallPath },
              clawhub: { source: "clawhub", installPath: clawhubInstallPath },
            },
          }),
          pluginIds: ["updated"],
        }),
      );

      expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
      expect(fs.lstatSync(peerLinkPath("sibling")).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(peerLinkPath("updated")).isSymbolicLink()).toBe(true);
      expect(
        copiedHosts.map((copiedHostDir) => fs.lstatSync(copiedHostDir).isSymbolicLink()),
      ).toEqual([false, false, false, true]);
      expect(fs.realpathSync(expectDefined(copiedHosts[3], "clawhub copied host fixture"))).toBe(
        fs.realpathSync(process.cwd()),
      );
    },
  );

  it("continues repairing sibling branch peer links after one recorded npm install cannot be relinked", async () => {
    const plugins = [
      { pluginId: "brave", packageName: "@branch/brave-plugin" },
      { pluginId: "codex", packageName: "@branch/codex" },
    ];
    const { stateDir, installPaths, peerLinkPath, linkPeer } =
      createBranchPeerLinkFixtures(plugins);
    const malformedInstallPath = path.join(stateDir, "extensions", "aardvark");
    fs.mkdirSync(malformedInstallPath, { recursive: true });
    fs.writeFileSync(path.join(malformedInstallPath, "package.json"), "{ malformed");
    const brokenInstallPath = createInstalledPackageDir("@branch/broken-plugin", "2026.5.4", {
      peerDependencies: { branch: ">=2026.5.4" },
      installPath: path.join(stateDir, "extensions", "broken"),
    });
    fs.writeFileSync(path.join(brokenInstallPath, "node_modules"), "not a directory");
    linkPeer("brave");
    mockNpmViewMetadata({
      name: "@branch/codex",
      version: "2026.5.5",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockImplementation(() => {
      for (const { pluginId } of plugins) {
        fs.rmSync(peerLinkPath(pluginId), { recursive: true, force: true });
      }
      linkPeer("codex");
      return Promise.resolve(
        createSuccessfulNpmUpdateResult({
          pluginId: "codex",
          targetDir: installPaths.codex,
          version: "2026.5.5",
          packageName: "@branch/codex",
        }),
      );
    });
    const warnMessages: string[] = [];

    await withEnvAsync({ BRANCH_STATE_DIR: stateDir }, async () =>
      updateNpmInstalledPlugins({
        config: createPeerLinkInstallConfig({
          plugins,
          installPaths,
          extraInstalls: {
            aardvark: { source: "npm", installPath: malformedInstallPath },
            broken: {
              source: "npm",
              spec: "@branch/broken-plugin",
              installPath: brokenInstallPath,
              resolvedName: "@branch/broken-plugin",
              resolvedVersion: "2026.5.4",
              resolvedSpec: "@branch/broken-plugin@2026.5.4",
            },
          },
        }),
        pluginIds: ["codex"],
        logger: { warn: (message) => warnMessages.push(message) },
      }),
    );

    expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(peerLinkPath("brave"))).toBe(true);
    expect(fs.existsSync(peerLinkPath("codex"))).toBe(true);
    expect(warnMessages).toEqual([
      expect.stringContaining(
        `Could not repair branch peer link at ${malformedInstallPath}: SyntaxError:`,
      ),
      `Skipping branch peerDependency link because ${path.join(brokenInstallPath, "node_modules")} is not a real directory.`,
    ]);
  });

  it("expands home-relative install paths before checking installed npm versions", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "branch-plugin-update-home-"));
    tempDirs.push(home);
    const installPath = path.join(home, ".branch", "extensions", "lossless-grove");
    fs.mkdirSync(installPath, { recursive: true });
    writeJson(path.join(installPath, "package.json"), {
      name: "@martian-engineering/lossless-grove",
      version: "0.9.0",
    });
    mockNpmViewMetadata({
      name: "@martian-engineering/lossless-grove",
      version: "0.9.0",
      integrity: "sha512-same",
      shasum: "same",
    });
    installPluginFromNpmSpecMock.mockRejectedValue(new Error("installer should not run"));

    const result = await withEnvAsync({ HOME: home }, () =>
      updateNpmInstalledPlugins({
        config: createNpmInstallConfig(
          "lossless-grove",
          "@martian-engineering/lossless-grove",
          "~/.branch/extensions/lossless-grove",
          {
            resolvedName: "@martian-engineering/lossless-grove",
            resolvedVersion: "0.9.0",
            resolvedSpec: "@martian-engineering/lossless-grove@0.9.0",
            integrity: "sha512-same",
            shasum: "same",
          },
        ),
        pluginIds: ["lossless-grove"],
      }),
    );

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expectRecordFields(result.outcomes[0], {
      pluginId: "lossless-grove",
      status: "unchanged",
      currentVersion: "0.9.0",
    });
  });

  it.each(["fallback", "range", "beta", "healthy", "unreadable"] as const)(
    "handles npm metadata failures for a %s install",
    async (scenario) => {
      const demo = scenario === "beta" || scenario === "unreadable";
      const pluginId = demo ? "demo" : "lossless-grove";
      const packageName =
        scenario === "beta"
          ? "@example/demo"
          : demo
            ? "@acme/demo"
            : "@martian-engineering/lossless-grove";
      const version = demo ? "1.0.0" : "0.9.0";
      const spec = `${packageName}${scenario === "fallback" || scenario === "beta" ? "" : `@^${version}`}`;
      const installPath =
        scenario === "beta"
          ? "/missing/demo"
          : createInstalledPackageDir(packageName, version, {
              runnable: scenario === "healthy" || scenario === "unreadable",
            });
      const config = createNpmInstallConfig(
        pluginId,
        spec,
        installPath,
        scenario === "healthy"
          ? {
              resolvedName: packageName,
              resolvedVersion: version,
              resolvedSpec: `${packageName}@${version}`,
            }
          : {},
      );
      const plugins = expectDefined(config.plugins, "metadata failure config");
      if (scenario === "healthy") {
        plugins.allow = [pluginId, "keep"];
        plugins.deny = [pluginId, "blocked"];
        plugins.slots = { memory: pluginId, contextEngine: pluginId };
        plugins.entries = { [pluginId]: { enabled: true, config: { preserved: true } } };
      } else if (scenario === "unreadable") {
        plugins.entries = { demo: { enabled: true } };
        expectDefined(plugins.installs, "metadata failure installs").local = {
          source: "path",
          installPath: "/tmp/local",
        };
        validatePackageExtensionEntriesForInstallMock.mockImplementationOnce(() => {
          throw new Error("permission denied");
        });
      }
      const failed = { code: 1, stdout: "", stderr: "registry timeout" };
      if (scenario === "beta") {
        runCommandWithTimeoutMock.mockResolvedValue({
          ...failedNpmVersionQueryResult,
          stderr: "registry timeout",
        });
      } else {
        runCommandWithTimeoutMock.mockResolvedValueOnce(failed);
      }
      if (scenario === "fallback") {
        mockSuccessfulNpmUpdate({ pluginId, targetDir: installPath, version });
      }
      const warn = vi.fn();
      const info = vi.fn();
      const result = await updateNpmInstalledPlugins({
        config,
        pluginIds: scenario === "unreadable" ? [pluginId, "local"] : [pluginId],
        ...(scenario === "beta" ? { updateChannel: "beta" } : {}),
        ...(scenario === "healthy" || scenario === "unreadable" ? { disableOnFailure: true } : {}),
        logger: { warn, ...(scenario === "fallback" || scenario === "range" ? { info } : {}) },
      });
      if (scenario === "unreadable") {
        expect(result.config.plugins?.entries?.demo?.enabled).toBe(false);
        expect(result.outcomes.map((outcome) => outcome.pluginId)).toEqual(["demo", "local"]);
        return;
      }
      expect(warn).not.toHaveBeenCalled();
      if (scenario === "fallback") {
        expect(info).toHaveBeenCalledWith(
          "Could not check lossless-grove before update; falling back to installer path: npm view failed: registry timeout",
        );
        expect(installPluginFromNpmSpecMock).toHaveBeenCalledTimes(1);
        return;
      }
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
      if (scenario === "beta") {
        expect(result.config).toBe(config);
        expect(result.outcomes).toEqual([
          expect.objectContaining({
            pluginId,
            status: "error",
            code: "npm_metadata_failure",
            message: expect.stringContaining("registry timeout"),
          }),
        ]);
      } else {
        expect(result.outcomes).toEqual([
          {
            pluginId,
            status: "error",
            message: "Failed to check lossless-grove: npm view failed: registry timeout",
          },
        ]);
        if (scenario === "healthy") {
          expect(result.config.plugins?.entries?.[pluginId]).toEqual({
            enabled: true,
            config: { preserved: true },
          });
          expect(result.config.plugins?.allow).toEqual([pluginId, "keep"]);
          expect(result.config.plugins?.deny).toEqual([pluginId, "blocked"]);
          expect(result.config.plugins?.slots).toEqual({
            memory: pluginId,
            contextEngine: pluginId,
          });
          expect(validatePackageExtensionEntriesForInstallMock).toHaveBeenCalledTimes(1);
        }
      }
    },
  );

  it.each([
    { spec: "@acme/demo@2.0.0", updateChannel: "stable", stderr: "E404 No matching version" },
    { spec: "@acme/demo", updateChannel: "beta", stderr: "ECONNREFUSED registry unreachable" },
  ] as const)(
    "retains the installed plugin during core sync when $spec on $updateChannel fails: $stderr",
    async ({ spec, updateChannel, stderr }) => {
      const warn = vi.fn();
      const installPath = createInstalledPackageDir("@acme/demo", "1.0.0", {
        runnable: true,
      });
      const config = pluginConfig(
        {
          demo: {
            source: "npm",
            spec,
            installPath,
            version: "1.0.0",
            resolvedName: "@acme/demo",
            resolvedSpec: "@acme/demo@1.0.0",
            resolvedVersion: "1.0.0",
          },
        },
        {
          allow: ["demo"],
          entries: { demo: { enabled: true, config: { preserved: true } } },
          slots: { memory: "demo" },
        },
      );
      runCommandWithTimeoutMock.mockResolvedValue({ code: 1, stdout: "", stderr });
      installPluginFromNpmSpecMock.mockResolvedValue({
        ok: false,
        code: stderr.startsWith("E404") ? "npm_package_not_found" : "npm_metadata_failure",
        error: stderr,
      });

      const result = await updateNpmInstalledPlugins({
        config,
        pluginIds: ["demo"],
        syncOfficialPluginInstalls: true,
        retainOnUnavailable: true,
        updateChannel,
        coreVersion: "2026.9.4",
        logger: { warn },
      });

      expect(result.outcomes).toEqual([
        {
          pluginId: "demo",
          status: "unchanged",
          code: "plugin-target-unavailable",
          currentVersion: "1.0.0",
          message: expect.stringContaining('Retained "demo" at 1.0.0'),
        },
      ]);
      const message = result.outcomes[0]?.message ?? "";
      expect(message).toContain(spec);
      expect(message).toContain("2026.9.4");
      expect(message).toContain(stderr.startsWith("E404") ? "Package not found" : "ECONNREFUSED");
      expect(message).toContain("branch plugins update demo");
      expect(warn).toHaveBeenCalledWith(message);
      expect(result.config).toBe(config);
      expect(result.changed).toBe(false);
      expect(fs.readFileSync(path.join(installPath, "index.js"), "utf8")).toBe(
        "export default function register() {}\n",
      );
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    },
  );

  it.each(["damaged", "incompatible"] as const)(
    "does not override explicit failure disabling for a %s installed plugin",
    async (payload) => {
      const installPath = createInstalledPackageDir("@acme/demo", "1.0.0", {
        runnable: true,
      });
      if (payload === "damaged") {
        fs.rmSync(path.join(installPath, "index.js"));
      } else {
        writeJson(path.join(installPath, "package.json"), {
          name: "@acme/demo",
          version: "1.0.0",
          branch: { extensions: ["./index.js"], compat: { pluginApi: "<2020.1.1" } },
        });
      }
      runCommandWithTimeoutMock.mockResolvedValue({
        code: 1,
        stdout: "",
        stderr: "E404 No matching version",
      });
      installPluginFromNpmSpecMock.mockResolvedValue({
        ok: false,
        code: "npm_package_not_found",
        error: "Package not found",
      });
      const config = pluginConfig(
        { demo: { source: "npm", spec: "@acme/demo@2.0.0", installPath } },
        { entries: { demo: { enabled: true } } },
      );

      const result = await updateNpmInstalledPlugins({
        config,
        pluginIds: ["demo"],
        syncOfficialPluginInstalls: true,
        disableOnFailure: true,
        retainOnUnavailable: true,
        coreVersion: "2026.9.4",
      });

      expect(result.config.plugins?.entries?.demo?.enabled).toBe(false);
      expect(result.outcomes[0]?.status).toBe("skipped");
    },
  );

  it("skips globally disabled installs before network or capability consent", async () => {
    capabilityConsentMode.real = true;
    const onCapabilityConsent = vi.fn();
    const config = createNpmInstallConfig("demo", "@acme/demo", "/tmp/demo");
    config.plugins = { ...config.plugins, enabled: false };

    const result = await updateNpmInstalledPlugins({
      config,
      skipDisabledPlugins: true,
      onCapabilityConsent,
    });

    expect(runCommandWithTimeoutMock).not.toHaveBeenCalled();
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(onCapabilityConsent).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message: 'Skipping "demo" (plugins disabled).',
      },
    ]);
  });

  it("refreshes legacy records for disabled official npm installs during sync", async () => {
    const installPath = createInstalledPackageDir("@branch/codex", "2026.5.3");
    mockNpmViewMetadata({
      name: "@branch/codex",
      version: "2026.5.3",
      integrity: "sha512-next",
      shasum: "next",
    });
    mockSuccessfulNpmUpdate({
      pluginId: "codex",
      targetDir: installPath,
      version: "2026.5.3",
      packageName: "@branch/codex",
    });

    const result = await updateNpmInstalledPlugins({
      config: pluginConfig(
        { codex: { source: "npm", spec: "@branch/codex@2026.5.3", installPath } },
        {
          entries: { codex: { enabled: false, config: { preserved: true } } },
        },
      ),
      skipDisabledPlugins: true,
      syncOfficialPluginInstalls: true,
    });

    expect(npmInstallCall()?.spec).toBe("@branch/codex@2026.5.3");
    expect(npmInstallCall()?.expectedPluginId).toBe("codex");
    expect(npmInstallCall()?.trustedSourceLinkedOfficialInstall).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.codex).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expectRecordFields(result.config.plugins?.installs?.codex, {
      source: "npm",
      spec: "@branch/codex@2026.5.3",
      version: "2026.5.3",
      resolvedName: "@branch/codex",
      resolvedVersion: "2026.5.3",
      resolvedSpec: "@branch/codex@2026.5.3",
    });
    expectRecordFields(result.outcomes[0], {
      pluginId: "codex",
      status: "unchanged",
      currentVersion: "2026.5.3",
      nextVersion: "2026.5.3",
    });
  });

  it.each([
    {
      name: "unchanged without metadata",
      targetVersion: "1.2.3",
      status: "unchanged",
      message: "demo is up to date (1.2.3).",
      probe: false,
    },
    {
      name: "downgraded without metadata",
      targetVersion: "1.2.2",
      status: "updated",
      message: "Would downgrade demo: 1.2.3 -> 1.2.2.",
      probe: false,
    },
    {
      name: "newer registry release behind a pin",
      targetVersion: "v1.2.3",
      status: "unchanged",
      message:
        "demo is pinned to @acme/demo@v1.2.3 (installed 1.2.3); registry latest resolves to 1.2.4. Pass `branch plugins update @acme/demo@latest` to replace this version pin.",
      probe: true,
    },
  ] as const)(
    "reports exact npm dry-runs: $name",
    async ({ targetVersion, status, message, probe }) => {
      const spec = `@acme/demo@${targetVersion}`;
      const { config, installPath } = createNpmUpdateFixture({
        pluginId: "demo",
        packageName: "@acme/demo",
        installedVersion: "1.2.3",
        spec,
        ...(probe
          ? { registryVersion: "1.2.4", installerVersion: "1.2.3", installerResolvedSpec: spec }
          : {}),
      });
      if (!probe) {
        installPluginFromNpmSpecMock.mockResolvedValue({
          ok: true,
          pluginId: "demo",
          targetDir: installPath,
          extensions: ["index.ts"],
        });
      }
      const result = await updatePlugin(
        probe ? config : createNpmInstallConfig("demo", spec, installPath),
        "demo",
        {
          dryRun: true,
          ...(probe ? { syncOfficialPluginInstalls: false } : {}),
        },
      );
      expectRecordFields(result.outcomes[0], {
        pluginId: "demo",
        status,
        currentVersion: "1.2.3",
        nextVersion: probe ? "1.2.4" : targetVersion,
        message,
      });
      if (probe) {
        expect(npmInstallCall()?.spec).toBe(spec);
        expect(npmViewCall()?.[0]).toContain("@acme/demo");
      }
    },
  );

  it.each([
    {
      name: "exact version without a tag",
      selector: "2026.9.1",
      tag: undefined,
      warns: true,
      dryRun: false,
    },
    {
      name: "exact version without a tag",
      selector: "2026.9.1",
      tag: undefined,
      warns: true,
      dryRun: true,
    },
    {
      name: "matching leading-v version tag",
      selector: "v2026.9.1",
      tag: "v2026.9.1",
      warns: false,
      dryRun: true,
    },
  ])(
    "reports legacy spec-only Seedbank pin diagnostics for $name (dryRun=$dryRun)",
    async (scenario) => {
      const { dryRun } = scenario;
      const spec = `clawhub:@branch/diagnostics-otel@${scenario.selector}`;
      const installPath = createInstalledPackageDir("@branch/diagnostics-otel", "2026.9.1");
      installPluginFromClawHubMock.mockResolvedValue(
        createSuccessfulClawHubUpdateResult({
          pluginId: "diagnostics-otel",
          targetDir: installPath,
          version: "2026.9.1",
          clawhubPackage: "@branch/diagnostics-otel",
        }),
      );
      fetchClawHubPackageDetailMock.mockResolvedValue({
        package: {
          name: "@branch/diagnostics-otel",
          latestVersion: "2026.9.2",
          tags: {
            latest: "2026.9.2",
            ...(scenario.tag ? { [scenario.tag]: "2026.9.1" } : {}),
          },
        },
      });
      const config = createClawHubInstallConfig({
        pluginId: "diagnostics-otel",
        installPath,
        clawhubPackage: "@branch/diagnostics-otel",
        spec,
      });

      const record = expectDefined(
        config.plugins?.installs?.["diagnostics-otel"],
        "legacy Seedbank record",
      );
      delete record.clawhubUrl;
      delete record.clawhubChannel;
      delete record.clawhubPackage;
      const result = await updateNpmInstalledPlugins({
        config,
        dryRun,
        syncOfficialPluginInstalls: true,
      });

      expect(clawHubInstallCall()?.spec).toBe(spec);
      expect(fetchClawHubPackageDetailMock).toHaveBeenCalledWith({
        name: "@branch/diagnostics-otel",
        baseUrl: undefined,
        timeoutMs: undefined,
      });
      expectRecordFields(result.outcomes[0], {
        pluginId: "diagnostics-otel",
        status: "unchanged",
        currentVersion: "2026.9.1",
        nextVersion: scenario.warns ? "2026.9.2" : "2026.9.1",
        message: scenario.warns
          ? `diagnostics-otel is pinned to ${spec} ` +
            "(installed 2026.9.1); Seedbank latest resolves to 2026.9.2. " +
            "Pass `branch plugins install clawhub:@branch/diagnostics-otel --force` " +
            "to replace this version pin."
          : dryRun
            ? "diagnostics-otel is up to date (2026.9.1)."
            : "diagnostics-otel already at 2026.9.1.",
      });
      expect(result.config.plugins?.installs?.["diagnostics-otel"]?.spec).toBe(spec);
    },
  );

  it("disables failed plugin activation without revoking explicit policy", async () => {
    const warn = vi.fn();
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: false,
      error: "registry timeout",
    });
    const config = {
      plugins: {
        entries: {
          demo: {
            enabled: true,
            config: { preserved: true },
          },
        },
        installs: {
          demo: {
            source: "npm" as const,
            spec: "@acme/demo",
            installPath: "/tmp/demo",
          },
        },
        allow: ["demo", "other"],
        deny: ["blocked"],
        slots: {
          memory: "demo",
          contextEngine: "demo",
        },
      },
    } satisfies BranchConfig;

    const result = await updateNpmInstalledPlugins({
      config,
      skipDisabledPlugins: true,
      disableOnFailure: true,
      logger: { warn },
    });

    expect(npmInstallCall()?.spec).toBe("@acme/demo");
    expect(npmInstallCall()?.expectedPluginId).toBe("demo");
    const message =
      'Disabled "demo" after plugin update failure; Branch Agent will continue without it. Failed to update demo: registry timeout';
    expect(warn).toHaveBeenCalledWith(message);
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.entries?.demo).toEqual({
      enabled: false,
      config: { preserved: true },
    });
    expect(result.config.plugins?.allow).toEqual(["demo", "other"]);
    expect(result.config.plugins?.deny).toEqual(["blocked"]);
    expect(result.config.plugins?.slots).toBeUndefined();
    expect(result.config.plugins?.installs?.demo).toEqual(config.plugins.installs.demo);
    expect(result.outcomes).toEqual([
      {
        pluginId: "demo",
        status: "skipped",
        message,
      },
    ]);
  });

  it.each([
    "newer-blocked",
    "security-unavailable",
    "current-blocked",
    "official-blocked",
    "custom-unavailable",
  ] as const)("preserves Seedbank trust policy for %s updates", async (scenario) => {
    const official = scenario === "official-blocked" || scenario === "custom-unavailable";
    const pluginId = official ? "discord" : "demo";
    const currentVersion = official ? "2026.5.12" : "1.2.3";
    const code =
      scenario === "custom-unavailable"
        ? "artifact_unavailable"
        : scenario === "security-unavailable"
          ? "clawhub_security_unavailable"
          : "clawhub_download_blocked";
    const version = official
      ? "2026.5.16-beta.5"
      : scenario === "newer-blocked"
        ? "1.2.4"
        : "1.2.3";
    const error =
      scenario === "custom-unavailable"
        ? "artifact unavailable"
        : scenario === "security-unavailable"
          ? `Seedbank release "demo@${version}" could not be checked because Seedbank security data is unavailable. Try again later or choose a different version.`
          : "Seedbank blocked this release; update was not started.";
    const warning =
      "╭─ BLOCKED - Seedbank flagged this release as malicious ─╮\n│ • Security scan: malicious │\n╰────────────────────────────────────────────────────────╯";
    const hasWarning = scenario === "newer-blocked" || scenario === "current-blocked";
    const failure = {
      ok: false,
      code,
      error,
      ...(scenario !== "custom-unavailable" ? { version } : {}),
      ...(hasWarning ? { warning } : {}),
    };
    if (scenario === "custom-unavailable") {
      installPluginFromClawHubMock.mockResolvedValueOnce(failure);
    } else {
      installPluginFromClawHubMock.mockResolvedValue(failure);
    }
    const config = official
      ? createClawHubInstallConfig({
          pluginId,
          installPath: createInstalledPackageDir("@branch/discord", currentVersion),
          clawhubPackage: "@branch/discord",
          ...(scenario === "custom-unavailable"
            ? { clawhubUrl: "https://custom-clawhub.example" }
            : {}),
        })
      : createEnabledDemoClawHubInstallConfig();
    const warn = vi.fn();
    const result = await updatePlugin(config, pluginId, {
      ...(official ? { updateChannel: "beta" } : {}),
      ...(scenario !== "custom-unavailable" ? { disableOnFailure: true } : {}),
      ...(scenario === "current-blocked" ? { logger: { warn } } : {}),
    });
    if (official) {
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      if (scenario === "custom-unavailable") {
        expect(result.outcomes).toEqual([
          {
            pluginId,
            status: "error",
            message:
              "Failed to update discord: artifact unavailable (Seedbank clawhub:@branch/discord@beta).",
          },
        ]);
      } else {
        expect(clawHubInstallCall()?.spec).toBe("clawhub:@branch/discord@beta");
        expect(result.changed).toBe(false);
        expect(result.config).toBe(config);
        expect(result.outcomes).toMatchObject([
          { pluginId, status: "skipped", code, currentVersion },
        ]);
      }
    } else {
      const disabled = scenario === "current-blocked";
      expect(result.changed).toBe(disabled);
      expect(result.config.plugins?.entries?.demo).toEqual({
        enabled: !disabled,
        config: { preserved: true },
      });
      expect(result.config.plugins?.allow).toEqual(["demo"]);
      if (disabled) {
        expect(result.config.plugins?.slots).toBeUndefined();
        const message =
          'Disabled "demo" after plugin update failure; Branch Agent will continue without it. Failed to update demo: Seedbank blocked this release; update was not started. (Seedbank clawhub:demo).';
        expect(warn).toHaveBeenCalledWith(message);
        expect(result.outcomes).toEqual([{ pluginId, status: "skipped", message }]);
      } else {
        expect(clawHubInstallCall()?.spec).toBe("clawhub:demo");
        expect(result.config).toBe(config);
        expect(result.config.plugins?.slots?.memory).toBe("demo");
        expect(result.outcomes).toEqual([
          {
            pluginId,
            status: "skipped",
            code,
            currentVersion,
            ...(hasWarning ? { warning } : {}),
            message: `Skipped demo Seedbank update: ${error} Existing installed plugin left unchanged.`,
          },
        ]);
      }
    }
  });

  it("updates ClawHub-installed plugins via recorded package metadata", async () => {
    const updated = createSuccessfulClawHubUpdateResult({
      pluginId: "demo",
      targetDir: "/tmp/demo",
      version: "1.2.4",
      clawhubPackage: "demo",
    });
    updated.clawhub = {
      ...updated.clawhub,
      version: "1.2.3",
      npmIntegrity: "sha512-next",
      npmShasum: "1".repeat(40),
      integrity: "sha256-next",
      resolvedAt: "2026-03-22T00:00:00.000Z",
    };
    installPluginFromClawHubMock.mockResolvedValue(updated);

    const config = createClawHubInstallConfig();
    delete config.plugins?.installs?.demo?.clawhubPackage;
    config.plugins!.installs!.demo!.resolvedSpec = "clawhub:demo@1.2.3";
    delete config.plugins?.installs?.demo?.spec;
    const result = await updatePlugin(config, "demo", { timeoutMs: 1_800_000 });

    expect(clawHubInstallCall()?.spec).toBe("clawhub:demo@1.2.3");
    expect(clawHubInstallCall()?.baseUrl).toBe("https://clawhub.ai");
    expect(clawHubInstallCall()?.expectedPluginId).toBe("demo");
    expect(clawHubInstallCall()?.mode).toBe("update");
    expect(clawHubInstallCall()?.timeoutMs).toBe(1_800_000);
    expect(withClawPackageLifecycleLeaseMock).toHaveBeenCalledWith(
      { kind: "plugin", source: "clawhub", ref: "demo" },
      expect.any(Function),
      undefined,
    );
    expect(markClawPackageIndependentlyOwnedMock).toHaveBeenCalledWith({
      kind: "plugin",
      source: "clawhub",
      ref: "demo",
    });
    expectRecordFields(result.config.plugins?.installs?.demo, {
      ...updated.clawhub,
      spec: "clawhub:demo@1.2.3",
      installPath: "/tmp/demo",
      version: "1.2.4",
    });
  });

  it("records a busy Seedbank lifecycle lease as one plugin update failure", async () => {
    withClawPackageLifecycleLeaseMock.mockRejectedValueOnce(new Error("package busy"));
    const result = await updatePlugin(createClawHubInstallConfig(), "demo");

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({
        pluginId: "demo",
        status: "error",
        message: expect.stringContaining("package busy"),
      }),
    );
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
  });

  it("falls back to the default Seedbank spec when a beta release is unavailable", async () => {
    installPluginFromClawHubMock
      .mockResolvedValueOnce({
        ok: false,
        code: "version_not_found",
        error: "version not found: beta",
      })
      .mockResolvedValueOnce({
        ok: true,
        pluginId: "demo",
        targetDir: "/tmp/demo",
        version: "1.2.4",
        clawhub: {
          source: "clawhub",
          clawhubUrl: "https://clawhub.ai",
          clawhubPackage: "demo",
          clawhubFamily: "code-plugin",
          clawhubChannel: "official",
          integrity: "sha256-clawpack",
          resolvedAt: "2026-05-01T00:00:00.000Z",
        },
      });

    const infoMessages: string[] = [];
    const warn = vi.fn();
    const result = await updatePlugin(createClawHubInstallConfig(), "demo", {
      updateChannel: "beta",
      logger: { info: (msg) => infoMessages.push(msg), warn },
    });

    expect(clawHubInstallCall(0)?.spec).toBe("clawhub:demo@beta");
    expect(clawHubInstallCall(1)?.spec).toBe("clawhub:demo");
    expect(warn).not.toHaveBeenCalled();
    expect(infoMessages).toEqual([
      'Plugin "demo" has no beta Seedbank release for clawhub:demo@beta; using clawhub:demo instead. Core update can still complete.',
    ]);
    expectRecordFields(result.config.plugins?.installs?.demo, {
      source: "clawhub",
      spec: "clawhub:demo",
      installPath: "/tmp/demo",
      version: "1.2.4",
      clawhubPackage: "demo",
    });
    expect(result.outcomes[0]?.message).toBe(
      "Updated demo: unknown -> 1.2.4. (warning: beta channel fallback used clawhub:demo because clawhub:demo@beta could not be used).",
    );
  });

  it("skips Seedbank plugin updates when the bundled version is newer", async () => {
    const pluginId = "whatsapp";
    const bundledVersion = "2026.4.20";
    resolveBundledPluginSourcesMock.mockReturnValue(
      new Map([
        [
          pluginId,
          { pluginId, localPath: appBundledPluginRoot(pluginId), version: bundledVersion },
        ],
      ]),
    );
    const config = createClawHubInstallConfig({
      pluginId,
      clawhubFamily: "bundle-plugin",
      clawhubChannel: "community",
    });
    expectDefined(config.plugins?.installs?.[pluginId], "Seedbank install fixture").version =
      "2026.2.9";
    const warnings: string[] = [];
    const result = await updatePlugin(config, pluginId, {
      logger: { warn: (message) => warnings.push(message) },
    });
    expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expectRecordFields(result.outcomes[0], { pluginId, status: "skipped" });
    expect(result.outcomes[0]?.message).toContain(`bundled version ${bundledVersion} is newer`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`bundled version ${bundledVersion} is newer`);
  });

  it("migrates a manifest-declared legacy id and its config references", async () => {
    installPluginFromNpmSpecMock.mockResolvedValue({
      ok: true,
      pluginId: "fish-audio-speech",
      targetDir: "/tmp/fish-audio-speech",
      version: "0.0.2",
      extensions: ["index.ts"],
    });

    const result = await updateNpmInstalledPlugins({
      config: {
        plugins: {
          allow: ["fish-audio"],
          deny: ["fish-audio"],
          slots: { memory: "fish-audio" },
          entries: {
            "fish-audio": {
              enabled: false,
              hooks: { allowPromptInjection: false },
            },
          },
          installs: {
            "fish-audio": {
              source: "npm",
              spec: "@branch/fish-audio-speech@2026.7.2-beta.7",
              installPath: "/tmp/fish-audio",
            },
          },
        },
      },
      pluginIds: ["fish-audio"],
    });

    expect(npmInstallCall()?.spec).toBe("@branch/fish-audio-speech");
    expect(npmInstallCall()?.expectedPluginId).toBe("fish-audio");
    expect(npmInstallCall()?.expectedReplacementPluginId).toBe("fish-audio-speech");
    expect(result.config.plugins?.allow).toEqual(["fish-audio-speech"]);
    expect(result.config.plugins?.deny).toEqual(["fish-audio-speech"]);
    expect(result.config.plugins?.slots?.memory).toBe("fish-audio-speech");
    expect(result.config.plugins?.entries?.["fish-audio-speech"]).toEqual({
      enabled: false,
      hooks: { allowPromptInjection: false },
    });
    expect(result.config.plugins?.entries?.["fish-audio"]).toBeUndefined();
    expectRecordFields(result.config.plugins?.installs?.["fish-audio-speech"], {
      source: "npm",
      spec: "@branch/fish-audio-speech",
      installPath: "/tmp/fish-audio-speech",
      version: "0.0.2",
    });
    expect(result.config.plugins?.installs?.["fish-audio"]).toBeUndefined();
  });

  it("aborts a renamed official package update when its artifact differs from the catalog pin", async () => {
    const installPath = createInstalledPackageDir("@branch/qqbot", "1.9.0");
    mockNpmViewMetadata({
      name: "@tencent-connect/branch-qqbot",
      version: "2.0.3",
      integrity: "sha512-republished",
    });
    installPluginFromNpmSpecMock.mockImplementation(
      async (params: {
        expectedIntegrity?: string;
        onIntegrityDrift?: (drift: NpmInstallIntegrityDrift) => boolean | Promise<boolean>;
        spec: string;
      }) => {
        const proceed = await params.onIntegrityDrift?.({
          spec: params.spec,
          expectedIntegrity: params.expectedIntegrity!,
          actualIntegrity: "sha512-republished",
          resolution: {
            integrity: "sha512-republished",
            resolvedSpec: "@tencent-connect/branch-qqbot@2.0.3",
            version: "2.0.3",
          },
        });
        return proceed === false
          ? {
              ok: false as const,
              error:
                "aborted: npm package integrity drift detected for @tencent-connect/branch-qqbot@2.0.3",
            }
          : createSuccessfulNpmUpdateResult();
      },
    );
    const config = createNpmInstallConfig("qqbot", "@branch/qqbot@1.9.0", installPath, {
      resolvedName: "@branch/qqbot",
      resolvedSpec: "@branch/qqbot@1.9.0",
      resolvedVersion: "1.9.0",
    });
    const warn = vi.fn();

    const result = await updatePlugin(config, "qqbot", { logger: { warn } });

    expectNpmUpdateCall({
      spec: "@tencent-connect/branch-qqbot@2.0.3",
      expectedIntegrity: QQBOT_EXPECTED_INTEGRITY,
      expectedPluginId: "qqbot",
    });
    expect(npmInstallCall()?.expectedReplacementPluginId).toBe("branch-qqbot");
    expect(warn).toHaveBeenCalledWith(
      `Integrity drift for "qqbot" (@tencent-connect/branch-qqbot@2.0.3): expected ${QQBOT_EXPECTED_INTEGRITY}, got sha512-republished`,
    );
    expect(result.changed).toBe(false);
    expect(result.config).toBe(config);
    expect(result.outcomes).toEqual([
      {
        pluginId: "qqbot",
        status: "error",
        message:
          "Failed to update qqbot: aborted: npm package integrity drift detected for @tencent-connect/branch-qqbot@2.0.3",
      },
    ]);
  });

  it("does not apply the catalog pin to an explicit renamed-package override", async () => {
    mockSuccessfulNpmUpdate({
      pluginId: "branch-qqbot",
      targetDir: "/tmp/branch-qqbot",
      version: "2.0.4",
    });
    const config = createNpmInstallConfig(
      "branch-qqbot",
      "@branch/qqbot@1.9.0",
      "/tmp/branch-qqbot",
      {
        resolvedName: "@branch/qqbot",
        resolvedSpec: "@branch/qqbot@1.9.0",
        resolvedVersion: "1.9.0",
      },
    );

    const result = await updatePlugin(config, "branch-qqbot", {
      specOverrides: {
        "branch-qqbot": "@tencent-connect/branch-qqbot@2.0.4",
      },
    });

    expect(result.config.plugins?.installs?.["branch-qqbot"]?.spec).toBe(
      "@tencent-connect/branch-qqbot@2.0.4",
    );
    expectNpmUpdateCall({
      spec: "@tencent-connect/branch-qqbot@2.0.4",
      expectedPluginId: "branch-qqbot",
    });
  });

  it.each([
    "updated",
    "runnable",
    "corrupt",
    "missing",
    "failed",
    "dry-run",
    "conflicting",
  ] as const)("reconciles duplicate qqbot records after a %s canonical update", async (outcome) => {
    const canonicalInstallPath =
      outcome === "missing"
        ? path.join(makeTrackedTempDir("branch-plugin-update-missing", tempDirs), "missing")
        : ["updated", "runnable", "corrupt"].includes(outcome)
          ? createInstalledPackageDir(
              "@tencent-connect/branch-qqbot",
              outcome === "updated" ? "2.0.0" : "2.0.1",
              {
                runnable: outcome !== "corrupt",
              },
            )
          : undefined;
    const config = createDuplicateQqbotConfig({ canonicalInstallPath });
    const plugins = expectDefined(config.plugins, "duplicate config fixture");
    if (outcome === "updated") {
      plugins.slots = { contextEngine: "qqbot" };
      mockNpmViewMetadata({ name: "@tencent-connect/branch-qqbot", version: "2.0.1" });
      mockSuccessfulNpmUpdate({
        pluginId: "branch-qqbot",
        targetDir: canonicalInstallPath,
        version: "2.0.1",
        packageName: "@tencent-connect/branch-qqbot",
      });
    } else if (outcome === "failed") {
      installPluginFromNpmSpecMock.mockResolvedValue({
        ok: false,
        error: "canonical package install failed",
      });
    } else if (outcome === "dry-run") {
      mockSuccessfulNpmUpdate({
        pluginId: "branch-qqbot",
        version: "2.0.3",
        packageName: "@tencent-connect/branch-qqbot",
      });
      delete plugins.entries;
      delete plugins.installs?.qqbot?.installPath;
      delete plugins.installs?.["branch-qqbot"]?.installPath;
    } else if (outcome === "conflicting") {
      plugins.installs = {
        qqbot: {
          source: "npm",
          spec: "@branch/qqbot@1.9.0",
          resolvedName: "@branch/qqbot",
          resolvedSpec: "@branch/qqbot@1.9.0",
        },
        "branch-qqbot": {
          source: "npm",
          spec: "@vendor/branch-qqbot@1.0.0",
          resolvedName: "@tencent-connect/branch-qqbot",
          resolvedSpec: "@vendor/branch-qqbot@1.0.0",
        },
      };
    }
    if (outcome === "updated" || outcome === "runnable") {
      validatePackageExtensionEntriesForInstallMock.mockResolvedValueOnce({ ok: true });
    }
    const skipped = outcome === "runnable" || outcome === "corrupt" || outcome === "missing";
    const result = await updateNpmInstalledPlugins({
      config,
      ...(skipped ? { pluginIds: ["qqbot"], skipIds: new Set(["branch-qqbot"]) } : {}),
      ...(outcome === "dry-run" ? { pluginIds: ["qqbot"], dryRun: true } : {}),
      ...(outcome === "conflicting" ? { pluginIds: ["qqbot"] } : {}),
      ...(outcome === "failed" ? { disableOnFailure: true } : {}),
    });
    if (skipped) {
      const removesAlias = outcome === "runnable";
      expect(result.changed).toBe(removesAlias);
      expect(result.config.plugins?.installs?.qqbot === undefined).toBe(removesAlias);
      expect(resolvePluginInstallOwnerMigrations(result)).toEqual(
        removesAlias ? { qqbot: "branch-qqbot" } : undefined,
      );
    } else if (outcome === "updated") {
      expect(result.config.plugins?.slots?.contextEngine).toBe("branch-qqbot");
      expectNpmUpdateCall({
        spec: "@tencent-connect/branch-qqbot@2.0.1",
        expectedPluginId: "branch-qqbot",
      });
      expect(result.outcomes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            pluginId: "qqbot",
            status: "skipped",
            message:
              'Removed duplicate "qqbot" install record; "branch-qqbot" is the canonical plugin id.',
          }),
        ]),
      );
      expect(result.config.plugins?.installs?.qqbot).toBeUndefined();
      expectRecordFields(result.config.plugins?.installs?.["branch-qqbot"], {
        source: "npm",
        spec: "@tencent-connect/branch-qqbot@2.0.1",
        installPath: canonicalInstallPath,
        version: "2.0.1",
      });
      expect(resolvePluginInstallOwnerMigrations(result)).toEqual({ qqbot: "branch-qqbot" });
    } else {
      expect(resolvePluginInstallOwnerMigrations(result)).toBeUndefined();
      if (outcome === "failed") {
        expect(result.config.plugins?.installs?.qqbot).toBeDefined();
        expect(result.outcomes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              pluginId: "qqbot",
              message:
                'Kept duplicate "qqbot" install record because "branch-qqbot" did not complete a runnable canonical update.',
            }),
          ]),
        );
      } else {
        expect(result.changed).toBe(false);
        expect(result.config.plugins?.installs).toEqual(plugins.installs);
        if (outcome === "dry-run") {
          expect(result.outcomes).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                pluginId: "qqbot",
                status: "skipped",
                message:
                  'Would remove duplicate "qqbot" install record; "branch-qqbot" is the canonical plugin id.',
              }),
            ]),
          );
        } else {
          expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
          expect(result.config).toBe(config);
          expect(result.config.plugins?.entries).toEqual(plugins.entries);
          expect(result.outcomes).toEqual([
            {
              pluginId: "qqbot",
              status: "error",
              message:
                'Cannot replace "qqbot" with "branch-qqbot" because both plugin install records exist. Remove one of the conflicting installs, then retry the update.',
            },
          ]);
        }
      }
    }
  });

  it.each(["marketplace", "git"] as const)(
    "updates %s installs and preserves source metadata",
    async (source) => {
      const git = source === "git";
      const pluginId = git ? "demo" : "claude-bundle";
      const installPath = git ? createInstalledPackageDir("demo", "1.3.0") : "/tmp/claude-bundle";
      const marketplace = {
        marketplaceName: "Vincent's Claude Plugins",
        marketplaceSource: "vincentkoc/claude-marketplace",
        marketplacePlugin: "claude-bundle",
      };
      const gitMetadata = {
        url: "https://github.com/acme/demo.git",
        ref: "main",
        commit: "def456",
        resolvedAt: "2026-04-30T00:00:00.000Z",
      };
      (git ? installPluginFromGitSpecMock : installPluginFromMarketplaceMock).mockResolvedValue({
        ok: true,
        pluginId,
        targetDir: installPath,
        version: "1.3.0",
        extensions: ["index.ts"],
        ...(git ? { git: gitMetadata } : marketplace),
      });
      const spec = "git:github.com/acme/demo@main";
      const result = await updatePlugin(
        pluginConfig({
          [pluginId]: {
            source,
            installPath,
            ...(git ? { spec, gitCommit: "abc123" } : marketplace),
          },
        }),
        pluginId,
      );
      expect(result.changed).toBe(true);
      expectRecordFields(result.config.plugins?.installs?.[pluginId], {
        source,
        installPath,
        version: "1.3.0",
        ...(git
          ? {
              spec,
              gitUrl: gitMetadata.url,
              gitRef: gitMetadata.ref,
              gitCommit: gitMetadata.commit,
            }
          : marketplace),
      });
      if (git) {
        expect(gitInstallCall()?.spec).toBe(spec);
        expect(gitInstallCall()?.expectedPluginId).toBe("demo");
        expect(gitInstallCall()?.mode).toBe("update");
        expect(result.outcomes).toEqual([
          {
            pluginId: "demo",
            status: "updated",
            currentVersion: "1.3.0",
            nextVersion: "1.3.0",
            message: "Updated demo: 1.3.0 -> 1.3.0.",
          },
        ]);
      }
    },
  );
});

describe("syncPluginsForUpdateChannel", () => {
  beforeEach(() => {
    installPluginFromNpmSpecMock.mockReset();
    installPluginFromClawHubMock.mockReset();
    installPluginFromGitSpecMock.mockReset();
    resolveBundledPluginSourcesMock.mockReset();
    runCommandWithTimeoutMock.mockReset();
  });

  it.each([false, true])(
    "reconciles bundled paths using the provided env: %s",
    async (homeRelative) => {
      const bundledHome = homeRelative
        ? makeTrackedTempDir("branch-plugin-update-home", tempDirs)
        : undefined;
      const bundledPath = homeRelative
        ? `${bundledHome}/plugins/feishu`
        : appBundledPluginRoot("feishu");
      const recordedPath = homeRelative ? "~/plugins/feishu" : bundledPath;
      mockBundledSources(createBundledSource("feishu", bundledPath));
      await withEnvAsync(
        { HOME: homeRelative ? "/tmp/process-home" : process.env.HOME },
        async () => {
          const result = await syncPluginsForUpdateChannel({
            channel: "beta",
            ...(homeRelative
              ? { env: { BRANCH_HOME: bundledHome, HOME: "/tmp/ignored-home" } }
              : {}),
            config: pluginConfig(
              {
                feishu: {
                  source: "path",
                  sourcePath: recordedPath,
                  installPath: homeRelative ? recordedPath : "/tmp/old-feishu",
                  spec: "@branch/feishu",
                },
              },
              { load: { paths: homeRelative ? [recordedPath] : [] } },
            ),
          });
          expect(result.changed).toBe(!homeRelative);
          expect(result.config.plugins?.load?.paths).toEqual([recordedPath]);
          expectRecordFields(result.config.plugins?.installs?.feishu, {
            source: "path",
            sourcePath: recordedPath,
            installPath: recordedPath,
            ...(!homeRelative ? { spec: "@branch/feishu" } : {}),
          });
          if (!homeRelative) {
            expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
            expect(result.summary.switchedToNpm).toStrictEqual([]);
          }
        },
      );
    },
  );

  it.each(["renamed", "default-enabled"] as const)(
    "externalizes a %s bundled plugin",
    async (mode) => {
      const renamed = mode === "renamed";
      const oldId = renamed ? "qqbot" : "legacy-chat";
      const pluginId = renamed ? "branch-qqbot" : oldId;
      const spec = renamed ? "@tencent-connect/branch-qqbot@2.0.1" : "@branch/legacy-chat";
      const version = renamed ? "2.0.1" : "2.0.0";
      const installPath = `/tmp/branch-plugins/${pluginId}`;
      resolveBundledPluginSourcesMock.mockReturnValue(new Map());
      mockSuccessfulNpmUpdate({ pluginId, targetDir: installPath, version });
      const result = await syncExternalizedPlugin({
        config: renamed
          ? createExternalizedPluginConfig({ pluginId: oldId, entryEnabled: true })
          : {},
        bridge: {
          bundledPluginId: oldId,
          pluginId,
          npmSpec: spec,
          channelIds: [oldId],
          ...(renamed
            ? { expectedIntegrity: "sha512-qqbot-catalog-pin" }
            : { enabledByDefault: true }),
        },
      });
      expect(result.summary.switchedToNpm).toEqual([pluginId]);
      expectRecordFields(result.config.plugins?.installs?.[pluginId], {
        source: "npm",
        spec,
        installPath,
        version,
      });
      if (renamed) {
        expect(npmInstallCall()?.expectedPluginId).toBe("branch-qqbot");
        expect(npmInstallCall()?.expectedIntegrity).toBe("sha512-qqbot-catalog-pin");
        expect(result.config.plugins?.entries?.qqbot).toBeUndefined();
        expect(result.config.plugins?.entries?.["branch-qqbot"]).toEqual({ enabled: true });
        expect(result.config.plugins?.installs?.qqbot).toBeUndefined();
      } else {
        expect(result.changed).toBe(true);
      }
    },
  );

  it.each(["npm", "clawhub", "source-fallback"] as const)(
    "selects npm releases before install and retains Seedbank fallback during %s externalization",
    async (source) => {
      resolveBundledPluginSourcesMock.mockReturnValue(new Map());
      const pluginId = "diagnostics-otel";
      const npmSpec = "@branch/diagnostics-otel";
      const clawhubSpec = `clawhub:${npmSpec}`;
      const coreVersion = "2026.8.1-beta.3";
      const clawhubBetaSpec = `${clawhubSpec}@beta`;
      if (source !== "clawhub") {
        mockNpmViewMetadata({ name: npmSpec, version: "2026.7.1-beta.1" });
        mockNpmViewMetadata({ name: npmSpec, version: "2026.8.0" });
      }
      const attempts: Array<{ spec: string; expectedIntegrity?: string }> = [];
      installPluginFromNpmSpecMock.mockImplementation(
        async ({ spec, expectedIntegrity }: { spec: string; expectedIntegrity?: string }) => {
          attempts.push({ spec, expectedIntegrity });
          return source === "source-fallback"
            ? { ok: false, code: "npm_package_not_found", error: "target unavailable" }
            : createSuccessfulNpmUpdateResult({
                pluginId,
                targetDir: `/tmp/branch-plugins/${pluginId}`,
                version: "2026.8.0",
              });
        },
      );
      installPluginFromClawHubMock.mockImplementation(async ({ spec }: { spec: string }) => {
        attempts.push({ spec });
        return spec !== clawhubSpec
          ? { ok: false, code: "version_not_found", error: "beta unavailable" }
          : createSuccessfulClawHubUpdateResult({
              pluginId,
              targetDir: `/tmp/branch-plugins/${pluginId}`,
              version: "2026.8.0",
              clawhubPackage: npmSpec,
            });
      });

      const result = await syncExternalizedPlugin({
        channel: "beta",
        coreVersion,
        bridge: {
          bundledPluginId: pluginId,
          npmSpec: source === "clawhub" ? undefined : npmSpec,
          clawhubSpec: source === "npm" ? undefined : clawhubSpec,
          expectedIntegrity: "sha512-catalog-default",
          channelIds: [pluginId],
        },
        config: createExternalizedPluginConfig({ pluginId }),
      });

      expect(result.summary.errors).toEqual([]);
      expect(attempts).toEqual([
        ...(source === "clawhub"
          ? []
          : [{ spec: `${npmSpec}@2026.8.0`, expectedIntegrity: undefined }]),
        ...(source === "npm" ? [] : [{ spec: clawhubBetaSpec }, { spec: clawhubSpec }]),
      ]);
      expect(result.config.plugins?.installs?.[pluginId]).toMatchObject({
        source: source === "npm" ? "npm" : "clawhub",
        spec: source === "npm" ? npmSpec : clawhubSpec,
        version: "2026.8.0",
      });
      expect(result.config.plugins?.load?.paths).toEqual([]);
      if (source === "npm") {
        expect(result.summary.warnings).toEqual([]);
      } else {
        expect(result.summary.warnings.join("\n")).toContain(clawhubBetaSpec);
      }
    },
  );

  it.each(["npm", "clawhub"] as const)(
    "leaves configuration unchanged after a failed %s externalization",
    async (source) => {
      resolveBundledPluginSourcesMock.mockReturnValue(new Map());
      const clawhub = source === "clawhub";
      const code = clawhub ? "archive_integrity_mismatch" : "npm_package_not_found";
      const warning = "WARNING\nSecurity scan: suspicious";
      const config = createExternalizedPluginConfig();
      (clawhub ? installPluginFromClawHubMock : installPluginFromNpmSpecMock).mockResolvedValue({
        ok: false,
        code,
        error: clawhub ? "Seedbank ClawPack integrity mismatch." : "package unavailable",
        ...(clawhub ? { warning } : {}),
      });
      const result = await syncExternalizedPlugin({
        config,
        ...(clawhub
          ? { bridge: { npmSpec: undefined, clawhubSpec: "clawhub:legacy-chat@2026.5.1-beta.2" } }
          : {}),
      });
      if (clawhub) {
        expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
        expect(result.summary.warnings).toEqual([warning]);
      }
      expect(result.changed).toBe(false);
      expect(result.config).toBe(config);
      expect(result.summary.errors).toEqual([
        {
          pluginId: "legacy-chat",
          code,
          message:
            (clawhub
              ? "Failed to update legacy-chat: Seedbank ClawPack integrity mismatch. (Seedbank clawhub:legacy-chat@2026.5.1-beta.2)."
              : "Failed to update legacy-chat: npm package not found for @branch/legacy-chat.") +
            '\nBundled relocation did not install the replacement plugin payload; resolve the error above, then run "branch update repair".',
        },
      ]);
    },
  );

  it.each(["disabled", "custom-path", "still-bundled"] as const)(
    "does not externalize a %s plugin",
    async (reason) => {
      resolveBundledPluginSourcesMock.mockReturnValue(new Map());
      if (reason === "still-bundled") {
        mockBundledSources(createBundledSource("legacy-chat"));
      }
      const customPath = "/workspace/plugins/legacy-chat";
      const result = await syncExternalizedPlugin({
        config: createExternalizedPluginConfig(
          reason === "disabled"
            ? { channelEnabled: false, entryEnabled: false }
            : reason === "custom-path"
              ? {
                  loadPaths: [customPath],
                  install: { source: "path", sourcePath: customPath, installPath: customPath },
                }
              : undefined,
        ),
      });
      expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
      expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], {
        source: "path",
        ...(reason === "custom-path" ? { sourcePath: customPath } : {}),
      });
    },
  );

  it("migrates already-externalized records to prototype-named plugin id __proto__", async () => {
    const targetPluginId = "__proto__";
    const legacyPluginId = `legacy-${targetPluginId}`;
    const npmPackageName = `branch-plugin-${targetPluginId}`;
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());

    const result = await syncPluginsForUpdateChannel({
      channel: "stable",
      externalizedBundledPluginBridges: [
        {
          bundledPluginId: legacyPluginId,
          pluginId: targetPluginId,
          npmSpec: npmPackageName,
          channelIds: [],
        },
      ],
      config: {
        plugins: {
          entries: {
            [legacyPluginId]: { enabled: true },
          },
          installs: {
            [legacyPluginId]: {
              source: "npm",
              spec: npmPackageName,
              installPath: `/tmp/${targetPluginId}`,
            },
          },
        },
      },
    });

    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(Object.hasOwn(result.config.plugins?.entries ?? {}, targetPluginId)).toBe(true);
    expect(Object.getPrototypeOf(result.config.plugins?.entries ?? {})).toBe(Object.prototype);
    expect(result.config.plugins?.entries?.[targetPluginId]).toEqual({ enabled: true });
    expect(Object.hasOwn(result.config.plugins?.installs ?? {}, targetPluginId)).toBe(true);
    expect(Object.getPrototypeOf(result.config.plugins?.installs ?? {})).toBe(Object.prototype);
    expectRecordFields(result.config.plugins?.installs?.[targetPluginId], {
      source: "npm",
      spec: npmPackageName,
      installPath: `/tmp/${targetPluginId}`,
    });
    expect(result.config.plugins?.entries?.[legacyPluginId]).toBeUndefined();
    expect(result.config.plugins?.installs?.[legacyPluginId]).toBeUndefined();
  });

  it.each([
    {
      name: "removes stale bundled load paths for already-externalized resolved-name-only npm installs",
      install: {
        source: "npm",
        resolvedName: "@branch/legacy-chat",
        installPath: "/tmp/branch-plugins/legacy-chat",
      },
      expectedInstall: { source: "npm", resolvedName: "@branch/legacy-chat" },
      bridge: {},
      expectClawHubNotCalled: false,
    },
    {
      name: "removes stale bundled load paths for already-externalized pinned Seedbank installs",
      install: {
        source: "clawhub",
        spec: "clawhub:legacy-chat@2026.5.1",
        clawhubPackage: "legacy-chat",
        installPath: "/tmp/branch-plugins/legacy-chat",
      },
      expectedInstall: { source: "clawhub", spec: "clawhub:legacy-chat@2026.5.1" },
      bridge: { clawhubSpec: "clawhub:legacy-chat" },
      expectClawHubNotCalled: true,
    },
  ] as const)("$name", async ({ install, expectedInstall, bridge, expectClawHubNotCalled }) => {
    resolveBundledPluginSourcesMock.mockReturnValue(new Map());

    const result = await syncExternalizedPlugin({
      bridge,
      config: createExternalizedPluginConfig({
        loadPaths: [appBundledPluginRoot("legacy-chat"), "/workspace/plugins/other"],
        install,
      }),
    });

    if (expectClawHubNotCalled) {
      expect(installPluginFromClawHubMock).not.toHaveBeenCalled();
    }
    expect(installPluginFromNpmSpecMock).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(result.config.plugins?.load?.paths).toEqual(["/workspace/plugins/other"]);
    expectRecordFields(result.config.plugins?.installs?.["legacy-chat"], expectedInstall);
  });
});
/* oxlint-disable max-lines -- TODO: split this grandfathered oversized file. */
