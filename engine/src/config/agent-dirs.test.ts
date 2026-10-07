// Covers agent directory resolution across config and environment overrides.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findDuplicateAgentDirs } from "./agent-dirs.js";
import type { BranchConfig } from "./types.js";

describe("findDuplicateAgentDirs", () => {
  it("finds duplicate explicit dirs in keyed agent entries", () => {
    const cfg: BranchConfig = {
      agents: {
        ownership: "explicit",
        entries: {
          alpha: { agentDir: "/srv/shared-agent" },
          beta: { agentDir: "/srv/shared-agent" },
        },
      },
    };

    expect(findDuplicateAgentDirs(cfg)).toEqual([
      { agentDir: "/srv/shared-agent", agentIds: ["alpha", "beta"] },
    ]);
  });

  it.each([
    {
      name: "BRANCH_HOME",
      env: { BRANCH_HOME: "/srv/branch-home", HOME: "/home/other" },
      stateDir: "/srv/branch-home/.branch",
    },
    {
      name: "BRANCH_STATE_DIR",
      env: { BRANCH_STATE_DIR: "/srv/branch-state", BRANCH_HOME: "/home/other" },
      stateDir: "/srv/branch-state",
    },
    {
      name: "the supplied home resolver",
      env: {},
      stateDir: "/srv/fallback-home/.branch",
    },
  ])("detects a configured directory colliding with $name", ({ env, stateDir }) => {
    const agentDir = path.resolve(stateDir, "agents", "alpha", "agent");
    const cfg: BranchConfig = {
      agents: { entries: { alpha: {}, beta: { agentDir } } },
    };

    expect(findDuplicateAgentDirs(cfg, { env, homedir: () => "/srv/fallback-home" })).toEqual([
      { agentDir, agentIds: ["alpha", "beta"] },
    ]);
  });
});
