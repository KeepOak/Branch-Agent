import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import type { BranchAgentDatabaseOptions } from "../state/branch-agent-db-contract.js";
import { withBranchAgentDatabaseReadOnly } from "../state/branch-agent-db-readonly.js";
import { readSessionCostUsageRefreshLockInDatabase } from "./session-cost-usage-cache.kernel.js";
import { isTransientSqliteError } from "./unhandled-rejections.js";

export type SessionCostUsageCacheRead = { kind: "usage-refresh-lock" };
export type SessionCostUsageCacheReadResult = { kind: "usage-refresh-lock"; value: string | null };

/** File-backed calls belong to the transcript worker; incognito retains its process-held owner. */
export function readSessionCostUsageCache(
  options: BranchAgentDatabaseOptions,
  request: SessionCostUsageCacheRead,
): SessionCostUsageCacheReadResult {
  try {
    const result = withBranchAgentDatabaseReadOnly(
      (database): SessionCostUsageCacheReadResult => ({
        kind: request.kind,
        value: readSessionCostUsageRefreshLockInDatabase(database.db),
      }),
      { ...options, env: cloneEnvWithPlatformSemantics(options.env ?? process.env) },
    );
    if (result.found) {
      return result.value;
    }
  } catch (error) {
    if (!isTransientSqliteError(error)) {
      throw error;
    }
    // Rebuildable cache keeps its empty-data fallback without hiding worker failures.
  }
  return { kind: request.kind, value: null };
}
