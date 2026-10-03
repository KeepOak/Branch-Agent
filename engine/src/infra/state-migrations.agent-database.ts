import type { DatabaseSync } from "node:sqlite";
import type { BranchAgentDatabase } from "../state/branch-agent-db.js";
import { createSqliteWalReclamationResult } from "./sqlite-wal-reclamation.js";

/** Adapt a migration-owned connection without transferring its WAL or close custody. */
export function createMigrationDatabaseHandle(
  database: DatabaseSync,
  agentId: string,
  pathname: string,
): BranchAgentDatabase {
  return {
    agentId,
    db: database,
    path: pathname,
    walMaintenance: {
      checkpoint: () => false,
      close: () => false,
      reclaimFreePages: createSqliteWalReclamationResult,
    },
  };
}
