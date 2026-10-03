// Shared cleanup for bundled-discovery real-state test roots.
import fs from "node:fs/promises";
import { closeBranchStateDatabaseByPath } from "../state/branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";

/**
 * Removes a temporary BRANCH_STATE_DIR root after closing its cached SQLite
 * handle. The plugins Vitest project runs isolate:false, so an open handle
 * would leak into later files, and Windows cannot delete open database files.
 */
export async function removeBundledDiscoveryStateRoot(stateDir: string): Promise<void> {
  closeBranchStateDatabaseByPath(
    resolveBranchStateSqlitePath({ BRANCH_STATE_DIR: stateDir } as NodeJS.ProcessEnv),
  );
  await fs.rm(stateDir, { recursive: true, force: true });
}
