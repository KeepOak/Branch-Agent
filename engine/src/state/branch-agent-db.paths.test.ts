import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  resolveIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.paths.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => vi.restoreAllMocks());

function expectedPath(root: string, agentId = "worker"): string {
  return path.join(root, "agents", agentId, "agent", "branch-agent.sqlite");
}

describe("agent SQLite path memoization", () => {
  it("follows changes to the same environment without crossing agent roots", () => {
    const root = tempDirs.make("branch-agent-paths-");
    const env = { BRANCH_STATE_DIR: path.join(root, "first") };
    for (const dir of ["first", "second", "first"]) {
      env.BRANCH_STATE_DIR = path.join(root, dir);
      for (const agentId of ["Worker", "other", "Worker"]) {
        expect(resolveBranchAgentSqlitePath({ agentId, env })).toBe(
          expectedPath(env.BRANCH_STATE_DIR, agentId.toLowerCase()),
        );
      }
      expect(resolveIncognitoBranchAgentSqlitePath({ agentId: "Worker", env })).toBe(
        path.join(
          env.BRANCH_STATE_DIR,
          "agents",
          "worker",
          "agent",
          "incognito-branch-agent.sqlite",
        ),
      );
    }
  });

  it("rechecks legacy discovery and home changes after warming paths", () => {
    const root = tempDirs.make("branch-agent-path-home-");
    const env = { HOME: path.join(root, "first") };
    const legacy = path.join(env.HOME, ".clawdbot");
    fs.mkdirSync(legacy, { recursive: true });
    expect(resolveBranchAgentSqlitePath({ agentId: "worker", env })).toBe(expectedPath(legacy));
    const current = path.join(env.HOME, ".branch");
    fs.mkdirSync(current);
    expect(resolveBranchAgentSqlitePath({ agentId: "worker", env })).toBe(expectedPath(current));
    env.HOME = path.join(root, "second");
    expect(resolveBranchAgentSqlitePath({ agentId: "worker", env })).toBe(
      expectedPath(path.join(env.HOME, ".branch")),
    );
  });

  it("resolves relative overrides and explicit paths against the current cwd", () => {
    const root = tempDirs.make("branch-agent-path-cwd-");
    const cwd = vi.spyOn(process, "cwd");
    const env = { BRANCH_STATE_DIR: "relative-state" };
    for (const dir of ["first", "second", "first"]) {
      const workingDir = path.join(root, dir);
      cwd.mockReturnValue(workingDir);
      expect(resolveBranchAgentSqlitePath({ agentId: "worker", env })).toBe(
        expectedPath(path.join(workingDir, "relative-state")),
      );
      expect(
        resolveBranchAgentSqlitePath({ agentId: "worker", env, path: "custom.sqlite" }),
      ).toBe(path.join(workingDir, "custom.sqlite"));
    }
  });
});
