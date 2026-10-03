import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CanopyExecution } from "@branch/canopy-contract";
import { resolveRuntimeWorkerUrl } from "branch/plugin-sdk/process-runtime";
import { describe, expect, it, vi } from "vitest";
import { createCanopyLifecycleService, syncCanopySubagentEnded } from "./lifecycle-sync.js";
import { canopySqliteBackendEntrypoint } from "./sqlite-backend-entrypoint.test-support.js";
import { createCanopySqliteStores } from "./sqlite-store.js";
import { CanopyStore } from "./store.js";
import { sqliteTestAuxStores } from "./test/sqlite-store.js";

const workerModuleUrl = resolveRuntimeWorkerUrl(canopySqliteBackendEntrypoint);

const SESSION_KEY = "agent:main:subagent:canopy-cleanup-recovery";
const RUN_ID = "run-cleanup-recovery";
const MANAGED_PATH = "/state/worktrees/recovery/wb-card";
const SOURCE_PATH = "/repo";

function openStore(dbPath: string) {
  const stores = createCanopySqliteStores({ dbPath, workerModuleUrl });
  return { store: new CanopyStore(stores.cards, sqliteTestAuxStores(stores)), stores };
}

function execution(
  sessionKey: string,
  runId: string,
  status: CanopyExecution["status"],
): CanopyExecution {
  return {
    id: `exec-${runId}`,
    kind: "agent-session",
    mode: "autonomous",
    status,
    sessionKey,
    runId,
    startedAt: 1000,
    updatedAt: 1000,
  };
}

async function createManagedCard(
  store: CanopyStore,
  options: {
    managedPath?: string;
    status?: "blocked" | "running" | "review";
    withExecutionAssociation?: boolean;
  } = {},
) {
  const status = options.status ?? "running";
  const withExecutionAssociation = options.withExecutionAssociation !== false;
  return await store.create({
    title: "Recover managed worktree cleanup",
    status,
    ...(withExecutionAssociation
      ? {
          sessionKey: SESSION_KEY,
          runId: RUN_ID,
          execution: execution(SESSION_KEY, RUN_ID, status),
        }
      : {}),
    workspace: {
      kind: "worktree",
      path: options.managedPath ?? MANAGED_PATH,
      branch: "branch/wb-card",
      sourcePath: SOURCE_PATH,
      sourceBranch: "main",
    },
  });
}

function doneSessionSnapshot(updatedAt: number) {
  return vi.fn().mockResolvedValue({
    sessions: [
      {
        key: SESSION_KEY,
        status: "done" as const,
        hasActiveRun: false,
        updatedAt,
      },
    ],
    complete: true,
  });
}

const context = { logger: { warn: vi.fn() } } as never;

