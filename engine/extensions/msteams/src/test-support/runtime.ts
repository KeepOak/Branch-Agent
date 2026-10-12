// Msteams plugin module implements runtime behavior.
import os from "node:os";
import path from "node:path";
import type { OpenKeyedStoreOptions } from "branch/plugin-sdk/plugin-state-runtime";
import { createPluginStateKeyedStoreForTests } from "branch/plugin-sdk/plugin-state-test-runtime";
import type { PluginRuntime } from "../../runtime-api.js";

export const msteamsRuntimeStub = {
  state: {
    openKeyedStore: (options: OpenKeyedStoreOptions) =>
      createPluginStateKeyedStoreForTests("msteams", options),
    resolveStateDir: (env: NodeJS.ProcessEnv = process.env, homedir?: () => string) => {
      const override = env.BRANCH_STATE_DIR?.trim() || env.BRANCH_STATE_DIR?.trim();
      if (override) {
        return override;
      }
      const resolvedHome = homedir ? homedir() : os.homedir();
      return path.join(resolvedHome, ".branch");
    },
  },
} as unknown as PluginRuntime;
