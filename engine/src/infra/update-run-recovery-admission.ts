import fs from "node:fs/promises";
import path from "node:path";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db-contract.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { hasNodeErrorCode } from "./path-guards.js";
import { assertNoPendingUpdateRecovery } from "./update-run-recovery.js";

/** Read-only admission; neither a missing nor a replaced DB retires old recovery. */
export async function assertUpdateRecoveryAdmission(
  options: BranchStateDatabaseOptions = {},
): Promise<void> {
  const databasePath = path.resolve(
    options.path ?? resolveBranchStateSqlitePath(options.env ?? process.env),
  );
  if (!(await assertUpdateRecoveryDirectoryAdmission(databasePath))) {
    return;
  }
  assertNoPendingUpdateRecovery({ ...options, path: databasePath });
}

/** Check publication before an admitted row reader; false means the parent is absent. */
export async function assertUpdateRecoveryDirectoryAdmission(
  databasePath: string,
): Promise<boolean> {
  const parent = path.dirname(databasePath);
  try {
    await fs.lstat(parent);
  } catch (error) {
    if (!hasNodeErrorCode(error, "ENOENT")) {
      throw error;
    }
    return false;
  }
  // A family may hold the only original DB even when another canonical file
  // exists. Locators confer no authority to inspect, repair, or retire it.
  // Do not swallow discovery races or recreate an absent canonical database.
  const families = await fs.readdir(parent);
  if (families.some((name) => name.startsWith(".branch-restore-"))) {
    throw new Error(
      "Interrupted shared-database publication is read-only while full-state recovery is deferred",
    );
  }
  return true;
}
