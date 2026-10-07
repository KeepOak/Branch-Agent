import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import * as configRuntime from "../../config/config.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { closeBranchAgentDatabasesAsync } from "../../state/branch-agent-db.js";
import { closeStateDatabaseForTest } from "../../test-utils/database-cleanup.js";
import { collectGatewayHealthSnapshot } from "./collector.js";

vi.mock("../../channels/plugins/read-only.js", () => ({
  listReadOnlyChannelPluginsForConfig: () => [],
}));

const tempDirs = createTempDirTracker();

afterEach(async () => {
  await closeBranchAgentDatabasesAsync();
  await closeStateDatabaseForTest();
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  tempDirs.cleanup();
});

it.each(["unwritten", "implicit", "empty", "configured"] as const)(
  "collects health on a fresh %s profile without an ownerless store lookup",
  async (state) => {
    const root = tempDirs.make("health-fresh-profile-");
    const configPath = path.join(root, "branch.json");
    vi.stubEnv("BRANCH_STATE_DIR", root);
    vi.stubEnv("BRANCH_HOME", root);
    vi.stubEnv("BRANCH_CONFIG_PATH", configPath);
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    if (state !== "unwritten") {
      const config: BranchConfig = {
        agents: {
          ownership: "explicit",
          ...(state === "empty"
            ? { entries: {} }
            : state === "configured"
              ? {
                  defaults: { systemAgent: { agentId: "ops" } },
                  entries: { other: {}, ops: {} },
                }
              : {}),
        },
      };
      if (state === "empty") {
        vi.spyOn(configRuntime, "getRuntimeConfig").mockReturnValue(config);
      } else {
        await fs.writeFile(configPath, JSON.stringify(config));
      }
    }

    const health = await collectGatewayHealthSnapshot({ audience: "admin", probe: false });

    expect(health.ok).toBe(true);
    expect(health.sessions.count).toBe(0);
    expect(health.sessions.recent).toEqual([]);
    if (state === "empty") {
      expect(health.agents).toEqual([]);
      expect(health.sessions.path).toBe("");
    } else {
      const agentId = state === "configured" ? "ops" : "main";
      expect(health.defaultAgentId).toBe(agentId);
      expect(health.sessions).toEqual(
        health.agents.find((agent) => agent.agentId === agentId)?.sessions,
      );
      expect(health.sessions.path).toContain(agentId);
    }
  },
);
