// Temporary Gateway config test helper.
// Installs isolated config files and restores process-global config state.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearConfigCache,
  resetConfigRuntimeState,
  setRuntimeConfigSnapshot,
} from "../config/config.js";
import type { BranchConfig } from "../config/config.js";
import { clearSecretsRuntimeSnapshot } from "../secrets/runtime.js";

/** Writes a temp Branch Agent config, installs it as runtime state, then restores globals. */
export async function withTempConfig(params: {
  cfg: unknown;
  run: () => Promise<void>;
  prefix?: string;
}): Promise<void> {
  const prevConfigPath = process.env.BRANCH_CONFIG_PATH;

  const testConfig = structuredClone(params.cfg) as BranchConfig;
  const dir = await mkdtemp(path.join(os.tmpdir(), params.prefix ?? "branch-test-config-"));
  const configPath = path.join(dir, "branch.json");

  process.env.BRANCH_CONFIG_PATH = configPath;

  try {
    await writeFile(configPath, JSON.stringify(testConfig, null, 2), "utf-8");
    // Mirror both on-disk and runtime snapshots so code paths using either
    // config IO layer see the same isolated fixture.
    clearConfigCache();
    resetConfigRuntimeState();
    clearSecretsRuntimeSnapshot();
    setRuntimeConfigSnapshot(testConfig, testConfig);
    await params.run();
  } finally {
    if (prevConfigPath === undefined) {
      delete process.env.BRANCH_CONFIG_PATH;
    } else {
      process.env.BRANCH_CONFIG_PATH = prevConfigPath;
    }
    clearConfigCache();
    resetConfigRuntimeState();
    clearSecretsRuntimeSnapshot();
    await rm(dir, { recursive: true, force: true });
  }
}
