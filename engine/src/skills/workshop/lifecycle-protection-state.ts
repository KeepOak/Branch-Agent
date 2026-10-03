import type { DatabaseSync } from "node:sqlite";
import { inspectCronRowsForDoctor } from "../../cron/store/doctor-inventory.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import { tableExists } from "../../state/branch-state-db-schema-helpers.js";
import type { DB } from "../../state/branch-state-db.generated.js";
import { managedSkillCommandName } from "../library/command-name.js";
export type LifecyclePersistedProtection = {
  cronReferencesComplete: boolean;
  libraryCommandNames: string[];
};
/** Existing raw all-partition inventory includes disabled jobs. It never repairs scheduler state. */
export function readLifecyclePersistedProtectionInDatabase(
  db: DatabaseSync,
): LifecyclePersistedProtection {
  const jobs = inspectCronRowsForDoctor(db);
  const query = getNodeSqliteKysely<Pick<DB, "diagnostic_events" | "skill_library_entries">>(db);
  const quarantined =
    tableExists(db, "diagnostic_events") &&
    executeSqliteQuerySync(
      db,
      query
        .selectFrom("diagnostic_events")
        .select("sequence")
        .where("scope", "like", "cron.quarantine:%")
        .limit(1),
    ).rows.length > 0;
  // Branch cron does not persist Hermes' skill/skills bindings. A nonempty inventory cannot prove absence of dependencies.
  // Unknown is deliberately retained, including disabled/paused/invalid definitions and quarantined recovery rows.
  const cronReferencesComplete = jobs.length === 0 && !quarantined;
  const rows = tableExists(db, "skill_library_entries")
    ? executeSqliteQuerySync(
        db,
        query
          .selectFrom("skill_library_entries")
          .select(["skill_id", "slug"])
          .where("removed", "=", 0)
          .orderBy("skill_id"),
      ).rows
    : [];
  if (
    rows.some(
      (row) =>
        typeof row.skill_id !== "string" ||
        !row.skill_id ||
        typeof row.slug !== "string" ||
        !row.slug,
    )
  )
    throw Error("Managed skill command inventory is invalid.");
  // Only existing stable command identities leave this private worker operation; no content/profile metadata is read.
  return {
    cronReferencesComplete,
    libraryCommandNames: rows.map((row) => managedSkillCommandName(row.slug, row.skill_id)),
  };
}
