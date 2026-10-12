import fs from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import * as sqliteQueries from "../../infra/kysely-sync.js";
import { withBranchStateDatabaseReadSnapshot } from "../../state/branch-state-db-readonly.js";
import { closeBranchStateDatabaseByPathAsync } from "../../state/branch-state-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import {
  createChannelIngressQueue,
  listChannelIngressQueueAccountIdsReadOnly,
} from "./ingress-queue.js";

describe("ingress listing access", () => {
  it("lists without creating the shared state database", async () => {
    await withBranchTestState(
      { layout: "state-only", prefix: "branch-ingress-readonly-", applyEnv: false },
      async ({ stateDir, statePath }) => {
        const sqlitePath = statePath("state", "branch.sqlite");
        await expect(fs.access(sqlitePath)).rejects.toThrow();

        const reader = createChannelIngressQueue<{ text: string }>({
          channelId: "line",
          accountId: "default",
          stateDir,
          access: "read-only",
        });
        // The read-only opener never creates, migrates or configures the file, so a
        // caller that runs before it owns the state cannot bring the store into being.
        // Account discovery runs before the inspection facade is even opened, so it is
        // the first thing that could create the store.
        expect(
          await listChannelIngressQueueAccountIdsReadOnly({ channelId: "line", stateDir }),
        ).toEqual([]);
        await expect(fs.access(sqlitePath)).rejects.toThrow();

        expect(await reader.listPending({ limit: "all" })).toEqual([]);
        expect(await reader.listClaims()).toEqual([]);
        expect(await reader.listFailed?.({ limit: "all" })).toEqual([]);
        await expect(fs.access(sqlitePath)).rejects.toThrow();

        // A read-write queue is what actually creates it, and the read-only reader then
        // sees the same rows - so the empty results above are the access mode, not a
        // broken reader.
        await createChannelIngressQueue<{ text: string }>({
          channelId: "line",
          accountId: "default",
          stateDir,
        }).enqueue("evt-1", { text: "hello" });
        await fs.access(sqlitePath);
        await closeBranchStateDatabaseByPathAsync(sqlitePath);

        const after = createChannelIngressQueue<{ text: string }>({
          channelId: "line",
          accountId: "default",
          stateDir,
          access: "read-only",
        });
        const hostQueries = vi
          .spyOn(sqliteQueries, "executeSqliteQuerySync")
          .mockImplementation(() => {
            throw new Error("Ingress inspection must not query SQLite on the calling thread");
          });
        try {
          expect((await after.listPending({ limit: "all" })).map((row) => row.id)).toEqual([
            "evt-1",
          ]);
          expect(
            await listChannelIngressQueueAccountIdsReadOnly({ channelId: "line", stateDir }),
          ).toEqual(["default"]);
          expect(hostQueries).not.toHaveBeenCalled();
        } finally {
          hostQueries.mockRestore();
        }
      },
    );
  });

  it("creates an absent database for read-write listings after read-only inspection", async () => {
    await withBranchTestState(
      { layout: "state-only", prefix: "branch-ingress-list-admission-", applyEnv: false },
      async ({ stateDir, statePath }) => {
        const sqlitePath = statePath("state", "branch.sqlite");
        const options = { channelId: "line", accountId: "default", stateDir };
        const reader = createChannelIngressQueue({ ...options, access: "read-only" });
        expect(await reader.listPending()).toEqual([]);
        await expect(fs.access(sqlitePath)).rejects.toThrow();

        const queue = createChannelIngressQueue(options);
        expect(await queue.listPending()).toEqual([]);
        await expect(fs.access(sqlitePath)).resolves.toBeUndefined();
      },
    );
  });

  it("observes committed writes inside an older ambient read snapshot", async () => {
    await withBranchTestState(
      { layout: "state-only", prefix: "branch-ingress-list-committed-", applyEnv: false },
      async ({ stateDir, statePath }) => {
        const queue = createChannelIngressQueue<{ text: string }>({
          channelId: "line",
          accountId: "default",
          stateDir,
        });
        await queue.enqueue("before", { text: "before" }, { receivedAt: 1 });
        await withBranchStateDatabaseReadSnapshot(
          async () => {
            await queue.enqueue("after", { text: "after" }, { receivedAt: 2 });
            expect((await queue.listPending({ limit: "all" })).map((row) => row.id)).toEqual([
              "before",
              "after",
            ]);
          },
          {
            path: statePath("state", "branch.sqlite"),
            env: { ...process.env, BRANCH_STATE_DIR: stateDir },
          },
        );
      },
    );
  });
});
