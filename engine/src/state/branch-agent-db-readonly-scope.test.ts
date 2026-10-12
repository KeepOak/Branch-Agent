import fs from "node:fs";
import nodePath from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { observeSqliteReadSql } from "../../test/helpers/sqlite-statement-execution-counter.js";
import { applyAgentDatabaseReaderRequest } from "../infra/agent-database-readers.js";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabaseByPathAsync,
} from "./branch-agent-db-lifecycle.js";
import { BranchAgentDatabaseReadOnlyScope } from "./branch-agent-db-readonly-scope.js";
import {
  retainBranchAgentDatabaseReadOnly,
  withBranchAgentDatabaseReadOnly,
} from "./branch-agent-db-readonly.js";
import { openBranchAgentDatabase } from "./branch-agent-db.js";
import { resolveBranchAgentSqlitePath } from "./branch-agent-db.paths.js";
import { createBranchDatabaseMaintenanceScope } from "./branch-state-db-async-lifecycle.js";

it("bounds query preparation while scoped reads observe new commits", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    const { path } = openBranchAgentDatabase(options);
    await closeBranchAgentDatabaseByPathAsync(path);
    const scope = new BranchAgentDatabaseReadOnlyScope();
    const writer = new (requireNodeSqlite().DatabaseSync)(path);
    try {
      scope.run({ agentId: "main", path }, () => {
        withBranchAgentDatabaseReadOnly(({ db }) => {
          const query = getNodeSqliteKysely<{
            schema_meta: { meta_key: string; updated_at: number };
          }>(db)
            .selectFrom("schema_meta")
            .select("updated_at")
            .where("meta_key", "=", "primary");
          const prepare = vi.spyOn(db, "prepare");
          const observation = observeSqliteReadSql(requireNodeSqlite().StatementSync.prototype);
          try {
            for (let stamp = 1; stamp <= 20; stamp++) {
              writer
                .prepare("UPDATE schema_meta SET updated_at = ? WHERE meta_key = 'primary'")
                .run(stamp);
              expect(
                withBranchAgentDatabaseReadOnly(
                  (database) => executeSqliteQueryTakeFirstSync(database.db, query)?.updated_at,
                  options,
                ),
              ).toEqual({ found: true, value: stamp });
            }
            const preparations = prepare.mock.calls.filter(([sql]) => sql === query.compile().sql);
            expect(preparations.length).toBeLessThanOrEqual(2);
            expect(
              observation.queries.filter((sql) => /^PRAGMA data_version$/iu.test(sql)),
            ).toHaveLength(20);
            expect(
              observation.queries.filter((sql) =>
                /^SELECT role, schema_version, agent_id/iu.test(sql),
              ),
            ).toHaveLength(20);
          } finally {
            observation.restore();
            prepare.mockRestore();
          }
        }, options);
      });
    } finally {
      writer.close();
      scope.close();
    }
  });
});

it("keeps one connection while nested reads retain independent committed snapshots", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    const { path } = openBranchAgentDatabase(options);
    await closeBranchAgentDatabaseByPathAsync(path);
    const target = { agentId: "main", path };
    const scope = new BranchAgentDatabaseReadOnlyScope();
    const writer = new (requireNodeSqlite().DatabaseSync)(path);
    let retained: DatabaseSync | undefined;
    const query = "SELECT updated_at FROM schema_meta WHERE meta_key = 'primary'";
    try {
      scope.run(target, () => {
        const first = withBranchAgentDatabaseReadOnly(({ db }) => {
          retained = db;
          return db.prepare(query).get();
        }, options);
        expect(first.found).toBe(true);
        expect(retained?.isOpen).toBe(true);
        withBranchAgentDatabaseReadOnly(({ db }) => {
          expect(db).toBe(retained);
          db.exec("BEGIN DEFERRED");
          try {
            const before = db.prepare(query).get();
            writer
              .prepare(
                "UPDATE schema_meta SET updated_at = updated_at + 1 WHERE meta_key = 'primary'",
              )
              .run();
            const committed = writer.prepare(query).get();
            expect(committed).not.toEqual(before);
            const nested = withBranchAgentDatabaseReadOnly(({ db: inner }) => {
              expect(inner).not.toBe(db);
              return inner.prepare(query).get();
            }, options);
            expect(nested).toEqual({ found: true, value: committed });
            expect(db.prepare(query).get()).toEqual(before);
          } finally {
            db.exec("ROLLBACK");
          }
        }, options);
        expect(
          withBranchAgentDatabaseReadOnly(({ db }) => db.prepare(query).get(), options),
        ).toEqual({ found: true, value: writer.prepare(query).get() });
      });
    } finally {
      writer.close();
      scope.close();
    }
    expect(retained?.isOpen).toBe(false);
  });
});

