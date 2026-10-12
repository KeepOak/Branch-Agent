import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { computeBackoff } from "../infra/backoff.js";
import { runWithSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { isSqliteLockError } from "../infra/sqlite-error-diagnostics.js";
import { extractSqliteTableSchema } from "../infra/sqlite-schema-sql.js";
import { runExistingBranchStateWriteTransaction } from "./branch-state-db-existing-write.js";
import { withBranchStateDatabaseReadOnly } from "./branch-state-db-readonly.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  runWithBranchStateBusyTimeout,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";
import {
  createBranchStateLeaseLostError,
  toBranchStateLeaseVerificationError,
} from "./branch-state-lease-error.js";
import {
  LEASE_CONTENTION_RETRY_MS,
  LEASE_CONTENTION_RETRY_TIMEOUT_MS,
} from "./branch-state-lease-heartbeat-shared.js";
import {
  readBranchStateLeaseExpiry,
  releaseBranchStateLeaseInTransaction,
  renewBranchStateLeaseInTransaction,
} from "./branch-state-lease-store.js";
import type { BranchStateLeaseIdentity } from "./branch-state-lease.types.js";
import { BRANCH_STATE_SCHEMA_SQL } from "./branch-state-schema.js";

export type BranchStateLeaseDatabase = {
  scope: "shared";
  options?: BranchStateDatabaseOptions;
  /** Storage compatibility only, never authority. Acquisition still claims the real lease. */
  schemaPolicy?: "existing";
};
const leaseSchema = ["schema_meta", "state_leases"]
  .map((table) =>
    extractSqliteTableSchema(BRANCH_STATE_SCHEMA_SQL, table, {
      endMarker: ") STRICT;",
      errorMessage: "Existing lease schema is unavailable.",
    }),
  )
  .join("\n");

export function prepareLeaseDatabase(database: BranchStateLeaseDatabase): void {
  if (database.schemaPolicy !== "existing") {
    runWithBranchStateBusyTimeout(() => undefined, database.options ?? {}, 0);
  }
}

export function resolveLeaseDatabasePath(database: BranchStateLeaseDatabase): string {
  return database.schemaPolicy === "existing"
    ? path.resolve(database.options?.path ?? resolveBranchStateSqlitePath(database.options?.env))
    : openBranchStateDatabase(database.options).path;
}
function readLeaseDatabase<T>(
  database: BranchStateLeaseDatabase,
  operation: (db: DatabaseSync) => T,
): T {
  return database.schemaPolicy === "existing"
    ? withBranchStateDatabaseReadOnly(({ db }) => operation(db), database.options)
    : operation(openBranchStateDatabase(database.options).db);
}

export function withLeaseWriteTransaction<T>(
  database: BranchStateLeaseDatabase,
  operationLabel: string,
  operation: (db: DatabaseSync) => T,
  busyTimeoutMs = 0,
): T {
  if (database.schemaPolicy === "existing") {
    return runExistingBranchStateWriteTransaction(
      ({ db }) => operation(db),
      database.options ?? {},
      { operationLabel, busyTimeoutMs, schemaSql: leaseSchema },
    );
  }
  const stateDatabase = openBranchStateDatabase(database.options);
  const run = () =>
    runBranchStateWriteTransaction(
      ({ db }) => operation(db),
      { ...database.options, database: stateDatabase },
      { operationLabel, busyTimeoutMs },
    );
  return runWithSqliteBusyTimeout(stateDatabase.db, busyTimeoutMs, run);
}

export const STATE_LEASE_WRITE_BACKOFF = {
  initialMs: LEASE_CONTENTION_RETRY_MS,
  maxMs: 250,
  factor: 1.5,
  jitter: 0.25,
} as const;

export type BranchStateLeaseOwnerIdentity = BranchStateLeaseIdentity & { leaseLabel: string };

export function renewBranchStateLease(
  params: BranchStateLeaseOwnerIdentity & {
    database: BranchStateLeaseDatabase;
    operationLabel: string;
    leaseMs: number;
  },
): number {
  return withLeaseWriteTransaction(params.database, params.operationLabel, (db) => {
    const expiresAt = renewBranchStateLeaseInTransaction(db, params, params.leaseMs);
    if (expiresAt === undefined) {
      throw createBranchStateLeaseLostError(params);
    }
    return expiresAt;
  });
}

function assertBranchStateLeaseOwnedInDatabase(
  database: DatabaseSync,
  params: BranchStateLeaseOwnerIdentity,
): number {
  const expiresAt = readBranchStateLeaseExpiry(database, params);
  if (expiresAt === undefined) {
    throw createBranchStateLeaseLostError(params);
  }
  return expiresAt;
}

export function verifyBranchStateLeaseOwnership(
  params: BranchStateLeaseOwnerIdentity & {
    database?: BranchStateLeaseDatabase;
    transaction?: DatabaseSync;
  },
): number {
  try {
    if (params.transaction) {
      return assertBranchStateLeaseOwnedInDatabase(params.transaction, params);
    }
    if (!params.database) {
      throw new Error("state lease ownership check requires a database");
    }
    return readLeaseDatabase(params.database, (db) =>
      assertBranchStateLeaseOwnedInDatabase(db, params),
    );
  } catch (error) {
    throw toBranchStateLeaseVerificationError(params, error);
  }
}

export function releaseBranchStateLease(
  params: BranchStateLeaseOwnerIdentity & {
    database: BranchStateLeaseDatabase;
    operationLabel: string;
  },
): void {
  withLeaseWriteTransaction(params.database, params.operationLabel, (db) =>
    releaseBranchStateLeaseInTransaction(db, params),
  );
}

export async function releaseBranchStateLeaseBestEffort(
  params: Parameters<typeof releaseBranchStateLease>[0],
  execute?: () => Promise<void>,
): Promise<void> {
  const deadline = performance.now() + LEASE_CONTENTION_RETRY_TIMEOUT_MS;
  let attempt = 0;
  while (true) {
    try {
      if (execute) {
        await execute();
      } else {
        releaseBranchStateLease(params);
      }
      return;
    } catch (error) {
      const now = performance.now();
      if (!isSqliteLockError(error) || now >= deadline) {
        if (execute) {
          // The async resource owner retains failed cleanup for exact-owner retry.
          throw error;
        }
        return;
      }
      attempt += 1;
      // Cleanup outlives caller scheduling; native timers let competing writers settle.
      await sleep(Math.min(deadline - now, computeBackoff(STATE_LEASE_WRITE_BACKOFF, attempt)));
    }
  }
}
