import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readConfigFileSnapshot, resetConfigRuntimeState } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { closeBranchAgentDatabasesForTest } from "../state/branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { withEnvAsync } from "../test-utils/env.js";
import { modelsSetCommand } from "./models/set.js";

const parentDir = path.join(os.tmpdir(), "Codex-session-files");
const tempDirs = createSuiteTempRootTracker({ prefix: "model-suitability-", parentDir });
beforeAll(async () => {
  await fs.mkdir(parentDir, { recursive: true });
  await tempDirs.setup();
});
afterAll(async () => {
  await tempDirs.cleanup();
});

function fixtureConfig(model: string, name: string): BranchConfig {
  return {
    models: {
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:1",
          api: "openai-completions",
          models: [
            {
              id: model,
              name,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 8192,
              maxTokens: 1024,
            },
          ],
        },
      },
    },
  };
}

async function selectFixture(model: string, name: string) {
  const root = await tempDirs.make();
  const configPath = path.join(root, "branch.json");
  await fs.writeFile(configPath, JSON.stringify(fixtureConfig(model, name)));
  return await withEnvAsync(
    {
      BRANCH_CONFIG_PATH: configPath,
      BRANCH_STATE_DIR: root,
      BRANCH_HOME: root,
      BRANCH_WORKSPACE_DIR: undefined,
    },
    async () => {
      resetConfigRuntimeState();
      const errors: string[] = [];
      const logs: string[] = [];
      try {
        await modelsSetCommand(`fixture/${model}`, {
          log: (value) => {
            logs.push(String(value));
          },
          error: (value) => {
            errors.push(String(value));
          },
          exit: () => undefined,
        });
        const snapshot = await readConfigFileSnapshot();
        expect(snapshot.valid).toBe(true);
        return { errors, logs, config: snapshot.sourceConfig ?? snapshot.config };
      } finally {
        closeBranchAgentDatabasesForTest();
        closeBranchStateDatabaseForTest();
        resetConfigRuntimeState();
      }
    },
  );
}

describe("native models set suitability advice", () => {
  it("warns and persists an unrecognized model without changing selection policy", async () => {
    const { config, errors, logs } = await selectFixture("falcon-7b", "Local Falcon");
    expect(errors).toEqual([expect.stringContaining('Model "Local Falcon" is not among')]);
    expect(logs).toContain("Default model: fixture/falcon-7b");
    expect(config.agents?.defaults?.model).toEqual({ primary: "fixture/falcon-7b" });
    expect(config.agents?.defaults?.modelPolicy).toBeUndefined();
  });

  it.each([
    ["opaque", "Llama 3.3 70B"],
    ["gpt-4", "Custom deployment"],
  ])("recognizes configured display name or native ID: %s / %s", async (model, name) => {
    const { config, errors } = await selectFixture(model, name);
    expect(errors).toEqual([]);
    expect(config.agents?.defaults?.model).toEqual({ primary: `fixture/${model}` });
  });
});
