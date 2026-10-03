import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "../plugin-sdk/plugin-state-runtime.js";
import {
  createPluginStateKeyedStoreForTests,
  resetPluginStateStoreForTests,
} from "../plugin-sdk/plugin-state-test-runtime.js";
import type { MemoryPluginRuntime } from "../plugins/registry-contribution-types.js";
import { createDeferredCore } from "../shared/deferred.js";
import { recordAgentDatabaseAdmissions } from "./agent-database-admission.js";
import { closeBranchAgentDatabasesAsync } from "./branch-agent-db-lifecycle.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import {
  runBranchAgentWriteAdmission,
  SQLITE_SESSION_WRITER_QUEUES,
} from "./branch-agent-write-admission.js";
import { closeBranchStateDatabaseAsync } from "./branch-state-db-cache.js";

const { configureMemoryCoreRingsState, getMemorySearchManager, memoryRuntime } =
  await vi.importActual<{
    configureMemoryCoreRingsState: (
      open: <T>(options: OpenKeyedStoreOptions) => PluginStateKeyedStore<T>,
    ) => void;
    getMemorySearchManager: MemoryPluginRuntime["getMemorySearchManager"];
    memoryRuntime: MemoryPluginRuntime;
  }>("../../extensions/memory-core/runtime-api.js");

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("memory manager state owner capture", () => {
  let root: string;
  let workspace: string;
  let config: BranchConfig;
  let originalEnv: NodeJS.ProcessEnv;
  let otherEnv: NodeJS.ProcessEnv;
  let cwd: MockInstance<() => string>;

  beforeEach(async () => {
    root = await fs.realpath(tempDirs.make("branch-memory-write-owner-"));
    workspace = path.join(root, "workspace");
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "Original memory.");
    originalEnv = { BRANCH_STATE_DIR: path.join(root, "state") };
    otherEnv = { BRANCH_STATE_DIR: path.join(root, "other", "state") };
    configureMemoryCoreRingsState(<T>(options: OpenKeyedStoreOptions) =>
      createPluginStateKeyedStoreForTests<T>("memory-core", { ...options, env: originalEnv }),
    );
    vi.stubEnv("BRANCH_STATE_DIR", originalEnv.BRANCH_STATE_DIR);
    config = {
      plugins: { enabled: false },
      agents: { defaults: { workspace }, list: [{ id: "main" }] },
      memory: { search: { provider: "none", store: { vector: { enabled: false } } } },
    };
    openBranchAgentDatabase({ agentId: "main", env: originalEnv });
    // Warm the supported runtime entry before the test controls queue admission.
    const warm = await getMemorySearchManager({ cfg: config, agentId: "main", purpose: "status" });
    expect(warm.manager).not.toBeNull();
    await warm.manager?.close?.();
    vi.stubEnv("BRANCH_STATE_DIR", "state");
    cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
  });

  afterEach(async () => {
    recordAgentDatabaseAdmissions([], { env: originalEnv });
    recordAgentDatabaseAdmissions([], { env: otherEnv });
    await memoryRuntime.closeAllMemorySearchManagers?.();
    await closeBranchAgentDatabasesAsync();
    closeBranchAgentDatabasesForTest();
    await closeBranchStateDatabaseAsync();
    resetPluginStateStoreForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    configureMemoryCoreRingsState(() => {
      throw new Error("memory test state is closed");
    });
  });

  function refuse(env: NodeJS.ProcessEnv) {
    recordAgentDatabaseAdmissions(
      [
        {
          agentId: "main",
          paths: [],
          embeddedOwnerId: "other",
          code: "agent-database-ownership-mismatch",
          reason: "fixture state owner refuses this agent",
          repairHint: "fixture refusal",
        },
      ],
      { env },
    );
  }

  it("keeps creation on its admitted state owner after cwd changes", async () => {
    const database = openBranchAgentDatabase({ agentId: "main", env: originalEnv });
    refuse(otherEnv);
    const entered = createDeferredCore();
    const release = createDeferredCore();
    const blocker = runBranchAgentWriteAdmission(
      { agentId: "main", path: database.path, env: originalEnv },
      async () => {
        entered.resolve();
        await release.promise;
      },
    );
    await entered.promise;
    const creating = getMemorySearchManager({ cfg: config, agentId: "main", purpose: "cli" });
    try {
      await vi.waitFor(() => {
        expect(SQLITE_SESSION_WRITER_QUEUES.get(database.path)?.pending.length).toBeGreaterThan(0);
      });
      cwd.mockReturnValue(path.join(root, "other"));
      release.resolve();
      const result = await creating;
      expect(result.error).toBeUndefined();
      expect(result.manager).not.toBeNull();
      expect(result.manager?.status().dbPath).toBe(database.path);
      await result.manager?.close?.();
    } finally {
      release.resolve();
      await Promise.allSettled([creating, blocker]);
    }
  });

  it("keeps replacement on the state owner chosen before prior manager close", async () => {
    const acquired = await getMemorySearchManager({ cfg: config, agentId: "main" });
    const manager = acquired.manager;
    if (!manager?.close) {
      throw new Error(acquired.error ?? "Expected a closable memory manager");
    }
    const originalClose = manager.close.bind(manager);
    const entered = createDeferredCore();
    const release = createDeferredCore();
    vi.spyOn(manager, "close").mockImplementation(async () => {
      entered.resolve();
      await release.promise;
      await originalClose();
    });
    refuse(otherEnv);
    const creating = getMemorySearchManager({
      cfg: {
        ...config,
        memory: { search: { ...config.memory?.search, query: { minScore: 0.01 } } },
      },
      agentId: "main",
    });
    try {
      await Promise.race([
        entered.promise,
        creating.then(() => {
          throw new Error("Replacement skipped its previous manager's close");
        }),
      ]);
      cwd.mockReturnValue(path.join(root, "other"));
      release.resolve();
      const result = await creating;
      expect(result.error).toBeUndefined();
      expect(result.manager).not.toBeNull();
      await result.manager?.close?.();
    } finally {
      release.resolve();
      await Promise.allSettled([creating]);
    }
  });

  it("rechecks retained writes against their original state owner after cwd changes", async () => {
    const acquired = await getMemorySearchManager({ cfg: config, agentId: "main", purpose: "cli" });
    const manager = acquired.manager;
    if (!manager?.sync) {
      throw new Error(acquired.error ?? "Expected a writable memory manager");
    }
    await manager.sync({ reason: "baseline", force: true });
    const database = openBranchAgentDatabase({ agentId: "main", env: originalEnv });
    const before = database.db.prepare("SELECT text FROM memory_index_chunks").all();
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "Changed after admission was revoked.");
    refuse(originalEnv);
    cwd.mockReturnValue(path.join(root, "other"));
    await expect(manager.sync({ reason: "revoked", force: true })).rejects.toThrow(
      "fixture state owner refuses this agent",
    );
    expect(database.db.prepare("SELECT text FROM memory_index_chunks").all()).toEqual(before);
  });
});
