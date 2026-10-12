import type { DatabaseSync } from "node:sqlite";
import { assertStateDatabaseAccessAllowed } from "../infra/gateway-state-owner.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  getNodeSqliteKysely,
} from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { BranchStateOwnershipMetadataError } from "../infra/sqlite-lifecycle-errors.js";
import { runSqliteImmediateTransactionSync } from "../infra/sqlite-transaction.js";
import { configureSqliteWalMaintenance, type SqliteWalMaintenance } from "../infra/sqlite-wal.js";
import { branchStateDatabaseCache } from "./branch-state-db-cache.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db-contract.js";
import { assertBranchStateDatabaseForMaintenance } from "./branch-state-db-maintenance.js";
import type { DB as BranchStateKyselyDatabase } from "./branch-state-db.generated.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { resolveDatabasePath } from "./branch-state-db.paths.js";
import {
  inspectBranchStateOwnershipFromDatabase,
  normalizeBranchStateManagerId,
  STATE_SUPERVISION_KEY,
  type BranchExternalStateOwnership,
} from "./branch-state-ownership.js";

type BranchStateOwnershipOptions = Omit<BranchStateDatabaseOptions, "database" | "readOnly">;
type OwnershipDatabase = Pick<BranchStateKyselyDatabase, "config_machine_state">;

function requireOwnershipCheckpoint(
  walMaintenance: SqliteWalMaintenance,
  databasePath: string,
): void {
  if (!walMaintenance.checkpoint()) {
    throw new Error(
      `External ownership was committed for ${databasePath}, but its WAL checkpoint failed. Retry the same ownership claim before activating the supervisor.`,
    );
  }
}

function claimOwnershipRow(
  database: DatabaseSync,
  databasePath: string,
  managerId: string,
  repairMalformed: boolean,
): BranchExternalStateOwnership {
  let current: BranchExternalStateOwnership | null = null;
  try {
    current = inspectBranchStateOwnershipFromDatabase(database, databasePath);
  } catch (error) {
    if (!repairMalformed || !(error instanceof BranchStateOwnershipMetadataError)) {
      throw error;
    }
  }
  if (current) {
    if (current.managerId !== managerId) {
      throw new Error(
        `Branch Agent shared state is already claimed by external manager ${current.managerId}; ` +
          `manager ${managerId} cannot replace that durable ownership.`,
      );
    }
    return current;
  }
  const ownership: BranchExternalStateOwnership = {
    version: 1,
    mode: "external",
    managerId,
    claimedAt: Date.now(),
  };
  const valueJson = JSON.stringify(ownership);
  const stateDb = getNodeSqliteKysely<OwnershipDatabase>(database);
  executeSqliteQuerySync(
    database,
    stateDb
      .insertInto("config_machine_state")
      .values({
        state_key: STATE_SUPERVISION_KEY,
        value_json: valueJson,
        updated_at_ms: ownership.claimedAt,
      })
      .onConflict((conflict) =>
        conflict.column("state_key").doUpdateSet({
          value_json: valueJson,
          updated_at_ms: ownership.claimedAt,
        }),
      ),
  );
  return ownership;
}

function repairMalformedOwnershipClaim(
  databasePath: string,
  managerId: string,
): BranchExternalStateOwnership {
  assertStateDatabaseAccessAllowed(databasePath);
  const existing = branchStateDatabaseCache.getBranchStateDatabaseIfOpenAtPath(databasePath);
  const database = existing?.db ?? openNodeSqliteDatabase(databasePath);
  let walMaintenance: SqliteWalMaintenance | undefined;
  try {
    database.exec(`PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS};`);
    assertSqliteIntegrity(database, databasePath);
    assertBranchStateDatabaseForMaintenance(database, { pathname: databasePath });
    walMaintenance =
      existing?.walMaintenance ??
      configureSqliteWalMaintenance(database, {
        busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
        checkpointIntervalMs: 0,
        checkpointMode: "TRUNCATE",
        databaseLabel: "Branch Agent shared state ownership",
        databasePath,
      });
    const ownership = runSqliteImmediateTransactionSync(
      database,
      () => {
        assertStateDatabaseAccessAllowed(databasePath);
        assertBranchStateDatabaseForMaintenance(database, { pathname: databasePath });
        return claimOwnershipRow(database, databasePath, managerId, true);
      },
      {
        busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: databasePath,
        operationLabel: "state.ownership.repair",
      },
    );
    requireOwnershipCheckpoint(walMaintenance, databasePath);
    return ownership;
  } finally {
    if (!existing) {
      walMaintenance?.close({ checkpointMode: "PASSIVE" });
      clearNodeSqliteKyselyCacheForDatabase(database);
      database.close();
    }
  }
}

/** Claim durable shared-state write ownership for the active external supervisor. */
export function claimBranchStateOwnership(
  managerId: string,
  options: BranchStateOwnershipOptions = {},
): BranchExternalStateOwnership {
  const env = options.env ?? process.env;
  if (!isGatewayExternallySupervised(env)) {
    throw new Error(
      "Claiming external shared-state ownership requires BRANCH_SUPERVISOR_MODE=external.",
    );
  }
  const normalizedManagerId = normalizeBranchStateManagerId(managerId);
  try {
    const database = openBranchStateDatabase(options);
    const ownership = runBranchStateWriteTransaction(
      ({ db, path: databasePath }) =>
        claimOwnershipRow(db, databasePath, normalizedManagerId, false),
      { ...options, database },
      { operationLabel: "state.ownership.claim" },
    );
    requireOwnershipCheckpoint(database.walMaintenance, database.path);
    return ownership;
  } catch (error) {
    if (!(error instanceof BranchStateOwnershipMetadataError)) {
      throw error;
    }
    const ownership = repairMalformedOwnershipClaim(
      resolveDatabasePath(options),
      normalizedManagerId,
    );
    openBranchStateDatabase(options);
    return ownership;
  }
}
