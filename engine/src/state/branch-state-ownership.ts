import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isRecord } from "@branch/normalization-core/record-coerce";
import {
  assertStateDatabaseAccessAllowed,
  GatewayStateOwnerContentionError,
} from "../infra/gateway-state-owner.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { isSqliteLockError, withSqliteNativeOpen } from "../infra/sqlite-error-diagnostics.js";
import {
  hasOrphanedSqliteSidecars,
  quarantineOrphanedSqliteSidecars,
} from "../infra/sqlite-files.js";
import {
  BranchStateExternalOwnershipError,
  BranchStateOwnershipMetadataError,
} from "../infra/sqlite-lifecycle-errors.js";
import {
  prepareSqliteReadOnlyLocation,
  prepareSqliteReadOnlyLocationSync,
} from "../infra/sqlite-snapshot-source.js";
import {
  StateSchemaMutationConflictError,
  withStateDatabaseSchemaMaintenance,
} from "../infra/state-database-maintenance.js";
import {
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  type BranchStateSchemaReadAdmission,
} from "./branch-state-db-contract.js";
import { tableExists } from "./branch-state-db-schema-helpers.js";
import { normalizeBranchStateSchemaReadError } from "./branch-state-db-schema-migration-required.js";

export const STATE_SUPERVISION_KEY = "gateway.supervision";
const MAX_OWNERSHIP_TIMESTAMP_MS = 8_640_000_000_000_000;
const MANAGER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type BranchExternalStateOwnership = {
  claimedAt: number;
  managerId: string;
  mode: "external";
  version: 1;
};

export function isBranchStateWriteContentionError(error: unknown): boolean {
  return (
    error instanceof GatewayStateOwnerContentionError ||
    error instanceof StateSchemaMutationConflictError ||
    isSqliteLockError(error)
  );
}

export function normalizeBranchStateManagerId(managerId: string): string {
  const normalized = managerId.trim();
  if (!MANAGER_ID_PATTERN.test(normalized)) {
    throw new Error(
      "External state ownership manager id must be a 1-128 character ASCII identifier.",
    );
  }
  return normalized;
}

function parseExternalOwnership(
  valueJson: string,
  databasePath: string,
): BranchExternalStateOwnership {
  let value: unknown;
  try {
    value = JSON.parse(valueJson) as unknown;
  } catch {
    throw new BranchStateOwnershipMetadataError(databasePath, "reserved value is not valid JSON");
  }
  const record = isRecord(value) ? value : undefined;
  const keys = record ? Object.keys(record).toSorted().join(",") : "";
  const managerId = record?.managerId;
  const claimedAt = record?.claimedAt;
  if (
    keys !== "claimedAt,managerId,mode,version" ||
    record?.version !== 1 ||
    record?.mode !== "external" ||
    typeof managerId !== "string" ||
    !MANAGER_ID_PATTERN.test(managerId) ||
    typeof claimedAt !== "number" ||
    !Number.isSafeInteger(claimedAt) ||
    claimedAt < 0 ||
    claimedAt > MAX_OWNERSHIP_TIMESTAMP_MS
  ) {
    throw new BranchStateOwnershipMetadataError(
      databasePath,
      "reserved value does not match the version 1 external ownership contract",
    );
  }
  return {
    version: 1,
    mode: "external",
    managerId,
    claimedAt,
  };
}

/** Inspect the reserved ownership row without entering the shared-state lifecycle. */
export function inspectBranchStateOwnershipFromDatabase(
  database: DatabaseSync,
  databasePath: string,
  configMachineStateTableReady = false,
): BranchExternalStateOwnership | null {
  try {
    if (!configMachineStateTableReady && !tableExists(database, "config_machine_state")) {
      return null;
    }
    // Raw admission must not mistake a damaged ownership index for an unclaimed store.
    const ownershipSql = configMachineStateTableReady
      ? "SELECT value_json FROM config_machine_state WHERE state_key = ? LIMIT 1"
      : "SELECT value_json FROM config_machine_state NOT INDEXED WHERE state_key = ? LIMIT 1";
    const row = database.prepare(ownershipSql).get(STATE_SUPERVISION_KEY) as
      | { value_json?: unknown }
      | undefined;
    if (!row) {
      return null;
    }
    if (typeof row.value_json !== "string") {
      throw new BranchStateOwnershipMetadataError(databasePath, "reserved value is not text");
    }
    return parseExternalOwnership(row.value_json, databasePath);
  } catch (error) {
    throw normalizeBranchStateSchemaReadError(error, databasePath);
  }
}