it.each([
  {
    sql: `PRAGMA user_version = ${BRANCH_AGENT_SCHEMA_VERSION + 1}`,
    error: "newer schema version",
  },
  {
    sql: `PRAGMA user_version = ${BRANCH_AGENT_SCHEMA_VERSION - 1}`,
    error: "run branch doctor --fix",
  },
  {
    sql: "UPDATE schema_meta SET agent_id = 'another' WHERE meta_key = 'primary'",
    error: "belongs to agent another",
  },
  {
    sql: "UPDATE schema_meta SET role = 'state' WHERE meta_key = 'primary'",
    error: "has schema role state",
  },
  {
    sql: "DROP TRIGGER session_nodes_canonical_pending_after_update",
    error: "canonical validation schema is missing or drifted",
  },
])(
  "revalidates retained read admission on the next read after a commit: $sql",
  async ({ sql, error }) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const options = { agentId: "main", env: state.env };
      const { path } = openBranchAgentDatabase(options);
      await closeBranchAgentDatabaseByPathAsync(path);
      const target = { agentId: "main", path };
      const scope = new BranchAgentDatabaseReadOnlyScope();
      const read = () =>
        scope.run(target, () => withBranchAgentDatabaseReadOnly(() => "admitted", options));
      try {
        expect(read()).toEqual({ found: true, value: "admitted" });
        const writer = new (requireNodeSqlite().DatabaseSync)(path);
        try {
          writer.exec(sql);
        } finally {
          writer.close();
        }
        expect(read).toThrow(error);
      } finally {
        scope.close();
      }
    });
  },
);

it("reuses ordinary readers until idle expiry and reopens after lifecycle invalidation", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    const { path } = openBranchAgentDatabase(options);
    await closeBranchAgentDatabaseByPathAsync(path);
    const open = vi.spyOn(nodeSqlite, "openNodeSqliteDatabase");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const read = () => withBranchAgentDatabaseReadOnly(({ db }) => db, options);
    const opens = () => open.mock.calls.filter(([filename]) => filename === path).length;
    try {
      const first = read();
      expect(first.found).toBe(true);
      if (!first.found) {
        throw new Error("Missing synthetic agent database");
      }
      for (let index = 0; index < 20; index++) {
        expect(read()).toEqual(first);
      }
      expect(opens()).toBe(1);
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
      expect(read()).toEqual(first);
      vi.advanceTimersByTime(1);
      expect(first.value.isOpen).toBe(true);
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
      expect(first.value.isOpen).toBe(false);
      const reopened = read();
      expect(opens()).toBe(2);
      closeBranchAgentDatabaseByPath(path);
      expect(reopened.found && reopened.value.isOpen).toBe(false);
      const replacement = read();
      expect(replacement.found).toBe(true);
      expect(opens()).toBe(3);
      await Promise.resolve();
      expect(replacement.found && replacement.value.isOpen).toBe(true);
      if (replacement.found) {
        replacement.value.close();
      }
      expect(() => vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS)).not.toThrow();
      expect(read().found).toBe(true);
      expect(opens()).toBe(4);
    } finally {
      vi.useRealTimers();
      open.mockRestore();
    }
  });
});

it("pins retained readers through idle expiry but revokes them before database removal", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    const { path } = openBranchAgentDatabase(options);
    await closeBranchAgentDatabaseByPathAsync(path);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const retained = retainBranchAgentDatabaseReadOnly(options);
      expect(retained.found).toBe(true);
      if (!retained.found) {
        throw new Error("Missing synthetic agent database");
      }
      expect(() =>
        withBranchAgentDatabaseReadOnly(() => "wrong owner", {
          ...options,
          path,
          agentId: "other",
        }),
      ).toThrow("belongs to agent main; requested agent other");
      expect(retained.claim.isCurrent()).toBe(true);
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      expect(retained.claim.isCurrent()).toBe(true);
      const other = retainBranchAgentDatabaseReadOnly(options);
      expect(other.found && other.database.db).toBe(retained.database.db);
      if (other.found) {
        other.claim.release();
      }
      retained.claim.release();
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
      expect(retained.database.db.isOpen).toBe(true);
      vi.advanceTimersByTime(1);
      expect(retained.database.db.isOpen).toBe(false);
      const stale = retainBranchAgentDatabaseReadOnly(options);
      if (!stale.found) {
        throw new Error("Missing synthetic agent database");
      }
      stale.database.db.close();
      const next = retainBranchAgentDatabaseReadOnly(options);
      if (!next.found) {
        throw new Error("Missing synthetic replacement reader");
      }
      next.claim.release();
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      expect(next.database.db.isOpen).toBe(false);
      stale.claim.release();
      const reopened = retainBranchAgentDatabaseReadOnly(options);
      expect(reopened.found).toBe(true);
      await closeBranchAgentDatabaseByPathAsync(path);
      expect(reopened.found && reopened.claim.isCurrent()).toBe(false);
      if (reopened.found) {
        reopened.claim.release();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

it("promotes a reused reader beyond the maintenance scope that first opened it", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const options = { agentId: "main", env: state.env };
    const { path } = openBranchAgentDatabase(options);
    await closeBranchAgentDatabaseByPathAsync(path);
    const parent = createBranchDatabaseMaintenanceScope();
    const child = parent.run(() => createBranchDatabaseMaintenanceScope());
    const read = () => withBranchAgentDatabaseReadOnly(({ db }) => db, options);
    try {
      const first = child.run(read);
      expect(parent.run(read)).toEqual(first);
      await child.close();
      expect(first.found && first.value.isOpen).toBe(true);
      await parent.close();
      expect(first.found && first.value.isOpen).toBe(false);
    } finally {
      await child.close();
      await parent.close();
    }
  });
});

