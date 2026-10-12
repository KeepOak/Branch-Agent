import { existsSync } from "node:fs";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "./branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

/** Records an explicit non-Grove claim through the canonical MCP owner. */
export function markGroveMcpServerIndependentlyOwned(
  name: string,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): number {
  const databasePath = options.path ?? resolveBranchStateSqlitePath(options.env ?? process.env);
  if (!existsSync(databasePath)) {
    return 0;
  }
  try {
    return runBranchStateWriteTransaction(({ db }) => {
      const result = executeSqliteQuerySync(
        db,
        getNodeSqliteKysely<Pick<DB, "grove_mcp_server_refs">>(db)
          .updateTable("grove_mcp_server_refs")
          .set({ independent_owner: 1, updated_at_ms: options.nowMs ?? Date.now() })
          .where("name", "=", name)
          .where("independent_owner", "!=", 1),
      );
      return Number(result.numAffectedRows);
    }, options);
  } catch {
    // The canonical MCP write already succeeded; Grove status still detects config drift.
    return 0;
  }
}