describe("Canopy managed-worktree cleanup recovery", () => {
  it("retries cleanup after a hook failure and process restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-cleanup-recovery-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    const initial = openStore(dbPath);
    const card = await createManagedCard(initial.store);
    const removeIfLossless = vi
      .fn()
      .mockRejectedValueOnce(new Error("worktree registry unavailable"))
      .mockResolvedValueOnce(true);
    const worktrees = { removeIfLossless };

    await expect(
      syncCanopySubagentEnded({
        store: initial.store,
        worktrees,
        event: {
          targetSessionKey: SESSION_KEY,
          runId: RUN_ID,
          endedAt: card.updatedAt + 1,
          outcome: "ok",
        },
      }),
    ).rejects.toThrow("worktree registry unavailable");
    await initial.stores.close();

    const restarted = openStore(dbPath);
    const service = createCanopyLifecycleService({
      store: restarted.store,
      readSessions: doneSessionSnapshot(card.updatedAt + 1),
      worktrees,
    });

    try {
      await restarted.store.ready();
      await service.start(context);
      service.onGatewayStart();
      await vi.waitFor(async () => {
        expect(removeIfLossless).toHaveBeenCalledTimes(2);
        expect(removeIfLossless).toHaveBeenLastCalledWith({
          path: MANAGED_PATH,
          ownerKind: "canopy",
          ownerId: card.id,
        });
        const recovered = await restarted.store.get(card.id);
        expect(recovered).toMatchObject({ status: "review", execution: { status: "review" } });
        expect(recovered?.metadata?.automation?.workspace).toEqual({
          kind: "worktree",
          path: SOURCE_PATH,
          branch: "main",
        });
      });
    } finally {
      service.onGatewayStop();
      await service.stop?.(context);
      await restarted.stores.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans a freshly reconciled terminal worktree in the initial restart sweep", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-cleanup-fresh-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    const initial = openStore(dbPath);
    const card = await createManagedCard(initial.store);
    await initial.stores.close();

    const restarted = openStore(dbPath);
    const removeIfLossless = vi.fn().mockResolvedValue(true);
    const service = createCanopyLifecycleService({
      store: restarted.store,
      readSessions: doneSessionSnapshot(card.updatedAt + 1),
      worktrees: { removeIfLossless },
    });

    try {
      await restarted.store.ready();
      await service.start(context);
      service.onGatewayStart();
      await vi.waitFor(async () => {
        expect(removeIfLossless).toHaveBeenCalledOnce();
        expect((await restarted.store.get(card.id))?.metadata?.automation?.workspace).toEqual({
          kind: "worktree",
          path: SOURCE_PATH,
          branch: "main",
        });
      });
    } finally {
      service.onGatewayStop();
      await service.stop?.(context);
      await restarted.stores.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists a retained worktree obligation and retries it after restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-cleanup-retained-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    const managedPath = path.join(dir, "managed-worktree");
    fs.mkdirSync(managedPath);
    const initial = openStore(dbPath);
    const card = await createManagedCard(initial.store, { managedPath, status: "review" });
    await initial.stores.close();
    const removeIfLossless = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        fs.rmSync(managedPath, { recursive: true });
        return true;
      });

    const retained = openStore(dbPath);
    const firstService = createCanopyLifecycleService({
      store: retained.store,
      readSessions: doneSessionSnapshot(card.updatedAt),
      worktrees: { removeIfLossless },
    });
    await retained.store.ready();
    await firstService.start(context);
    firstService.onGatewayStart();
    await vi.waitFor(() => expect(removeIfLossless).toHaveBeenCalledOnce());
    firstService.onGatewayStop();
    await firstService.stop?.(context);
    expect((await retained.store.get(card.id))?.metadata?.automation?.workspace).toMatchObject({
      path: managedPath,
      sourcePath: SOURCE_PATH,
    });
    await retained.stores.close();

    const restarted = openStore(dbPath);
    const secondService = createCanopyLifecycleService({
      store: restarted.store,
      readSessions: doneSessionSnapshot(card.updatedAt),
      worktrees: { removeIfLossless },
    });
    try {
      await restarted.store.ready();
      await secondService.start(context);
      secondService.onGatewayStart();
      await vi.waitFor(async () => {
        expect(removeIfLossless).toHaveBeenCalledTimes(2);
        expect((await restarted.store.get(card.id))?.metadata?.automation?.workspace).toEqual({
          kind: "worktree",
          path: SOURCE_PATH,
          branch: "main",
        });
      });
    } finally {
      secondService.onGatewayStop();
      await secondService.stop?.(context);
      await restarted.stores.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans a blocked pre-start worktree without an execution association", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-cleanup-blocked-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    const initial = openStore(dbPath);
    const card = await createManagedCard(initial.store, {
      status: "blocked",
      withExecutionAssociation: false,
    });
    await initial.stores.close();

    const restarted = openStore(dbPath);
    const readSessions = vi.fn();
    const removeIfLossless = vi.fn().mockResolvedValue(true);
    const service = createCanopyLifecycleService({
      store: restarted.store,
      readSessions,
      worktrees: { removeIfLossless },
    });
    try {
      await restarted.store.ready();
      await service.start(context);
      service.onGatewayStart();
      await vi.waitFor(async () => {
        expect(removeIfLossless).toHaveBeenCalledOnce();
        expect(readSessions).not.toHaveBeenCalled();
        expect((await restarted.store.get(card.id))?.metadata?.automation?.workspace).toEqual({
          kind: "worktree",
          path: SOURCE_PATH,
          branch: "main",
        });
      });
    } finally {
      service.onGatewayStop();
      await service.stop?.(context);
      await restarted.stores.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not clean a matched card after a newer running attempt wins the race", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-cleanup-race-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    const initial = openStore(dbPath);
    const card = await createManagedCard(initial.store);
    const newerSessionKey = "agent:newer:subagent:canopy-cleanup-recovery";
    const originalSync = initial.store.syncLifecycle.bind(initial.store);
    vi.spyOn(initial.store, "syncLifecycle").mockImplementationOnce(async (id, input) => {
      await initial.store.update(id, {
        sessionKey: newerSessionKey,
        runId: "newer-run",
        execution: execution(newerSessionKey, "newer-run", "running"),
      });
      return await originalSync(id, input);
    });
    const removeIfLossless = vi.fn().mockResolvedValue(true);

    try {
      await expect(
        syncCanopySubagentEnded({
          store: initial.store,
          worktrees: { removeIfLossless },
          event: {
            targetSessionKey: SESSION_KEY,
            runId: RUN_ID,
            endedAt: card.updatedAt + 1,
            outcome: "ok",
          },
        }),
      ).resolves.toBe(0);
      expect(removeIfLossless).not.toHaveBeenCalled();
      await expect(initial.store.get(card.id)).resolves.toMatchObject({
        status: "running",
        runId: "newer-run",
        execution: { status: "running", runId: "newer-run" },
      });
    } finally {
      await initial.stores.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
