import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../../../config/types.branch.js";
import { resetPluginRuntimeStateForTest } from "../../../plugins/runtime.js";

vi.mock("../../../plugins/setup-registry.js", () => ({
  resolvePluginSetupCliBackend: () => undefined,
  resolvePluginSetupRegistry: () => ({
    providers: [],
    cliBackends: [],
    configMigrations: [],
    autoEnableProbes: [],
    diagnostics: [],
  }),
  runPluginSetupConfigMigrations: ({ config }: { config: BranchConfig }) => ({
    config,
    changes: [],
  }),
}));

vi.mock("../../../plugins/manifest-registry.js", () => {
  const plugin = (id: string, webSearchProvider: string) => {
    const rootDir = `/plugins/${id}`;
    return {
      id,
      origin: "bundled",
      channels: [],
      providers: [],
      cliBackends: [],
      skills: [],
      hooks: [],
      contracts: { webSearchProviders: [webSearchProvider] },
      rootDir,
      source: `${rootDir}/index.ts`,
      manifestPath: `${rootDir}/branch.plugin.json`,
    };
  };
  return {
    loadPluginManifestRegistryCore: () => ({
      diagnostics: [],
      plugins: [
        plugin("brave", "brave"),
        plugin("google", "gemini"),
        plugin("firecrawl", "firecrawl"),
      ],
    }),
    resolveManifestContractOwnerPluginId: ({ value }: { value: string }): string | undefined => {
      if (value === "gemini") {
        return "google";
      }
      return value === "brave" || value === "firecrawl" ? value : undefined;
    },
  };
});

vi.mock("./channel-legacy-config-migrate.js", () => ({
  applyChannelDoctorCompatibilityMigrations: (cfg: BranchConfig) => ({
    next: cfg,
    changes: [],
  }),
}));

vi.mock("../../../secrets/target-registry.js", async () => {
  const { asNullableRecord: readRecord } =
    await import("@branch/normalization-core/record-coerce");
  const entry = {
    id: "channels.discord.token",
    targetType: "channels.discord.token",
    configFile: "branch.json",
    pathPattern: "channels.discord.token",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  };

  return {
    discoverConfigSecretTargets: (cfg: BranchConfig) => {
      const targets: Array<{
        entry: typeof entry;
        path: string;
        pathSegments: string[];
        value: unknown;
        accountId?: string;
      }> = [];
      const channels = readRecord(cfg.channels);
      const discord = readRecord(channels?.discord);
      if (!discord) {
        return targets;
      }
      targets.push({
        entry,
        path: "channels.discord.token",
        pathSegments: ["channels", "discord", "token"],
        value: discord.token,
      });

      const accounts = readRecord(discord.accounts);
      for (const [accountId, accountConfig] of Object.entries(accounts ?? {})) {
        const account = readRecord(accountConfig);
        if (!account) {
          continue;
        }
        targets.push({
          entry,
          path: `channels.discord.accounts.${accountId}.token`,
          pathSegments: ["channels", "discord", "accounts", accountId, "token"],
          value: account.token,
          accountId,
        });
      }
      return targets;
    },
  };
});

export function legacyConfig(value: unknown): BranchConfig {
  return value as BranchConfig;
}

export function useDoctorLegacyConfigFixture() {
  let previousOauthDir: string | undefined;
  let tempOauthDir = "";
  const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
    afterAll(() => {
      if (previousOauthDir === undefined) {
        delete process.env.BRANCH_OAUTH_DIR;
      } else {
        process.env.BRANCH_OAUTH_DIR = previousOauthDir;
      }
      cleanup();
    }),
  );

  beforeAll(() => {
    previousOauthDir = process.env.BRANCH_OAUTH_DIR;
    tempOauthDir = tempDirs.make("branch-oauth-");
    process.env.BRANCH_OAUTH_DIR = tempOauthDir;
  });

  beforeEach(() => {
    resetPluginRuntimeStateForTest();
    fs.rmSync(tempOauthDir, { recursive: true, force: true });
    fs.mkdirSync(tempOauthDir, { recursive: true });
  });

  return {
    get oauthDir() {
      return tempOauthDir;
    },
  };
}
