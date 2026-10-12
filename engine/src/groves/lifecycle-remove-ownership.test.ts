import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { readSourceConfigBestEffort, resetConfigRuntimeState } from "../config/config.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { readAgentDeletionJournal } from "../state/agent-deletion-journal.js";
import { listBranchRegisteredAgentDatabases } from "../state/branch-agent-db-registry.js";
import {
  closeBranchAgentDatabases,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import type { DB } from "../state/branch-state-db.generated.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { applyGroveAddPlan } from "./add.js";
import { workspaceContainsUntrackedEntries } from "./lifecycle-delete-support.js";
import type { GroveRemoveApplyOptions, GroveRemoveResult } from "./lifecycle-remove-contract.js";
import {
  buildGroveRemovalFixture,
  quiescentGroveMonitorGateway,
} from "./lifecycle-remove.test-support.js";
import { applyGroveRemovePlan, buildGroveRemovePlan } from "./lifecycle-state.js";
import { readGroveInstallRecord, persistClawPackageRef, readClawPackageRefs } from "./provenance.js";
import { readGroveWorkspaceFiles, upsertGroveWorkspaceFile } from "./workspace.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    await cleanup();
  }
});

async function fixture(withFile = false) {
  const state = await createBranchTestState({ prefix: "grove-removal-owner-" });
  cleanups.push(() => state.cleanup());
  await state.writeConfig({});
  const install = async (name: string) => {
    const root = state.path(name);
    await fs.mkdir(root);
    const added = await buildGroveRemovalFixture(root, { withFile, name: `@synthetic/${name}` });
    expect(
      await applyGroveAddPlan(added.plan, {
        consentPlanIntegrity: added.plan.planIntegrity,
        commitConfig: async (transform) => {
          await state.writeConfig(transform(await readSourceConfigBestEffort()));
          resetConfigRuntimeState();
        },
      }),
    ).toMatchObject({ status: "complete" });
    return { workspace: added.plan.agent.workspace, plan: added.plan };
  };
  const { workspace, plan: initialPlan } = await install("initial");
  const trashPath: NonNullable<GroveRemoveApplyOptions["trashPath"]> = async (pathname) => {
    await fs.rm(pathname, { recursive: true, force: true });
    return true;
  };
  const remove = async (overrides: Partial<GroveRemoveApplyOptions> = {}) => {
    const config = await readSourceConfigBestEffort();
    const plan = await buildGroveRemovePlan("worker", { config, ...overrides });
    expect(plan.blockers).toEqual([]);
    return await applyGroveRemovePlan(plan, {
      config,
      monitorGateway: quiescentGroveMonitorGateway,
      consentPlanIntegrity: plan.planIntegrity,
      trashPath,
      ...overrides,
    });
  };
  return { state, workspace, plan: initialPlan, install, remove, trashPath };
}

function expireDeletionLease(): void {
  // A live deletion serializes successors; expiry models the recovery boundary.
  runBranchStateWriteTransaction(({ db }) => {
    executeSqliteQuerySync(
      db,
      getNodeSqliteKysely<Pick<DB, "state_leases">>(db)
        .updateTable("state_leases")
        .set({ expires_at: 0 })
        .where("scope", "=", "core:agent-deletion")
        .where("lease_key", "=", "worker"),
    );
  });
}

