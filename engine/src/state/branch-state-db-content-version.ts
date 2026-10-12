import { readSqliteSourceContentVersionSync } from "../infra/sqlite-snapshot-source.js";
import { getBranchDatabaseMaintenanceScope } from "./branch-state-db-async-lifecycle.js";
import { branchStateDatabaseCache } from "./branch-state-db-cache.js";
import { isExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import { existingPathOrUndefined } from "./branch-state-db.paths.js";

/** The read-only owner has checked retained scopes and exited discovery first. */
export function readAdmittedStateContentVersion(
  pathname: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const assertCurrent = () => {
    getBranchDatabaseMaintenanceScope()?.assertReadAdmission();
    branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
  };
  assertCurrent();
  if (existingPathOrUndefined(pathname) === undefined) {
    return undefined;
  }
  const version = readSqliteSourceContentVersionSync(pathname);
  assertCurrent();
  return version === undefined
    ? undefined
    : `${pathname}:${isExistingBranchStateSchema(pathname)}:${version}`;
}
