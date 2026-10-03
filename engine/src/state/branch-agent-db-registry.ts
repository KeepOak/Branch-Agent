import { statSync } from "node:fs";
import path from "node:path";
import { resolveIdentityPathViaExistingAncestorSync } from "../infra/boundary-path.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import { stageSqliteTransactionState } from "../infra/sqlite-post-commit.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import {
  assertAgentDeletionPathFence,
  prepareAgentDeletionPathFence,
} from "./agent-deletion-journal.js";
import {
  BRANCH_AGENT_SCHEMA_VERSION,
  type BranchAgentDatabaseRegistrationObserver,
} from "./branch-agent-db-contract.js";
import { invalidateRegisteredAgentDatabasesMemo } from "./branch-agent-db-registry-listing.js";
import {
  invalidateBranchAgentDatabaseValidation,
  invalidateBranchAgentDatabaseValidationsForAgent,
} from "./branch-agent-db-validation-cache.js";
import {
  isPersistentBranchAgentDatabasePath,
  isSameBranchAgentDatabasePath,
} from "./branch-agent-db.paths.js";
import { requireBranchStateDatabaseIdentity } from "./branch-state-db-cache.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";
import type { DB as BranchStateKyselyDatabase } from "./branch-state-db.generated.js";
import { runBranchStateWriteTransaction } from "./branch-state-db.js";
import {
  resolveBranchAgentDatabaseStoredPath,
  resolveBranchRegisteredAgentDatabasePath,
} from "./branch-state-db.paths.js";

export {
  inspectBranchRegisteredAgentDatabases,
  listBranchRegisteredAgentDatabases,
  readBranchAgentDatabaseRegistryToken,
} from "./branch-agent-db-registry-listing.js";

type BranchAgentRegistryDatabase = Pick<BranchStateKyselyDatabase, "agent_databases">;

function resolveRegisteredAgentDatabaseStoredPath(
  database: BranchStateDatabase,
  params: { agentId: string; path: string },
): string {
  const storedPath = resolveBranchAgentDatabaseStoredPath(database.path, params.path);
  if (params.path !== resolveIdentityPathViaExistingAncestorSync(params.path)) {
    return storedPath;
  }
  const db = getNodeSqliteKysely<BranchAgentRegistryDatabase>(database.db);
  const { rows } = executeSqliteQuerySync(
    database.db,
    db.selectFrom("agent_databases").select("path").where("agent_id", "=", params.agentId),
  );
  // A canonical native open must update the existing configured locator, including external aliases.
  return rows.some((row) => row.path === storedPath)
    ? storedPath
    : (rows.find((row) =>
        isSameBranchAgentDatabasePath(
          resolveBranchRegisteredAgentDatabasePath(database.path, row.path),
          params.path,
        ),
      )?.path ?? storedPath);
}

export function registerBranchAgentDatabase(
  params: {
    agentId: string;
    path: string;
    env?: NodeJS.ProcessEnv;
    schemaVersion?: number;
  },
  observer?: BranchAgentDatabaseRegistrationObserver,
): void {
  if (!isPersistentBranchAgentDatabasePath(params.path, params.env)) {
    return;
  }
  const deletionFence = prepareAgentDeletionPathFence(
    { agentId: params.agentId, path: params.path },
    { env: params.env },
  );
  let sizeBytes: number | null = null;
  try {
    sizeBytes = statSync(params.path).size;
  } catch {
    sizeBytes = null;
  }
  const lastSeenAt = Date.now();
  observer?.starting?.();
  runBranchStateWriteTransaction(
    (database) => {
      assertAgentDeletionPathFence(database, deletionFence);
      const storedPath = resolveRegisteredAgentDatabaseStoredPath(database, params);
      const db = getNodeSqliteKysely<BranchAgentRegistryDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        db
          .insertInto("agent_databases")
          .values({
            agent_id: params.agentId,
            path: storedPath,
            schema_version: params.schemaVersion ?? BRANCH_AGENT_SCHEMA_VERSION,
            last_seen_at: lastSeenAt,
            size_bytes: sizeBytes,
          })
          .onConflict((conflict) =>
            conflict.columns(["agent_id", "path"]).doUpdateSet({
              schema_version: params.schemaVersion ?? BRANCH_AGENT_SCHEMA_VERSION,
              last_seen_at: lastSeenAt,
              size_bytes: sizeBytes,
            }),
          ),
      );
      invalidateRegisteredAgentDatabasesMemo({ env: params.env });
      const onCommitted = observer?.committed;
      if (onCommitted) {
        const receipt = Object.freeze({
          agentId: params.agentId,
          agentPath: params.path,
          stateDatabasePath: database.path,
          stateDatabaseIdentity: requireBranchStateDatabaseIdentity(database).key,
        });
        // Record the native fact before fallible observers; the recorder never performs work.
        if (
          !stageSqliteTransactionState(database.db, {
            stage() {},
            rollback() {},
            commit: () => onCommitted(receipt),
          })
        ) {
          throw new Error(
            "Agent registration requires its canonical transaction publication scope",
          );
        }
      }
      sessionChanges.emit(
        { all: true, scope: { agentId: params.agentId, topology: true } },
        database.db,
      );
    },
    { env: params.env },
  );
  invalidateBranchAgentDatabaseValidation(params.path);
}

export function unregisterBranchAgentDatabase(params: {
  agentId: string;
  path: string;
  env?: NodeJS.ProcessEnv;
}): void {
  runBranchStateWriteTransaction(
    (database) => {
      const storedPath = resolveRegisteredAgentDatabaseStoredPath(database, params);
      const matchingPaths = [...new Set([storedPath, params.path, path.resolve(params.path)])];
      const db = getNodeSqliteKysely<BranchAgentRegistryDatabase>(database.db);
      executeSqliteQuerySync(
        database.db,
        db
          .deleteFrom("agent_databases")
          .where("agent_id", "=", params.agentId)
          .where("path", "in", matchingPaths),
      );
      invalidateRegisteredAgentDatabasesMemo({ env: params.env });
      sessionChanges.emit(
        { all: true, scope: { agentId: params.agentId, topology: true } },
        database.db,
      );
    },
    { env: params.env, initializationAgentPaths: [params.path] },
  );
  invalidateBranchAgentDatabaseValidation(params.path);
}

/** Remove every durable database registration owned by a deleted agent. */
export function unregisterBranchAgentDatabases(params: {
  agentId: string;
  env?: NodeJS.ProcessEnv;
  database?: BranchStateDatabase;
}): void {
  const options = {
    env: params.env,
    ...(params.database ? { database: params.database, path: params.database.path } : {}),
  };
  const removedPaths = runBranchStateWriteTransaction((database) => {
    const db = getNodeSqliteKysely<BranchAgentRegistryDatabase>(database.db);
    const removed = executeSqliteQuerySync(
      database.db,
      db.deleteFrom("agent_databases").where("agent_id", "=", params.agentId).returning("path"),
    );
    invalidateRegisteredAgentDatabasesMemo(options);
    sessionChanges.emit(
      { all: true, scope: { agentId: params.agentId, topology: true } },
      database.db,
    );
    return removed.rows.map((row) =>
      resolveBranchRegisteredAgentDatabasePath(database.path, row.path),
    );
  }, options);
  invalidateBranchAgentDatabaseValidationsForAgent(params.agentId, removedPaths);
}
