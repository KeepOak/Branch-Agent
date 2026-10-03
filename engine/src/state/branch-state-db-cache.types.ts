import type { DatabaseSync } from "node:sqlite";
import type { SqliteSchemaFacts } from "../infra/sqlite-schema-facts.js";
import type { createSqliteTerminalOpenLatch } from "../infra/sqlite-terminal-open-latch.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type { createBranchStateDatabaseAsyncLifecycle } from "./branch-state-db-async-lifecycle.js";
import type { StateDatabaseBorrowers } from "./branch-state-db-borrow.js";
import type {
  BranchStateDatabase,
  BranchStateDatabaseLifecycleEvent,
  StateDatabaseHandle,
} from "./branch-state-db-contract.js";

export type CachedBranchStateDatabase = BranchStateDatabase & {
  schemaFacts: SqliteSchemaFacts | undefined;
};

export type StateDatabaseLifecycle = {
  cachedDatabases: Map<string, CachedBranchStateDatabase>;
  retainedDatabaseHandles: Map<DatabaseSync, StateDatabaseHandle>;
  idleTimers: WeakMap<DatabaseSync, ReturnType<typeof setTimeout>>;
  idleReferences: WeakMap<DatabaseSync, Set<object>>;
  unregisterRetainedExitClose?: () => void;
  databaseIdentities: WeakMap<DatabaseSync, DatabasePathIdentity>;
  borrowers: WeakMap<DatabaseSync, StateDatabaseBorrowers>;
  databaseLifecycleListeners: Set<(event: BranchStateDatabaseLifecycleEvent) => void>;
  terminalOpenLatch: ReturnType<typeof createSqliteTerminalOpenLatch>;
  asyncResources: ReturnType<typeof createBranchStateDatabaseAsyncLifecycle>;
};
