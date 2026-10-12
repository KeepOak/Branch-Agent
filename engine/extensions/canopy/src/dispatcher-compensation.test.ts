import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRuntimeWorkerUrl } from "branch/plugin-sdk/process-runtime";
import { describe, expect, it, vi } from "vitest";
import { dispatchAndStartCanopyCards } from "./dispatcher.js";
import { canopySqliteBackendEntrypoint } from "./sqlite-backend-entrypoint.test-support.js";
import { createCanopySqliteStores } from "./sqlite-store.js";
import { CanopyStore } from "./store.js";
import { sqliteTestAuxStores } from "./test/sqlite-store.js";

const workerModuleUrl = resolveRuntimeWorkerUrl(canopySqliteBackendEntrypoint);

describe("Canopy dispatcher compensation", () => {
  it.each([
    {
      edit: "unrelated notes",
      hostWorkspace: undefined,
      expectedWorkspace: { kind: "worktree", path: "/repo", branch: "main" } as const,
    },
    {
      edit: "workspace",
      hostWorkspace: {
        kind: "worktree",
        path: "/host-workspace",
        branch: "host-branch",
        sourcePath: "/host-source",
        sourceBranch: "host-base",
      } as const,
      expectedWorkspace: {
        kind: "worktree",
        path: "/host-workspace",
        branch: "host-branch",
        sourcePath: "/host-source",
        sourceBranch: "host-base",
      } as const,
    },
  ])("compensates a materialized workspace after a concurrent $edit edit", async (testCase) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-canopy-dispatch-rollback-"));
    const dbPath = path.join(dir, "canopy.sqlite");
    const dispatchStores = createCanopySqliteStores({ dbPath, workerModuleUrl });
    const hostStores = createCanopySqliteStores({ dbPath, workerModuleUrl });
    const store = new CanopyStore(dispatchStores.cards, sqliteTestAuxStores(dispatchStores));
    const host = new CanopyStore(hostStores.cards, sqliteTestAuxStores(hostStores));
    try {
      const card = await store.create({
        title: "Isolated worker",
        status: "ready",
        workspace: { kind: "worktree", path: "/repo", branch: "main" },
        workspaceAccess: { unrestricted: true },
      });
      const worktrees = {
        resolveCheckoutRoot: vi.fn().mockResolvedValue(undefined),
        create: vi.fn().mockResolvedValue({
          id: "managed-id",
          path: "/state/worktrees/fingerprint/wb-card",
          branch: `branch/wb-${card.id}`,
        }),
        release: vi.fn(),
        removeIfLossless: vi.fn().mockResolvedValue(true),
      };
      const run = vi.fn(async () => {
        await host.update(card.id, {
          notes: "Concurrent host edit",
          ...(testCase.hostWorkspace ? { workspace: testCase.hostWorkspace } : {}),
        });
        throw new Error("model unavailable");
      });

      const result = await dispatchAndStartCanopyCards({
        store,
        subagent: { run },
        worktrees,
        options: { now: 10, maxStarts: 1, materializeWorktree: true },
      });

      expect(result.startFailures).toEqual([
        expect.objectContaining({ cardId: card.id, error: "model unavailable" }),
      ]);
      const persisted = await host.get(card.id);
      expect(persisted).toMatchObject({
        status: "blocked",
        notes: "Concurrent host edit",
      });
      expect(persisted?.metadata?.automation?.workspace).toEqual(testCase.expectedWorkspace);
    } finally {
      await hostStores.close();
      await dispatchStores.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
