import path from "node:path";
import { resolveConfigPath } from "../config/paths.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import type { GroveMonitorCleanupBinding } from "./monitor-cleanup-contract.js";

/** Grove files remain local; the serving monitor owner must use that same state and config. */
export function resolveGroveMonitorCleanupBinding(cronStorePath: string): GroveMonitorCleanupBinding {
  return {
    configPath: path.resolve(resolveConfigPath()),
    statePath: path.resolve(resolveBranchStateSqlitePath()),
    cronStorePath: path.resolve(cronStorePath),
  };
}
