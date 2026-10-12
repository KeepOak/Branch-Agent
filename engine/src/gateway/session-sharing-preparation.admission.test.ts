import { expect, it } from "vitest";
import { publishSessionEntryCacheInvalidation } from "../config/sessions/session-accessor.sqlite-entry-cache.js";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import { createDeferredCore } from "../shared/deferred.js";
import { closeBranchAgentDatabaseByPathAsync } from "../state/branch-agent-db-lifecycle.js";
import {
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "../state/branch-agent-db.js";
import { resolveBranchAgentSqlitePath } from "../state/branch-agent-db.paths.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { prepareSessionMutationFacts } from "./session-sharing-preparation.js";

it.each(["metadata", "reset-aba", "unknown", "retirement"] as const)(
  "retains sharing acquisition across %s while database admission waits",
  async (change) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const cfg = { agents: { entries: { main: {} } } };
      await state.writeConfig(cfg);
      const sessionKey = "agent:main:sharing-admission";
      const storePath = resolveBranchAgentSqlitePath({ agentId: "main" });
      const entry = { sessionId: "admission-session", lifecycleRevision: "original", updatedAt: 1 };
      runBranchAgentWriteTransaction(
        (database) => writeSessionEntry(database, sessionKey, entry),
        { agentId: "main", path: storePath },
      );
      const ready = createDeferredCore();
      const pending = prepareSessionMutationFacts({
        cfg,
        sessionKey,
        agentId: "main",
        storageReady: ready.promise,
      });
      try {
        if (change === "retirement") {
          await closeBranchAgentDatabaseByPathAsync(storePath, "main");
          openBranchAgentDatabase({ agentId: "main", path: storePath });
        } else {
          runBranchAgentWriteTransaction(
            (database) => {
              if (change === "unknown") {
                publishSessionEntryCacheInvalidation(database, { sessionKey });
              } else if (change === "reset-aba") {
                writeSessionEntry(database, sessionKey, { ...entry, lifecycleRevision: "reset" });
                writeSessionEntry(database, sessionKey, entry);
              } else {
                writeSessionEntry(database, sessionKey, { ...entry, updatedAt: 2 });
              }
            },
            { agentId: "main", path: storePath },
          );
        }
        ready.resolve();
        if (change === "metadata") {
          const read = await pending;
          try {
            expect(read.readCurrent(cfg).target).toMatchObject({
              storeKey: sessionKey,
              entry: { ...entry, updatedAt: 2 },
            });
          } finally {
            read.release();
          }
        } else {
          await expect(pending).rejects.toThrow(
            "Session access facts are unavailable; retry after session storage is ready.",
          );
        }
      } finally {
        ready.resolve();
        await pending.then(
          (read) => read.release(),
          () => {},
        );
      }
    });
  },
);
