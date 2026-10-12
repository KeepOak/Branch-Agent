import type { PluginManifestRegistry } from "../plugins/manifest-registry.js";
import { createPathResolutionEnv, withEnvAsync } from "../test-utils/env.js";

export function createConfigWriteHomeFixture(makeHome: (prefix: string) => Promise<string>) {
  return async <T>(fn: (home: string) => Promise<T>): Promise<T> => {
    const home = await makeHome("case");
    return withEnvAsync(
      createPathResolutionEnv(home, {
        // Env-only state readers and global write metadata must share the injected IO home.
        BRANCH_CONFIG_PATH: undefined,
        BRANCH_DEFER_SHELL_ENV_FALLBACK: undefined,
        BRANCH_LOAD_SHELL_ENV: undefined,
        BRANCH_SHELL_ENV_TIMEOUT_MS: undefined,
      }),
      () => fn(home),
    );
  };
}

export const defaultedDemoPluginRegistry = {
  diagnostics: [],
  plugins: [
    {
      id: "demo",
      origin: "bundled",
      enabledByDefault: true,
      channels: [],
      providers: [],
      cliBackends: [],
      skills: [],
      hooks: [],
      rootDir: "/tmp/branch-test-demo",
      source: "/tmp/branch-test-demo/index.ts",
      manifestPath: "/tmp/branch-test-demo/branch.plugin.json",
      configSchema: {
        type: "object",
        properties: { mode: { type: "string", default: "auto" } },
        additionalProperties: true,
      },
    },
  ],
} satisfies PluginManifestRegistry;
