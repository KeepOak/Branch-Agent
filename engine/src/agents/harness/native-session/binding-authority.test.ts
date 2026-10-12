import { expect, it, vi } from "vitest";
import { createDeferred } from "../../../../test/helpers/promise.js";
import { trackSqliteStatementExecutions } from "../../../../test/helpers/sqlite-statement-execution-counter.js";
import { replaceSessionEntrySync } from "../../../config/sessions/session-accessor.sqlite-entry.js";
import {
  resolveSqliteScope,
  toDatabaseOptions,
} from "../../../config/sessions/session-accessor.sqlite-scope.js";
import * as sessionReads from "../../../config/sessions/session-entry-read-runtime.js";
import { closeBranchAgentDatabaseByPathAsync } from "../../../state/branch-agent-db-lifecycle.js";
import { openBranchAgentDatabase } from "../../../state/branch-agent-db.js";
import { withBranchTestState } from "../../../test-utils/branch-test-state.js";
import {
  createNativeSessionBindingAuthority,
  readNativeSessionBindingEntries,
} from "./binding-authority.js";

it("admits incognito predecessor lineage without SQL and rejects changed lineage", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const scope = { agentId: "main", sessionKey: "agent:main:dashboard:incognito-lineage", env };
    const entry = { sessionId: "current", previousSessionId: "predecessor", updatedAt: 1 };
    replaceSessionEntrySync(scope, entry);
    const database = openBranchAgentDatabase(toDatabaseOptions(resolveSqliteScope(scope)));
    const authority = createNativeSessionBindingAuthority(
      [
        {
          read: { ...scope, storePath: database.path },
          sessionId: entry.sessionId,
          previousSessionId: entry.previousSessionId,
          createSupersededError: () => new Error("native lineage superseded"),
        },
      ],
      () => {},
    );
    const queries = trackSqliteStatementExecutions(database.db, ["all"], () => "all");
    let mutation: Awaited<ReturnType<typeof authority.prepareMutation>>;
    try {
      await expect(authority.withCurrent(() => "admitted")).resolves.toBe("admitted");
      mutation = await authority.prepareMutation();
      mutation.assertCurrent();
      expect(queries.counts.all).toBe(0);
    } finally {
      queries.restore();
    }
    replaceSessionEntrySync(scope, {
      ...entry,
      previousSessionId: "changed-predecessor",
      updatedAt: 2,
    });
    expect(mutation.assertCurrent).toThrow("native lineage superseded");
    await expect(authority.withCurrent(() => "stale")).rejects.toThrow("native lineage superseded");
    await expect(authority.prepareMutation()).rejects.toThrow("native lineage superseded");
  });
});

it("keeps the incognito source incarnation across a durable lineage wait", async () => {
  await withBranchTestState({ scenario: "minimal" }, async ({ env }) => {
    const scope = { agentId: "main", sessionKey: "agent:main:dashboard:incognito-custody", env };
    const entry = { sessionId: "same-session", updatedAt: 1 };
    replaceSessionEntrySync(scope, entry);
    const database = openBranchAgentDatabase(toDatabaseOptions(resolveSqliteScope(scope)));
    const durableScope = { agentId: "main", sessionKey: "agent:main:durable-custody", env };
    replaceSessionEntrySync(durableScope, { sessionId: "durable", updatedAt: 1 });
    const durable = openBranchAgentDatabase(toDatabaseOptions(resolveSqliteScope(durableScope)));
    const started = createDeferred();
    const proceed = createDeferred();
    const read = sessionReads.withSessionEntriesFromStoresInWorker;
    const delayed = vi
      .spyOn(sessionReads, "withSessionEntriesFromStoresInWorker")
      .mockImplementationOnce(async (inputs, consume, options) => {
        started.resolve();
        await proceed.promise;
        return read(inputs, consume, options);
      });
    const consume = vi.fn();
    const outcome = readNativeSessionBindingEntries(
      [
        { ...scope, storePath: database.path },
        { ...durableScope, storePath: durable.path },
      ],
      consume,
    ).catch((error: unknown) => error);
    try {
      await started.promise;
      await closeBranchAgentDatabaseByPathAsync(database.path, database.agentId);
      replaceSessionEntrySync(scope, entry);
      proceed.resolve();
      expect(await outcome).toMatchObject({ message: "Session currency incognito owner changed" });
      expect(consume).not.toHaveBeenCalled();
    } finally {
      proceed.resolve();
      await outcome;
      delayed.mockRestore();
    }
  });
});
