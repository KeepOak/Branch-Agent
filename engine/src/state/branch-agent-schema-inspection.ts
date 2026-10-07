import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { toStringifiedError } from "@branch/normalization-core/error-coercion";
import { formatErrorMessage } from "../infra/errors.js";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync.js";
import { openNodeSqliteDatabase, resolveImmutableSqliteFileUri } from "../infra/node-sqlite.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import {
  readSqliteSchemaHeader,
  readSqliteWriterAppVersion,
} from "../infra/sqlite-schema-header.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { configureSqliteReadOnlyPragmas } from "../infra/sqlite-wal.js";
import { isValidAgentId } from "../routing/session-key.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "./branch-agent-db-contract.js";
import { assertBranchAgentDatabaseForMaintenance } from "./branch-agent-db-maintenance.js";
import type { ExistingAgentSchemaMeta } from "./branch-agent-db-metadata.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertBranchAgentCurrentRuntimeSchema,
  readExistingAgentSchemaMeta,
  hasPendingCurrentVersionAgentDatabaseMigration,
} from "./branch-agent-db-schema-helpers.js";
import type { BranchAgentSchemaPreflightResult } from "./branch-database-preflight.types.js";
import {
  canReuseBranchAgentIntegrityVerification,
  type readBranchAgentIntegrityVerification,
} from "./branch-quarantine-store.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db-contract.js";

export type AgentSchemaInspectionInput = {
  pathname: string;
  agentId?: string;
  supportedVersion: number;
  verifyCurrentSchemaShape?: boolean;
  inspectOwnership?: boolean;
  requireStartupMigrationReadiness?: boolean;
  deferRuntimeIntegrity?: boolean;
  startupIntegrityStateDir?: string;
  startupIntegrityVerification?: ReturnType<typeof readBranchAgentIntegrityVerification>;
};

export type AgentSchemaInspection = {
  version: number;
  integrityGateOutcome?: "cached" | "healthy" | "pending";
  writerAppVersion?: string;
  reason?: string;
  failure?: Error;
  agentSchemaMeta?: ExistingAgentSchemaMeta | null;
};

/** All facts belong to the caller's single read transaction or private snapshot. */
export function inspectAgentDatabaseSchema(
  database: DatabaseSync,
  input: AgentSchemaInspectionInput,
): AgentSchemaInspection {
  if (!input.verifyCurrentSchemaShape && !input.requireStartupMigrationReadiness) {
    try {
      const { userVersion, ...header } = readSqliteSchemaHeader(
        database,
        input.inspectOwnership ? input.supportedVersion : undefined,
      );
      return { version: userVersion, ...header };
    } finally {
      clearNodeSqliteKyselyCacheForDatabase(database);
    }
  }
  const version = readSqliteUserVersion(database);
  const inspection: AgentSchemaInspection = { version };
  let checkingShape = false;
  try {
    if (version > input.supportedVersion) {
      const writerAppVersion = readSqliteWriterAppVersion(database);
      return { version, ...(writerAppVersion ? { writerAppVersion } : {}) };
    }
    if (input.inspectOwnership) {
      // Preserve ownership even when shape validation fails: the parent must
      // apply its existing isolation decision before reporting schema defects.
      inspection.agentSchemaMeta = readExistingAgentSchemaMeta(database);
    }
    if (input.requireStartupMigrationReadiness) {
      const migrationPending =
        version !== input.supportedVersion ||
        hasPendingCurrentVersionAgentDatabaseMigration(database);
      if (
        canReuseBranchAgentIntegrityVerification(
          input.pathname,
          input.startupIntegrityVerification,
          migrationPending,
        )
      ) {
        inspection.integrityGateOutcome = "cached";
      } else if (input.deferRuntimeIntegrity && !migrationPending) {
        // The pending Gateway owner claims the live lease and validates before writes.
        inspection.integrityGateOutcome = "pending";
      } else {
        assertSqliteIntegrity(database, input.pathname);
        inspection.integrityGateOutcome = "healthy";
      }
      assertCanonicalAgentPersistenceVersion(database, input.pathname, version);
    }
    const agentId =
      input.agentId ??
      (input.requireStartupMigrationReadiness
        ? readExistingAgentSchemaMeta(database)?.agentId
        : undefined);
    if (
      input.verifyCurrentSchemaShape &&
      agentId != null &&
      (!input.requireStartupMigrationReadiness || version > 0)
    ) {
      checkingShape = true;
      assertBranchAgentDatabaseForMaintenance(database, {
        agentId,
        pathname: input.pathname,
        allowStartupIndexRepair: input.requireStartupMigrationReadiness,
      });
    }
    return inspection;
  } catch (error) {
    if (input.requireStartupMigrationReadiness) {
      return {
        ...inspection,
        failure: toStringifiedError(error),
        ...(checkingShape ? { reason: formatErrorMessage(error) } : {}),
      };
    }
    // Preserve the observed version even when shape validation fails, so Doctor
    // can still report a pending migration alongside the unreadable shape.
    return { ...inspection, reason: formatErrorMessage(error) };
  } finally {
    clearNodeSqliteKyselyCacheForDatabase(database);
  }
}

