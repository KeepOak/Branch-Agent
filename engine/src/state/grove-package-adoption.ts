import { existsSync } from "node:fs";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { DB } from "./branch-state-db.generated.js";
import {
  runBranchStateWriteTransaction,
  type BranchStateDatabaseOptions,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

type ClawPackageAdoption = {
  kind: "skill" | "plugin";
  source: "clawhub";
  ref: string;
  version?: string;
  workspace?: string;
};

/** Records an explicit non-Grove claim through the canonical package owner. */
export function markClawPackageIndependentlyOwned(
  artifact: ClawPackageAdoption,
  options: BranchStateDatabaseOptions & { nowMs?: number } = {},
): number {
  const databasePath = options.path ?? resolveBranchStateSqlitePath(options.env ?? process.env);
  if (!existsSync(databasePath)) {
    return 0;
  }
  const nowMs = options.nowMs ?? Date.now();
  try {
    return runBranchStateWriteTransaction(({ db }) => {
      const kysely = getNodeSqliteKysely<Pick<DB, "grove_package_refs" | "grove_installs">>(db);
      let query = kysely
        .updateTable("grove_package_refs")
        .set({ independent_owner: 1, updated_at_ms: nowMs })
        .where("package_kind", "=", artifact.kind)
        .where("package_source", "=", artifact.source)
        .where("package_ref", "=", artifact.ref)
        .where("independent_owner", "!=", 1);
      if (artifact.version) {
        query = query.where("package_version", "=", artifact.version);
      }
      if (artifact.kind === "skill") {
        query = query.where(
          "agent_id",
          "in",
          kysely
            .selectFrom("grove_installs")
            .select("agent_id")
            .where("workspace", "=", artifact.workspace ?? ""),
        );
      }
      return Number(executeSqliteQuerySync(db, query).numAffectedRows);
    }, options);
  } catch {
    // The canonical install already succeeded. Removal also checks its newer owner timestamp.
    return 0;
  }
}
