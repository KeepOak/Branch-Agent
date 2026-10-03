// Provides config test helpers for temporary homes and fixture writes.
import fs from "node:fs/promises";
import path from "node:path";
import { withTempHome as withTempHomeBase } from "../plugin-sdk/test-env.js";
import { resetPluginLoaderTestStateForTest } from "../plugins/loader.test-fixtures.js";
import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import { resetConfigRuntimeState, type BranchConfig } from "./config.js";

function resetConfigTestRuntimeState(): void {
  resetConfigRuntimeState();
  resetPluginLoaderTestStateForTest();
  clearPluginMetadataLifecycleCaches();
}

export async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  resetConfigTestRuntimeState();
  try {
    return await withTempHomeBase(fn, {
      prefix: "branch-config-",
      env: {
        BRANCH_CONFIG_PATH: undefined,
        BRANCH_BUNDLED_PLUGINS_DIR: undefined,
        BRANCH_DISABLE_BUNDLED_PLUGINS: undefined,
        BRANCH_PLUGIN_CATALOG_PATHS: undefined,
        BRANCH_MPM_CATALOG_PATHS: undefined,
        BRANCH_LOAD_SHELL_ENV: undefined,
        BRANCH_DEFER_SHELL_ENV_FALLBACK: undefined,
        BRANCH_SHELL_ENV_TIMEOUT_MS: undefined,
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_OAUTH_TOKEN: undefined,
      },
    });
  } finally {
    resetConfigTestRuntimeState();
  }
}

export async function writeBranchConfig(home: string, config: unknown): Promise<string> {
  const configPath = path.join(home, ".branch", "branch.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

export async function writeStateDirDotEnv(
  content: string,
  params?: {
    env?: NodeJS.ProcessEnv;
    stateDir?: string;
  },
): Promise<{ dotEnvPath: string; stateDir: string }> {
  const stateDir = params?.stateDir ?? params?.env?.BRANCH_STATE_DIR?.trim();
  if (!stateDir) {
    throw new Error("Expected BRANCH_STATE_DIR or explicit stateDir for .env test setup");
  }
  const dotEnvPath = path.join(stateDir, ".env");
  await fs.mkdir(path.dirname(dotEnvPath), { recursive: true });
  await fs.writeFile(dotEnvPath, content, "utf-8");
  return { dotEnvPath, stateDir };
}

export async function withTempHomeConfig<T>(
  config: unknown,
  fn: (params: { home: string; configPath: string }) => Promise<T>,
): Promise<T> {
  return withTempHome(async (home) => {
    const configPath = await writeBranchConfig(home, config);
    return fn({ home, configPath });
  });
}

export function buildWebSearchProviderConfig(params: {
  provider: NonNullable<
    NonNullable<NonNullable<NonNullable<BranchConfig["tools"]>["web"]>["search"]>["provider"]
  >;
  enabled?: boolean;
  providerConfig?: Record<string, unknown>;
}): Record<string, unknown> {
  const search: Record<string, unknown> = { provider: params.provider };
  if (params.enabled !== undefined) {
    search.enabled = params.enabled;
  }
  const pluginId =
    params.provider === "gemini"
      ? "google"
      : params.provider === "grok"
        ? "xai"
        : params.provider === "kimi"
          ? "moonshot"
          : params.provider;
  return {
    tools: {
      web: {
        search,
      },
    },
    ...(params.providerConfig
      ? {
          plugins: {
            entries: {
              [pluginId]: {
                config: {
                  webSearch: params.providerConfig,
                },
              },
            },
          },
        }
      : {}),
  };
}
