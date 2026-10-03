import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import { runPluginUpdateCommand } from "../../../cli/plugins-update-command.js";
import type { BranchConfig } from "../../../config/types.branch.js";
import type { PluginInstallRecord } from "../../../config/types.plugins.js";
import {
  filterRecordsToActive,
  runActivePluginPayloadSmokeCheck,
} from "../../../plugins/active-payload-verification.js";
import { resolvePluginNpmGenerationProjectDir } from "../../../plugins/install-paths.js";
import { readPersistedInstalledPluginIndexInstallRecords } from "../../../plugins/installed-plugin-index-records.js";
import { loadPluginManifestRegistryCore } from "../../../plugins/manifest-registry.js";
import { createPluginCache, withPluginCache } from "../../../plugins/plugin-cache.js";
import { seedInstalledPluginIndex } from "../../../plugins/test-helpers/installed-plugin-index.js";
import { convergePluginReleaseCohort } from "../../../plugins/update-cohort.js";
import { closeBranchStateDatabaseByPath } from "../../../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../../../state/branch-state-db.paths.js";
import { runPostCorePluginConvergence } from "./post-core-plugin-convergence.js";

const mocks = vi.hoisted(() => ({
  hostRoot: "",
  getRuntimeConfig: vi.fn<() => BranchConfig>(),
  log: vi.fn(),
  error: vi.fn(),
  resolveNpmSpecMetadata:
    vi.fn<typeof import("../../../infra/install-source-utils.js").resolveNpmSpecMetadata>(),
  installPluginFromNpmSpec:
    vi.fn<typeof import("../../../plugins/install.js").installPluginFromNpmSpec>(),
}));

vi.mock("../../../config/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../config/config.js")>()),
  getRuntimeConfig: mocks.getRuntimeConfig,
}));

vi.mock("../../../runtime.js", () => ({
  defaultRuntime: {
    log: mocks.log,
    error: mocks.error,
    exit: (code: number) => {
      throw new Error(`CLI exited with ${code}: ${mocks.error.mock.lastCall?.join(" ")}`);
    },
  },
}));

vi.mock("../../../infra/branch-root.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/branch-root.js")>()),
  resolveBranchPackageRootSync: () => mocks.hostRoot,
  resolveBranchPackageRoot: async () => mocks.hostRoot,
}));

vi.mock("../../../infra/install-source-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../infra/install-source-utils.js")>()),
  resolveNpmSpecMetadata: mocks.resolveNpmSpecMetadata,
}));

vi.mock("../../../plugins/install.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/install.js")>()),
  installPluginFromNpmSpec: mocks.installPluginFromNpmSpec,
}));

const HOST_VERSION = "2026.9.4";
const NEW_EXPORT = "registerNativeHookRelayForBundledRuntime";
const OLD_EXPORT = "registerRetainedNativeHookRelayForBundledRuntime";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function writeCodexPackage(params: {
  root: string;
  hostRoot: string;
  version: string;
  sdkExport: string;
}): string {
  writeJson(path.join(params.root, "package.json"), {
    name: "@branch/codex",
    version: params.version,
    type: "module",
    peerDependencies: { branch: ">=2026.9.4" },
    branch: {
      extensions: ["./dist/index.js"],
      install: { npmSpec: "@branch/codex", defaultChoice: "npm" },
      compat: { pluginApi: ">=2026.9.4" },
      build: { branchVersion: HOST_VERSION },
    },
  });
  writeJson(path.join(params.root, "branch.plugin.json"), {
    id: "codex",
    version: params.version,
    configSchema: { type: "object" },
  });
  const entry = path.join(params.root, "dist", "index.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(
    entry,
    `import { ${params.sdkExport} } from "branch/plugin-sdk/native-hook-relay-runtime";
export function runTurn() { return ${params.sdkExport}(); }
export default { id: "codex", register() {} };
`,
  );
  fs.mkdirSync(path.join(params.root, "node_modules"), { recursive: true });
  fs.symlinkSync(
    params.hostRoot,
    path.join(params.root, "node_modules", "branch"),
    process.platform === "win32" ? "junction" : "dir",
  );
  return entry;
}

function importAndRun(entry: string, env: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const plugin = await import(process.argv[1]); process.stdout.write(plugin.runTurn());",
      pathToFileURL(entry).href,
    ],
    { encoding: "utf8", env: { ...env, PATH: process.env.PATH } },
  );
}

