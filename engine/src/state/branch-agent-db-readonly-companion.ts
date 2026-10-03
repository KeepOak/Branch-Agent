import type { DatabaseSync } from "node:sqlite";
import {
  enableNodeSqliteKyselyStatementCache,
  registerNodeSqliteDisposeCallback,
} from "../infra/kysely-sync-cache-state.js";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import { runInSqliteMaintenanceContext } from "../infra/sqlite-wal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
import {
  isBranchAgentDatabasePathCurrent,
  readBranchAgentDatabaseIdentity,
} from "./branch-agent-db-identity.js";
import {
  hasBranchAgentReadOnlySchema,
  openBranchAgentDatabaseReadOnly,
  readBranchAgentDatabase,
  withFreshBranchAgentDatabaseReadOnly,
  type BranchAgentDatabaseReadOnlyResult,
  type BranchAgentReadOnlyDatabase,
  type BranchAgentReadOnlyDatabaseHandle,
} from "./branch-agent-db-readonly-open.js";

type ReadOnlyCompanion = {
  reader: BranchAgentReadOnlyDatabaseHandle;
  active: boolean;
  close: () => void;
  idleTimer: ReturnType<typeof setTimeout>;
};

const log = createSubsystemLogger("state/agent-db");
const companions = resolveGlobalSingleton(
  Symbol.for("branch.agentDatabaseReadOnlyCompanions"),
  () => new WeakMap<DatabaseSync, ReadOnlyCompanion>(),
);

function matchesWriter(reader: BranchAgentReadOnlyDatabase, writer: BranchAgentDatabase) {
  return (
    isBranchAgentDatabasePathCurrent(writer) &&
    isBranchAgentDatabasePathCurrent(reader) &&
    readBranchAgentDatabaseIdentity(reader).identity ===
      readBranchAgentDatabaseIdentity(writer).identity
  );
}

/** Keep committed reads separate from the active writer without reopening per assertion. */
export function withCommittedBranchAgentDatabaseReadOnly<T>(
  writer: BranchAgentDatabase,
  operation: (database: BranchAgentReadOnlyDatabase) => T,
  options: BranchAgentDatabaseOptions,
): BranchAgentDatabaseReadOnlyResult<T> {
  let companion = companions.get(writer.db);
  // Nested operations keep their own statement/transaction window and cleanup.
  if (companion?.active) {
    return withFreshBranchAgentDatabaseReadOnly(operation, options);
  }
  if (
    companion &&
    (!matchesWriter(companion.reader, writer) || companion.reader.db.isTransaction)
  ) {
    companion.close();
    companion = undefined;
  }
  if (!companion && !isBranchAgentDatabasePathCurrent(writer)) {
    return withFreshBranchAgentDatabaseReadOnly(operation, options);
  }
  if (!companion) {
    const opened = openBranchAgentDatabaseReadOnly(options);
    if (!opened.found) {
      return opened;
    }
    const reader = opened.database;
    let unregisterDispose = () => {};
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (reader.db.isOpen) {
        reader.close();
      }
      clearTimeout(idleTimer);
      if (companions.get(writer.db)?.reader === reader) {
        companions.delete(writer.db);
      }
      unregisterDispose();
    };
    try {
      // A pathname replacement during open keeps the old one-shot read contract.
      if (!matchesWriter(reader, writer)) {
        return readBranchAgentDatabase(reader, operation);
      }
      enableNodeSqliteKyselyStatementCache(reader.db);
      unregisterDispose = registerNodeSqliteDisposeCallback(writer.db, close);
      idleTimer = runInSqliteMaintenanceContext(() =>
        setTimeout(() => {
          if (companions.get(writer.db)?.reader !== reader) {
            return;
          }
          try {
            close();
          } catch (error) {
            log.warn("Idle committed agent reader cleanup failed", { path: reader.path, error });
            idleTimer?.refresh();
          }
        }, SQLITE_IDLE_HANDLE_TTL_MS),
      );
      idleTimer.unref();
      const next = { reader, active: false, close, idleTimer };
      companions.set(writer.db, next);
      companion = next;
    } finally {
      if (!companion) {
        close();
      }
    }
  }
  const owned = companion;
  try {
    if (!hasBranchAgentReadOnlySchema(owned.reader)) {
      owned.close();
      return { found: false, reason: "schema-missing" };
    }
    owned.idleTimer.refresh();
    owned.active = true;
    return readBranchAgentDatabase(owned.reader, operation);
  } catch (error) {
    owned.close();
    throw error;
  } finally {
    owned.active = false;
    // Never retain a caller's transaction or a handle detached from its current physical owner.
    if (
      !owned.reader.db.isOpen ||
      owned.reader.db.isTransaction ||
      !matchesWriter(owned.reader, writer)
    ) {
      owned.close();
    }
  }
}