/** Validate one consolidated agent copy using this release's exact maintenance reader.
 * This never discovers, registers, migrates, or opens an ordinary runtime store.
 */
export async function preflightBranchAgentDatabasePath(
  databasePath: string,
  agentId: string,
): Promise<BranchAgentSchemaPreflightResult> {
  const resolvedPath = path.resolve(databasePath);
  const base = {
    schema: "branch.agent-schema-preflight.v1" as const,
    databasePath: resolvedPath,
    agentId,
    targetVersion: BRANCH_AGENT_SCHEMA_VERSION,
    requiresWrite: false,
    issues: [],
  };
  let database: DatabaseSync | undefined;
  let foundVersion: number | null = null;
  let status: "indeterminate" | "incompatible" = "indeterminate";
  try {
    // The maintenance owner normalizes IDs. An explicit proof must never fall
    // back to main or silently bless a different, normalized input identity.
    if (!isValidAgentId(agentId) || agentId !== agentId.trim().toLowerCase()) {
      throw new Error("Agent preflight requires an explicit canonical agent ID.");
    }
    const inspectionPath = realpathSync.native(resolvedPath);
    if (inspectionPath !== resolvedPath || !statSync(inspectionPath).isFile()) {
      throw new Error("Agent preflight requires a canonical regular copied database path.");
    }
    if (["-wal", "-shm", "-journal"].some((suffix) => existsSync(inspectionPath + suffix))) {
      throw new Error("Agent preflight requires a consolidated snapshot with no SQLite sidecars.");
    }
    database = openNodeSqliteDatabase(resolveImmutableSqliteFileUri(inspectionPath), {
      readOnly: true,
    });
    setSqliteBusyTimeout(database, BRANCH_SQLITE_BUSY_TIMEOUT_MS);
    configureSqliteReadOnlyPragmas(database);
    assertSqliteIntegrity(database, resolvedPath);
    foundVersion = readSqliteUserVersion(database);
    status = "incompatible";
    assertBranchAgentDatabaseForMaintenance(database, { agentId, pathname: resolvedPath });
    // Maintenance-compatible storage can still require a retired-schema repair
    // before runtime admission. A read-only proof must never bless that repair.
    assertBranchAgentCurrentRuntimeSchema(database, { agentId, pathname: resolvedPath });
    return { ...base, foundVersion, status: "exact" as const };
  } catch (error) {
    return { ...base, foundVersion, status, reason: formatErrorMessage(error) };
  } finally {
    if (database) {
      clearNodeSqliteKyselyCacheForDatabase(database);
    }
    database?.close();
  }
}