describe("post-core convergence on source checkouts", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { version: "2026.9.3", selector: true, corrupt: false, flow: "doctor" },
    { version: HOST_VERSION, selector: false, corrupt: true, flow: "doctor" },
    ...["cli named", "cli all", "stable"].map((flow) => ({
      version: HOST_VERSION,
      selector: false,
      corrupt: false,
      flow,
    })),
  ])(
    "keeps the rebuilt plugin with npm $version (selector=$selector, corrupt=$corrupt, flow=$flow)",
    async ({ version, selector, corrupt, flow }) => {
      const root = tempDirs.make("branch-source-convergence-");
      const hostRoot = path.join(root, "host");
      const stateDir = path.join(root, "state");
      const bundledDir = path.join(hostRoot, "dist", "extensions", "codex");
      mocks.hostRoot = hostRoot;
      writeJson(path.join(hostRoot, "package.json"), {
        name: "branch",
        version: HOST_VERSION,
        type: "module",
        exports: {
          "./plugin-sdk/native-hook-relay-runtime":
            "./dist/plugin-sdk/native-hook-relay-runtime.js",
        },
      });
      fs.mkdirSync(path.join(hostRoot, "src"), { recursive: true });
      fs.mkdirSync(path.join(hostRoot, "extensions"), { recursive: true });
      fs.writeFileSync(path.join(hostRoot, "pnpm-workspace.yaml"), "packages: []\n");
      const sdkDir = path.join(hostRoot, "dist", "plugin-sdk");
      fs.mkdirSync(sdkDir, { recursive: true });
      fs.writeFileSync(
        path.join(sdkDir, "native-hook-relay-runtime.js"),
        `export function ${NEW_EXPORT}() { return "synthetic turn completed"; }\n`,
      );
      writeCodexPackage({
        root: bundledDir,
        hostRoot,
        version: HOST_VERSION,
        sdkExport: NEW_EXPORT,
      });
      const npmRoot = resolvePluginNpmGenerationProjectDir({
        npmDir: path.join(stateDir, "npm"),
        packageName: "@branch/codex",
        generationKey: `@branch/codex@${version}`,
      });
      writeJson(path.join(npmRoot, "package.json"), {
        dependencies: { "@branch/codex": version },
      });
      const npmDir = path.join(npmRoot, "node_modules", "@branch", "codex");
      const npmEntry = writeCodexPackage({
        root: npmDir,
        hostRoot,
        version,
        sdkExport: OLD_EXPORT,
      });
      const env: NodeJS.ProcessEnv = {
        HOME: root,
        BRANCH_HOME: root,
        BRANCH_STATE_DIR: stateDir,
        BRANCH_VERSION: HOST_VERSION,
        BRANCH_COMPATIBILITY_HOST_VERSION: HOST_VERSION,
        BRANCH_BUNDLED_PLUGINS_DIR: path.dirname(bundledDir),
        BRANCH_DISABLE_BUNDLED_PLUGINS: undefined,
        BRANCH_TEST_TRUST_BUNDLED_PLUGINS_DIR: "1",
        BRANCH_DEV_SOURCE_ROOT: selector ? hostRoot : undefined,
      };
      for (const [key, value] of Object.entries(env)) {
        vi.stubEnv(key, value);
      }
      const cfg: BranchConfig = {
        update: { channel: "dev" },
        plugins: { allow: ["codex"], entries: { codex: { enabled: true } } },
      };
      mocks.getRuntimeConfig.mockReturnValue(cfg);
      const records: Record<string, PluginInstallRecord> = {
        codex: {
          source: "npm",
          spec: "@branch/codex",
          installPath: npmDir,
          version,
          resolvedName: "@branch/codex",
          resolvedVersion: version,
          resolvedSpec: `@branch/codex@${version}`,
        },
      };
      const metadata = {
        name: "@branch/codex",
        version: HOST_VERSION,
        resolvedSpec: `@branch/codex@${HOST_VERSION}`,
      };
      mocks.resolveNpmSpecMetadata.mockResolvedValue({ ok: true, metadata });
      mocks.installPluginFromNpmSpec.mockResolvedValue({
        ok: true,
        pluginId: "codex",
        targetDir: npmDir,
        version: HOST_VERSION,
        extensions: ["./dist/index.js"],
        npmResolution: metadata,
      });

      try {
        await withPluginCache(createPluginCache(), async () => {
          const published = importAndRun(npmEntry, env);
          expect(published.status).not.toBe(0);
          expect(published.stderr).toMatch(
            new RegExp(
              `(?:does not provide an export named '${OLD_EXPORT}'|Export named '${OLD_EXPORT}' not found in module)`,
            ),
          );
          await seedInstalledPluginIndex(records, { config: cfg, env });
        });
        if (corrupt) {
          fs.writeFileSync(path.join(npmDir, "package.json"), "{invalid package json");
        }
        const npmPackageBefore = fs.readFileSync(path.join(npmDir, "package.json"), "utf8");

        await withPluginCache(createPluginCache(), async () => {
          const result = await runPostCorePluginConvergence({
            cfg,
            env,
            compatibilityHostVersion: HOST_VERSION,
          });
          expect.soft(mocks.resolveNpmSpecMetadata).not.toHaveBeenCalled();
          expect.soft(mocks.installPluginFromNpmSpec).not.toHaveBeenCalled();
          expect.soft(result.installRecords).toEqual(records);
          expect.soft(result.errored).toBe(false);
          expect.soft(result.smokeFailures).toEqual([]);
          expect.soft(result.warnings).toEqual([]);
          expect.soft(result.outcomes).toContainEqual(
            expect.objectContaining({
              pluginId: "codex",
              status: "unchanged",
              code: "source-bundled-plugin",
            }),
          );
          expect.soft(result.changes.join("\n")).not.toContain("Refreshed stale configured plugin");
          expect
            .soft(fs.readFileSync(path.join(npmDir, "package.json"), "utf8"))
            .toBe(npmPackageBefore);
          expect.soft(readPersistedInstalledPluginIndexInstallRecords({ env })).toEqual(records);
          const registry = loadPluginManifestRegistryCore({ config: cfg, env });
          const selected = registry.plugins.find((plugin) => plugin.id === "codex");
          expect.soft(selected).toMatchObject({ origin: "bundled", rootDir: bundledDir });
          if (!selected) {
            throw new Error("Codex disappeared during source checkout convergence");
          }
          const loaded = importAndRun(selected.source, env);
          expect.soft(loaded.status, loaded.stderr).toBe(0);
          expect.soft(loaded.stdout).toBe("synthetic turn completed");
          const startup = await runActivePluginPayloadSmokeCheck({ cfg, records, env });
          expect(startup.failures).toEqual([]);
          if (flow === "cli named" || flow === "cli all") {
            await runPluginUpdateCommand({
              ids: flow === "cli named" ? ["codex"] : [],
              opts: { all: flow === "cli all", dryRun: true },
            });
            expect(mocks.error).not.toHaveBeenCalled();
            expect(mocks.log.mock.calls.flat().join("\n")).toContain('Kept bundled plugin "codex"');
          } else if (flow === "stable") {
            const cohort = await convergePluginReleaseCohort({
              config: { ...cfg, plugins: { ...cfg.plugins, installs: records } },
              channel: flow,
              coreVersion: HOST_VERSION,
              timeoutMs: 60_000,
              env,
            });
            expect(cohort.config.plugins?.installs).toEqual(records);
            expect(cohort.updateOutcomes).toContainEqual(
              expect.objectContaining({ pluginId: "codex", code: "source-bundled-plugin" }),
            );
          }
          expect(mocks.resolveNpmSpecMetadata).not.toHaveBeenCalled();
          expect(mocks.installPluginFromNpmSpec).not.toHaveBeenCalled();
          if (version === HOST_VERSION && !selector && !corrupt) {
            const override = path.join(root, "selected-plugin");
            fs.symlinkSync(npmDir, override, process.platform === "win32" ? "junction" : "dir");
            const selectedConfig: BranchConfig = {
              ...cfg,
              plugins: { ...cfg.plugins, load: { paths: [override] } },
            };
            expect(filterRecordsToActive({ cfg: selectedConfig, records, env })).toEqual(records);
            const sourceOnlyDir = path.join(hostRoot, "extensions", "codex");
            writeCodexPackage({
              root: sourceOnlyDir,
              hostRoot,
              version: HOST_VERSION,
              sdkExport: NEW_EXPORT,
            });
            withPluginCache(createPluginCache(), () => {
              const sourceOnlyRegistry = loadPluginManifestRegistryCore({
                config: cfg,
                env: { ...env, BRANCH_BUNDLED_PLUGINS_DIR: path.dirname(sourceOnlyDir) },
                installRecords: records,
              });
              expect(
                sourceOnlyRegistry.plugins.find((plugin) => plugin.id === "codex"),
              ).toMatchObject({
                origin: "global",
                rootDir: npmDir,
              });
            });
          }
        });
      } finally {
        closeBranchStateDatabaseByPath(resolveBranchStateSqlitePath(env));
      }
    },
  );
});