describe("Grove removal operation ownership", () => {
  it("preserves operator files when a tracked directory disappears during child enumeration", async () => {
    const current = await fixture(true);
    const trackedDirectory = path.join(current.workspace, "a");
    await fs.mkdir(trackedDirectory);
    await fs.writeFile(path.join(trackedDirectory, "tracked.md"), "managed\n");
    const trackedFile = readGroveWorkspaceFiles("worker")[0];
    if (!trackedFile) {
      throw new Error("expected managed workspace file");
    }
    upsertGroveWorkspaceFile({ ...trackedFile, path: "a/tracked.md" });
    const operatorDirectory = path.join(current.workspace, "z");
    await fs.mkdir(operatorDirectory);
    const operatorFile = path.join(operatorDirectory, "operator-note.txt");
    await fs.writeFile(operatorFile, "keep me\n");
    const readDirectory = fs.readdir.bind(fs);
    let readdir: MockInstance<typeof fs.readdir> | undefined;
    let raced = false;
    const trashPath = vi.fn(current.trashPath);
    try {
      const result = await current.remove({
        monitorGateway: {
          ...quiescentGroveMonitorGateway,
          drain: async (...args) => {
            await quiescentGroveMonitorGateway.drain(...args);
            readdir = vi.spyOn(fs, "readdir").mockImplementation(async (directory, options) => {
              const entries = await readDirectory(directory, options);
              if (directory === current.workspace && !raced) {
                raced = true;
                await fs.rm(trackedDirectory, { recursive: true });
              }
              return entries;
            });
          },
        },
        purgeSessions: async () => undefined,
        trashPath,
      });
      expect(raced).toBe(true);
      expect(result).toMatchObject({ status: "complete", agentRemoved: true });
      expect(result.workspaceFiles).toContainEqual({ path: "a/tracked.md", action: "deleted" });
      await expect(fs.readFile(operatorFile, "utf8")).resolves.toBe("keep me\n");
      expect(trashPath).not.toHaveBeenCalledWith(current.workspace, expect.anything());
    } finally {
      readdir?.mockRestore();
    }
  });

  it("retains the workspace when root dirent resolution loses a child", async () => {
    const workspace = tempDirs.make("grove-inventory-");
    const child = path.join(workspace, "a");
    await fs.mkdir(child);
    const readDirectory = fs.readdir.bind(fs);
    const readdir = vi.spyOn(fs, "readdir").mockImplementation(async (directory, options) => {
      const entries = await readDirectory(directory, options);
      if (directory === workspace) {
        await fs.rm(child, { recursive: true });
        // Node resolves unknown dirent types with lstat and forwards the child error.
        await fs.lstat(child);
      }
      return entries;
    });
    try {
      await expect(workspaceContainsUntrackedEntries(workspace, ["a/tracked.md"])).resolves.toBe(
        true,
      );
    } finally {
      readdir.mockRestore();
    }
  });

  it("recognizes a missing workspace root as empty", async () => {
    const root = path.join(tempDirs.make("grove-inventory-"), "missing");
    await expect(workspaceContainsUntrackedEntries(root, [])).resolves.toBe(false);
  });

  it.each(["transport", "runtime"])(
    "keeps partial state after package %s failure without local fallback",
    async (failure) => {
      const current = await fixture(true);
      persistClawPackageRef(current.plan, {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "1.0.0",
        integrity: "sha256:audit",
      });
      const application = { operationId: "runtime-final", generation: 3, pluginIds: ["audit"] };
      const message =
        failure === "transport"
          ? "package connection lost"
          : "Plugin activation failed. Gateway generation 3: replacement applied.";
      const warnings = ["Package dependency pruning failed."];
      const packages = [
        {
          kind: "plugin" as const,
          ref: "audit",
          version: "1.0.0",
          action: "error" as const,
          reason: message,
        },
      ];
      const packageGateway = vi.fn(async () => {
        if (failure === "transport") {
          throw new Error(message);
        }
        return { packages, warnings, application };
      });
      const uninstallPlugin = vi.fn();
      const result = await current.remove({
        referencedCleanup: { mode: "remove-selected", selected: ["plugin:audit@1.0.0"] },
        packageGateway,
        packageDeps: {
          uninstallPlugin,
          resolvePlugin: async () => ({
            status: "found",
            pluginId: "audit",
            installedVersion: "1.0.0",
            record: {
              source: "clawhub",
              integrity: "sha256:audit",
              installedAt: "1970-01-01T00:00:00.001Z",
            },
          }),
        },
      });
      expect(result).toMatchObject({
        status: "partial",
        agentRemoved: true,
        error: { code: "package_cleanup_failed", message },
      });
      expect(result.packages).toEqual(failure === "runtime" ? packages : []);
      expect(result.pluginRuntime).toEqual(failure === "runtime" ? application : undefined);
      expect(result.warnings).toEqual(failure === "runtime" ? warnings : undefined);
      expect(packageGateway).toHaveBeenCalledOnce();
      expect(uninstallPlugin).not.toHaveBeenCalled();
      expect(readAgentDeletionJournal("worker")?.cleanupCompleted).toBe(false);
      expect(readGroveInstallRecord("worker")?.status).toBe("partial");
      expect(readClawPackageRefs({ agentId: "worker" })[0]?.status).toBe("complete");
      await expect(fs.readFile(path.join(current.workspace, "SOUL.md"), "utf8")).resolves.toBe(
        "managed\n",
      );
    },
  );

  it.each([
    { successor: "removing", reject: false },
    { successor: "removing", reject: true },
    { successor: "reinstalled", reject: false },
    { successor: "reinstalled", reject: true },
    { successor: "removed", reject: false },
    { successor: "removed", reject: true },
  ])("does not mark $successor partial after stale quiescence (reject=$reject)", async (test) => {
    const current = await fixture();
    const entered = createDeferred<string>();
    const release = createDeferred();
    const enteredNext = createDeferred<string>();
    const releaseNext = createDeferred();
    let next: Promise<GroveRemoveResult> | undefined;
    const stale = current.remove({
      monitorGateway: {
        ...quiescentGroveMonitorGateway,
        quiesce: async (_agentId, operationId) => {
          entered.resolve(operationId);
          await release.promise;
          if (test.reject) {
            throw new Error("original quiescence failure");
          }
        },
      },
    });
    try {
      const originalOperation = await entered.promise;
      expireDeletionLease();
      next = current.remove({
        monitorGateway: {
          ...quiescentGroveMonitorGateway,
          quiesce: async (_agentId, operationId) => {
            enteredNext.resolve(operationId);
            if (test.successor === "removing") {
              await releaseNext.promise;
            }
          },
        },
      });
      expect(await enteredNext.promise).not.toBe(originalOperation);
      if (test.successor !== "removing") {
        expect(await next).toMatchObject({ status: "complete" });
        if (test.successor === "reinstalled") {
          await current.install("replacement");
        }
      }
      const before = readGroveInstallRecord("worker");
      const journal = readAgentDeletionJournal("worker");
      expect(before?.status).toBe(test.successor === "removed" ? undefined : "complete");
      release.resolve();
      expect(await stale).toMatchObject({
        status: "partial",
        error: {
          code: "monitor_cleanup_failed",
          message: expect.stringMatching(
            test.reject
              ? /original quiescence failure|agent deletion core:agent-deletion\/worker was lost/
              : /no longer owns|agent deletion core:agent-deletion\/worker was lost/,
          ),
        },
      });
      expect(readGroveInstallRecord("worker")).toEqual(before);
      expect(readAgentDeletionJournal("worker")).toEqual(journal);
      releaseNext.resolve();
      expect(await next).toMatchObject({ status: "complete" });
    } finally {
      release.resolve();
      releaseNext.resolve();
      await Promise.allSettled([stale, next]);
    }
  });

  it("preserves a late partial result without publishing into the successor's install", async () => {
    const current = await fixture();
    const entered = createDeferred();
    const release = createDeferred();
    const enteredNext = createDeferred();
    const releaseNext = createDeferred();
    let next: Promise<GroveRemoveResult> | undefined;
    const stale = current.remove({
      purgeSessions: async () => {
        entered.resolve();
        await release.promise;
        return true;
      },
    });
    try {
      await entered.promise;
      expireDeletionLease();
      next = current.remove({
        monitorGateway: {
          ...quiescentGroveMonitorGateway,
          quiesce: async () => {
            enteredNext.resolve();
            await releaseNext.promise;
          },
        },
      });
      await enteredNext.promise;
      const before = readGroveInstallRecord("worker");
      const journal = readAgentDeletionJournal("worker");
      release.resolve();
      expect(await stale).toMatchObject({
        status: "partial",
        agentRemoved: true,
        error: {
          code: "monitor_cleanup_failed",
          message: expect.stringMatching(
            /no longer owns|agent deletion core:agent-deletion\/worker was lost/,
          ),
        },
      });
      expect(readGroveInstallRecord("worker")).toEqual(before);
      expect(readAgentDeletionJournal("worker")).toEqual(journal);
      releaseNext.resolve();
      expect(await next).toMatchObject({ status: "complete" });
    } finally {
      release.resolve();
      releaseNext.resolve();
      await Promise.allSettled([stale, next]);
    }
  });

  it.each([true, false])(
    "keeps terminal registry and provenance writes with their owner (complete=%s)",
    async (complete) => {
      const current = await fixture(true);
      await fs.writeFile(
        path.join(current.workspace, "operator-note.txt"),
        "retain this untracked file",
      );
      openBranchAgentDatabase({ agentId: "worker" });
      closeBranchAgentDatabases();
      const entered = createDeferred();
      const release = createDeferred();
      const enteredNext = createDeferred();
      const releaseNext = createDeferred();
      let next: Promise<GroveRemoveResult> | undefined;
      const stale = current.remove({
        trashPath: async (pathname, runtime) => {
          await current.trashPath(pathname, runtime);
          if (pathname === current.state.sessionsDir("worker")) {
            entered.resolve();
            await release.promise;
            return complete;
          }
          return true;
        },
      });
      try {
        await entered.promise;
        expireDeletionLease();
        next = current.remove({
          monitorGateway: {
            ...quiescentGroveMonitorGateway,
            quiesce: async () => {
              enteredNext.resolve();
              await releaseNext.promise;
            },
          },
        });
        await enteredNext.promise;
        const registry = listBranchRegisteredAgentDatabases();
        const install = readGroveInstallRecord("worker");
        const files = readGroveWorkspaceFiles("worker");
        const journal = readAgentDeletionJournal("worker");
        expect(registry.some((entry) => entry.agentId === "worker")).toBe(true);
        expect(files).toHaveLength(1);
        release.resolve();
        expect(await stale).toMatchObject({
          status: "partial",
          agentRemoved: true,
          error: {
            code: "monitor_cleanup_failed",
            message: expect.stringMatching(
              /no longer owns|agent deletion core:agent-deletion\/worker was lost/,
            ),
          },
        });
        expect(listBranchRegisteredAgentDatabases()).toEqual(registry);
        expect(readGroveWorkspaceFiles("worker")).toEqual(files);
        expect(readGroveInstallRecord("worker")).toEqual(install);
        expect(readAgentDeletionJournal("worker")).toEqual(journal);
        releaseNext.resolve();
        expect(await next).toMatchObject({ status: "complete" });
      } finally {
        release.resolve();
        releaseNext.resolve();
        await Promise.allSettled([stale, next]);
      }
    },
  );
});
