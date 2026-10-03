import { expect, it } from "vitest";
import { sessionChanges, type SessionRowChange } from "../../sessions/session-row-changes.js";
import {
  registerBranchAgentDatabase,
  unregisterBranchAgentDatabase,
  unregisterBranchAgentDatabases,
} from "../../state/branch-agent-db-registry.js";
import {
  openBranchAgentDatabase,
  resolveIncognitoBranchAgentSqlitePath,
  runBranchAgentWriteTransaction,
} from "../../state/branch-agent-db.js";
import { runBranchStateWriteTransaction } from "../../state/branch-state-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { replaceSessionEntrySync } from "./session-accessor.js";
import {
  publishSessionEntryCacheInvalidation,
  readSessionEntryCache,
} from "./session-accessor.sqlite-entry-cache.js";
import { deleteSessionEntryRows } from "./session-accessor.sqlite-entry-store.js";
import { ensureTranscriptSessionRoot } from "./session-accessor.sqlite-transcript-state.js";
import type { InternalSessionEntry } from "./types.js";

it("publishes row changes after the complete entry transaction and discards rollback", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const scope = { agentId: "main", sessionKey: "agent:main:row-change" };
    const entry = { sessionId: "row-change", updatedAt: 1, label: "before" };
    replaceSessionEntrySync(scope, entry);
    const database = openBranchAgentDatabase({ agentId: "main" });
    const snapshot = readSessionEntryCache(database, { cache: true });
    const prepared: Array<string | undefined> = [];
    const seen: Array<{
      change: SessionRowChange;
      label?: string;
      transaction: boolean;
      prepared: Array<string | undefined>;
    }> = [];
    const unsubscribe = sessionChanges.subscribe((change) => {
      seen.push({
        change,
        label: snapshot.entries.get(scope.sessionKey)?.label,
        transaction: database.db.isTransaction,
        prepared: [...prepared],
      });
    });
    const stopProjection = sessionChanges.subscribeProjection(() => {
      prepared.push(snapshot.entries.get(scope.sessionKey)?.label);
    });
    try {
      expect(() =>
        runBranchAgentWriteTransaction(
          () => {
            replaceSessionEntrySync(scope, { ...entry, label: "rolled-back" });
            expect(seen).toEqual([]);
            throw new Error("rollback");
          },
          { agentId: "main" },
        ),
      ).toThrow("rollback");
      expect(seen).toEqual([]);
      expect(prepared).toEqual([]);
      runBranchAgentWriteTransaction(
        () => {
          replaceSessionEntrySync(scope, { ...entry, label: "intermediate" });
          replaceSessionEntrySync(scope, { ...entry, label: "committed" });
          expect(seen).toEqual([]);
        },
        { agentId: "main" },
      );
      expect(seen).toEqual(
        Array.from({ length: 2 }, () => ({
          change: { ...scope, storePath: database.path, scope: "session-entry" },
          label: "committed",
          transaction: false,
          prepared: ["committed", "committed"],
        })),
      );
      seen.length = 0;
      publishSessionEntryCacheInvalidation(database, { sessionKey: scope.sessionKey });
      expect(seen.map(({ change }) => change)).toEqual([{ ...scope, storePath: database.path }]);
      unsubscribe();
      replaceSessionEntrySync(scope, entry);
      expect(seen).toHaveLength(1);
    } finally {
      unsubscribe();
      stopProjection();
    }
  });
});