it.each(["database-missing", "schema-missing", "callback-error", "idle-expiry"] as const)(
  "keeps retries owned by their explicit scope after %s",
  async (failure) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const options = { agentId: "scope-retry", env: state.env };
      const pathname = resolveBranchAgentSqlitePath(options);
      const scope = new BranchAgentDatabaseReadOnlyScope();
      const create = () => {
        openBranchAgentDatabase(options);
        closeBranchAgentDatabaseByPath(pathname);
      };
      if (failure === "callback-error" || failure === "idle-expiry") {
        create();
      } else if (failure === "schema-missing") {
        fs.mkdirSync(nodePath.dirname(pathname), { recursive: true });
        nodeSqlite.openNodeSqliteDatabase(pathname).close();
      }
      if (failure === "idle-expiry") {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      }
      try {
        await scope.run({ agentId: options.agentId, path: pathname }, async () => {
          if (failure === "idle-expiry") {
            const first = withBranchAgentDatabaseReadOnly(({ db }) => db, options);
            await Promise.resolve();
            vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
            expect(first.found && first.value.isOpen).toBe(false);
          } else if (failure === "callback-error") {
            const error = new Error("synthetic reader failure");
            expect(() =>
              withBranchAgentDatabaseReadOnly(() => {
                throw error;
              }, options),
            ).toThrow(error);
          } else {
            expect(withBranchAgentDatabaseReadOnly(() => "unreachable", options)).toEqual({
              found: false,
              reason: failure,
            });
            create();
          }
          const reopened = withBranchAgentDatabaseReadOnly(({ db }) => db, options);
          expect(reopened.found && reopened.value.isOpen).toBe(true);
          scope.close();
          expect(reopened.found && reopened.value.isOpen).toBe(false);
        });
      } finally {
        scope.close();
        vi.useRealTimers();
      }
    });
  },
);

it("closes generic and explicit candidate-family readers without releasing unrelated paths", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const family = state.statePath("selected.sqlite");
    const sibling = state.statePath("selected.extra.sqlite");
    const unrelated = state.statePath("unrelated.sqlite");
    const options = (path: string) => ({ agentId: "main", path, env: state.env });
    for (const path of [family, sibling, unrelated]) {
      openBranchAgentDatabase(options(path));
      await closeBranchAgentDatabaseByPathAsync(path);
    }
    const scope = new BranchAgentDatabaseReadOnlyScope();
    const read = (path: string) => {
      const result = withBranchAgentDatabaseReadOnly(({ db }) => db, options(path));
      if (!result.found) {
        throw new Error("Missing synthetic reader database");
      }
      return result.value;
    };
    const selected = read(family);
    const explicit = scope.run(options(sibling), () => read(sibling));
    const retained = read(unrelated);
    const candidates = [{ path: family, scope: "sibling-family" as const }];
    const closeReaders = () =>
      applyAgentDatabaseReaderRequest({ kind: "close", candidates, deleted: false });
    try {
      await closeReaders();
      expect(selected.isOpen).toBe(false);
      expect(explicit.isOpen).toBe(false);
      expect(retained.isOpen).toBe(true);
      expect(read(unrelated)).toBe(retained);

      const reopened = scope.run(options(sibling), () => read(sibling));
      const failure = new Error("native reader close failed");
      const close = vi.spyOn(reopened, "close").mockImplementation(() => {
        throw failure;
      });
      const causes = (error: unknown): unknown[] =>
        error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
      try {
        await expect(closeReaders()).rejects.toSatisfy(
          (error: unknown) => error instanceof AggregateError && causes(error).includes(failure),
        );
        expect(reopened.isOpen).toBe(true);
        expect(() => scope.run(options(sibling), () => read(sibling))).toThrow(
          "native cleanup is pending",
        );
        close.mockRestore();
        await closeReaders();
        expect(reopened.isOpen).toBe(false);
        expect(retained.isOpen).toBe(true);
      } finally {
        close.mockRestore();
      }
    } finally {
      scope.close();
    }
  });
});