function inspectOwnershipThroughConnection(
  location: string,
  databasePath: string,
  openStateSchemaReadAdmission?: BranchStateSchemaReadAdmission,
): BranchExternalStateOwnership | null {
  const database = withSqliteNativeOpen(() => openNodeSqliteDatabase(location, { readOnly: true }));
  let closeAdmission: (() => void) | undefined;
  try {
    closeAdmission = openStateSchemaReadAdmission?.(database);
    database.exec(
      `PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS}; PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;`,
    );
    return inspectBranchStateOwnershipFromDatabase(database, databasePath);
  } finally {
    try {
      closeAdmission?.();
    } finally {
      database.close();
    }
  }
}

/** Inspect one resolved state database path without mutating its state tree. */
export function inspectBranchStateOwnershipAtPath(
  databasePath: string,
): BranchExternalStateOwnership | null {
  const resolvedPath = path.resolve(databasePath);
  if (!existsSync(resolvedPath)) {
    return null;
  }
  const prepared = prepareSqliteReadOnlyLocationSync(resolvedPath);
  try {
    return inspectOwnershipThroughConnection(prepared.location, resolvedPath);
  } finally {
    prepared.cleanup();
  }
}

function assertOwnershipAllowsWrite(
  status: BranchExternalStateOwnership | null,
  databasePath: string,
  env: NodeJS.ProcessEnv,
): void {
  if (status && !isGatewayExternallySupervised(env)) {
    throw new BranchStateExternalOwnershipError(databasePath, status.managerId);
  }
}

/** Check write admission; callers may defer orphan-sidecar recovery until mutation is certain. */
export async function assertBranchStateWriteAllowedAtPath(options: {
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  recoverOrphanedSidecars?: boolean;
  signal?: AbortSignal;
  openStateSchemaReadAdmission?: BranchStateSchemaReadAdmission;
}): Promise<void> {
  options.signal?.throwIfAborted();
  const databasePath = path.resolve(options.databasePath);
  assertStateDatabaseAccessAllowed(databasePath);
  const recoverOrphanedSidecars = options.recoverOrphanedSidecars !== false;
  if (recoverOrphanedSidecars && hasOrphanedSqliteSidecars(databasePath)) {
    withStateDatabaseSchemaMaintenance({ databasePath }, () =>
      quarantineOrphanedSqliteSidecars(databasePath),
    );
  }
  if (!existsSync(databasePath)) {
    return;
  }
  const env = options.env ?? process.env;
  const prepared = await prepareSqliteReadOnlyLocation(databasePath, {
    preserveSourceArtifacts: true,
    signal: options.signal,
  });
  try {
    options.signal?.throwIfAborted();
    assertStateDatabaseAccessAllowed(databasePath);
    assertOwnershipAllowsWrite(
      inspectOwnershipThroughConnection(
        prepared.location,
        databasePath,
        options.openStateSchemaReadAdmission,
      ),
      databasePath,
      env,
    );
  } finally {
    await prepared.cleanupAsync();
  }
}

/** Fence shared-state writes once an external manager has claimed ownership. */
export function assertBranchStateWriteAllowed(options: {
  database: DatabaseSync;
  databasePath: string;
  env?: NodeJS.ProcessEnv;
  // Only the shared-state lifecycle owner may carry this positive schema fact.
  // Close/reopen and replacement bootstrap a new owner before setting it again.
  schemaReady?: boolean;
}): void {
  const resolvedPath = path.resolve(options.databasePath);
  assertStateDatabaseAccessAllowed(resolvedPath);
  const status = inspectBranchStateOwnershipFromDatabase(
    options.database,
    resolvedPath,
    options.schemaReady,
  );
  assertOwnershipAllowsWrite(status, resolvedPath, options.env ?? process.env);
}
