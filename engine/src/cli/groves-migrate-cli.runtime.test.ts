import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { readGroveInstallRecord } from "../groves/provenance.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  isCancel: vi.fn((value: unknown) => value === "cancelled"),
}));

vi.mock("@clack/prompts", () => ({
  confirm: mocks.confirm,
  isCancel: mocks.isCancel,
}));

// This suite exercises config freshness and the real migration writes; lease
// worker admission is covered by the lifecycle integration suite.
vi.mock("../agents/agent-lifecycle-registry.js", () => ({
  withAgentDeletion: async (_agentId: string, run: () => Promise<unknown>) => await run(),
}));

const { runGrovesMigrateCommand } = await import("./groves-migrate-cli.runtime.js");
const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  clearRuntimeConfigSnapshot();
  closeBranchStateDatabaseForTest();
});

async function fixture() {
  const root = tempDirs.make("branch-groves-migrate-cli-");
  const workspace = join(root, "workspace");
  const stateDir = join(root, "state");
  const configPath = join(root, "branch.json");
  const env = {
    ...process.env,
    HOME: root,
    BRANCH_HOME: root,
    BRANCH_STATE_DIR: stateDir,
    BRANCH_CONFIG_PATH: configPath,
  };
  for (const key of [
    "HOME",
    "BRANCH_HOME",
    "BRANCH_STATE_DIR",
    "BRANCH_CONFIG_PATH",
  ] as const) {
    vi.stubEnv(key, env[key]);
  }
  await mkdir(workspace);
  await writeFile(join(workspace, "AGENTS.md"), "Keep this agent as-is.\n", "utf8");
  const config: BranchConfig = { agents: { entries: { worker: { workspace } } } };
  await writeFile(configPath, JSON.stringify(config));
  setRuntimeConfigSnapshot(config);
  const runtime = {
    log: vi.fn(),
    error: vi.fn(),
    writeJson: vi.fn(),
    writeStdout: vi.fn(),
    exit: vi.fn(),
  };
  return { root, workspace, stateDir, configPath, env, config, runtime };
}

describe("groves migrate interactive consent", () => {
  beforeEach(() => {
    vi.stubEnv("BRANCH_EXPERIMENTAL_GROVES", "1");
    mocks.confirm.mockReset();
    mocks.isCancel.mockClear();
  });

  it("defaults to no and leaves the existing agent untouched when cancelled", async () => {
    const { stateDir, env, runtime } = await fixture();
    mocks.confirm.mockResolvedValue(false);

    await runGrovesMigrateCommand("worker", {}, runtime);

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValue: false,
        message: expect.stringContaining('"worker"'),
      }),
    );
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("Generated local Grove package files:"),
    );
    expect(runtime.log).toHaveBeenCalledWith(
      "Migration cancelled; no Grove ownership was recorded.",
    );
    await expect(access(resolveBranchStateSqlitePath(env))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(stateDir, "groves", "local", "worker"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it.each(["removed", "reassigned"] as const)(
    "rejects an agent %s on disk while interactive consent waits, before enrollment",
    async (change) => {
      const { root, stateDir, configPath, config, env, runtime } = await fixture();
      const reassignedWorkspace = join(root, "reassigned");
      await mkdir(reassignedWorkspace);
      mocks.confirm.mockImplementation(async () => {
        const current: BranchConfig = {
          ...config,
          agents: {
            entries: change === "removed" ? {} : { worker: { workspace: reassignedWorkspace } },
          },
        };
        await writeFile(configPath, JSON.stringify(current));
        return true;
      });

      await runGrovesMigrateCommand("worker", {}, runtime);

      expect(runtime.exit).toHaveBeenCalledWith(1);
      expect(runtime.error).toHaveBeenCalledWith(
        expect.stringMatching(
          change === "removed" ? /No configured local agent/ : /changed after consent/,
        ),
      );
      await expect(access(join(stateDir, "groves", "local", "worker"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(readGroveInstallRecord("worker", { env })).toBeUndefined();
    },
  );
});