it.each(["delete", "retain-windows", "first-transcript"] as const)(
  "publishes only the changed key for a cold %s write after commit",
  async (operation) => {
    await withBranchTestState({ scenario: "minimal" }, async () => {
      const scope = { agentId: "main", sessionKey: "agent:main:cold-change" };
      replaceSessionEntrySync(
        { ...scope, sessionKey: "agent:main:untouched-archive" },
        { sessionId: "untouched-archive", updatedAt: 1, archivedAt: 1 },
      );
      if (operation !== "first-transcript") {
        replaceSessionEntrySync(scope, {
          sessionId: "cold-change",
          updatedAt: 1,
          archivedAt: 1,
        });
      }
      const database = openBranchAgentDatabase({ agentId: scope.agentId });
      const changes: SessionRowChange[] = [];
      const unsubscribe = sessionChanges.subscribe((change) => changes.push(change));
      try {
        runBranchAgentWriteTransaction((writer) => {
          if (operation === "first-transcript") {
            ensureTranscriptSessionRoot(writer, { ...scope, sessionId: "cold-change" }, 2);
          } else {
            deleteSessionEntryRows(writer, scope.sessionKey, {
              deleteOwnedWindows: operation === "delete",
            });
          }
          expect(changes).toEqual([]);
        }, scope);
        expect(changes).toEqual([
          {
            ...scope,
            storePath: database.path,
            ...(operation !== "first-transcript" ? { scope: "session-entry" } : {}),
          },
        ]);
      } finally {
        unsubscribe();
      }
    });
  },
);

it("publishes committed registry changes while discarding a rolled-back agent removal", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const database = openBranchAgentDatabase({ agentId: "main" });
    const target = { agentId: "main", path: database.path };
    const changes: SessionRowChange[] = [];
    const unsubscribe = sessionChanges.subscribe((change) => changes.push(change));
    try {
      for (const mutate of [
        () => registerBranchAgentDatabase(target),
        () => unregisterBranchAgentDatabase(target),
        () => unregisterBranchAgentDatabases({ agentId: "main" }),
      ]) {
        expect(() =>
          runBranchStateWriteTransaction(() => {
            mutate();
            throw new Error("rollback");
          }),
        ).toThrow("rollback");
        expect(changes).toEqual([]);
      }
      expect(() =>
        runBranchStateWriteTransaction((state) => {
          unregisterBranchAgentDatabases({ agentId: "main", database: state });
          expect(changes).toEqual([]);
          throw new Error("rollback");
        }),
      ).toThrow("rollback");
      expect(changes).toEqual([]);
      unregisterBranchAgentDatabase(target);
      registerBranchAgentDatabase(target);
      unregisterBranchAgentDatabases({ agentId: "main" });
      expect(changes).toEqual(
        Array.from({ length: 3 }, () => ({
          all: true,
          scope: { agentId: "main", topology: true },
        })),
      );
    } finally {
      unsubscribe();
    }
  });
});

it("keeps Incognito publications committed and free of connection capabilities", async () => {
  await withBranchTestState({ scenario: "minimal" }, async () => {
    const scope = {
      agentId: "main",
      sessionKey: "agent:main:dashboard:incognito-row-change",
      storePath: resolveIncognitoBranchAgentSqlitePath({ agentId: "main" }),
    };
    const entry = {
      sessionId: "private-row-change",
      createdAt: 1,
      updatedAt: 1,
      label: "Private label must not enter lifetime facts",
      incognito: true,
    } satisfies InternalSessionEntry;
    replaceSessionEntrySync(scope, entry);
    const projections: SessionRowChange[] = [];
    const notifications: SessionRowChange[] = [];
    const stopProjection = sessionChanges.subscribeProjection((change) => projections.push(change));
    const stopNotification = sessionChanges.subscribe((change) => notifications.push(change));
    const write = () => {
      replaceSessionEntrySync(scope, { ...entry, updatedAt: 2 });
      expect(projections).toEqual([]);
      expect(notifications).toEqual([]);
    };
    try {
      expect(() =>
        runBranchAgentWriteTransaction(
          () => {
            write();
            throw new Error("rollback");
          },
          { agentId: scope.agentId, path: scope.storePath },
        ),
      ).toThrow("rollback");
      expect(projections).toEqual([]);
      expect(notifications).toEqual([]);
      runBranchAgentWriteTransaction(write, { agentId: scope.agentId, path: scope.storePath });
      expect(projections).toEqual([
        {
          ...scope,
          scope: "session-entry",
          facts: expect.objectContaining({ kind: "entry", sessionId: entry.sessionId }),
        },
      ]);
      expect(notifications).toEqual([{ ...scope, scope: "session-entry" }]);
    } finally {
      stopProjection();
      stopNotification();
    }
  });
});
