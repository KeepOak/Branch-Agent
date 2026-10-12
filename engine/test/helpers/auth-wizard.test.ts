import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  closeBranchAgentDatabaseByPath,
  openBranchAgentDatabase,
} from "../../src/state/branch-agent-db.js";
import { closeBranchStateDatabaseByPath } from "../../src/state/branch-state-db-cache.js";
import { openBranchStateDatabase } from "../../src/state/branch-state-db.js";
import { captureFullEnv, withEnvAsync } from "../../src/test-utils/env.js";
import { setupAuthTestEnv } from "./auth-wizard.js";

describe("setupAuthTestEnv", () => {
  it.each([
    { name: "default", agentSubdir: undefined },
    { name: "custom", agentSubdir: "custom-agent" },
  ])("owns the $name agent directory until cleanup", async ({ agentSubdir }) => {
    const previousEnv = { ...process.env };
    const snapshot = captureFullEnv();
    const fixture = await setupAuthTestEnv("auth-wrapper-success-", { agentSubdir });
    try {
      expect(fixture.agentDir).toBe(path.join(fixture.stateDir, agentSubdir ?? "agent"));
      expect((await fs.stat(fixture.agentDir)).isDirectory()).toBe(true);
      expect(process.env.BRANCH_AGENT_DIR).toBe(fixture.agentDir);
      expect(process.env.BRANCH_STATE_DIR).toBe(fixture.stateDir);
      expect(process.env.BRANCH_CONFIG_PATH).toBe(path.join(fixture.stateDir, "branch.json"));
      expect(process.env.HOME).toBe(previousEnv.HOME);
      await fixture.cleanup();
      expect(process.env).toEqual(previousEnv);
      await expect(fs.stat(path.dirname(fixture.stateDir))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      try {
        await fixture.cleanup();
      } finally {
        snapshot.restore();
      }
    }
  });

  it.each(["absent", "set"])(
    "releases state after agent mkdir fails with agent override %s",
    async (prior) => {
      await withEnvAsync(
        {
          BRANCH_AGENT_DIR:
            prior === "set" ? path.join(process.env.HOME!, "prior-agent") : undefined,
        },
        async () => {
          const previousEnv = { ...process.env };
          const snapshot = captureFullEnv();
          const failure = new Error("agent mkdir failed");
          let root: string | undefined;
          let shared: ReturnType<typeof openBranchStateDatabase> | undefined;
          let agent: ReturnType<typeof openBranchAgentDatabase> | undefined;
          const mkdir = fs.mkdir;
          const mkdirSpy = vi.spyOn(fs, "mkdir").mockImplementation(async (...args) => {
            if (
              typeof args[0] === "string" &&
              args[0] === process.env.BRANCH_AGENT_DIR &&
              path.basename(args[0]) === "faulting-agent"
            ) {
              const stateDir = path.dirname(args[0]);
              root = path.dirname(stateDir);
              expect((await fs.stat(stateDir)).isDirectory()).toBe(true);
              const env = { ...process.env, BRANCH_STATE_DIR: stateDir };
              shared = openBranchStateDatabase({ env });
              agent = openBranchAgentDatabase({ agentId: "main", env });
              throw failure;
            }
            return mkdir(...args);
          });
          try {
            await expect(
              setupAuthTestEnv("auth-wrapper-failure-", { agentSubdir: "faulting-agent" }),
            ).rejects.toBe(failure);
            expect.soft(process.env).toEqual(previousEnv);
            expect.soft(shared?.db.isOpen).toBe(false);
            expect.soft(agent?.db.isOpen).toBe(false);
            expect(root).toBeDefined();
            await expect(fs.stat(root!)).rejects.toMatchObject({ code: "ENOENT" });
          } finally {
            mkdirSpy.mockRestore();
            try {
              if (agent) {
                closeBranchAgentDatabaseByPath(agent.path);
              }
              if (shared) {
                closeBranchStateDatabaseByPath(shared.path);
              }
            } finally {
              snapshot.restore();
              if (root) {
                await fs.rm(root, { recursive: true, force: true });
              }
            }
          }
        },
      );
    },
  );
});
