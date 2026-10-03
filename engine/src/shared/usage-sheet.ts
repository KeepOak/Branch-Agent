// Owner's on-request 7/30/90-day sheet adapter. Uses the pinned source usage API,
// CSV formatter and cache-completeness policy; creates no recurring file timer.
// openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:
// ui/src/lib/sessions/usage.ts, ui/src/pages/usage/cache-status.ts and query.ts.
import { buildDailyCsv, buildSessionsCsv } from "./usage-csv.js";
import type { SessionsUsageResult } from "./usage-types.js";

export type UsageSheetOptions = {
  days: 7 | 30 | 90;
  kind: "daily" | "sessions";
  signal?: AbortSignal;
} & ({ agentId: string; agentScope?: never } | { agentScope: "all"; agentId?: never });

export type UsageSheetClient = {
  request<T>(method: string, params: Record<string, unknown>): Promise<T>;
};

/** Read existing metered data on demand; the caller controls download or Library save. */
export async function loadUsageSheet(client: UsageSheetClient, options: UsageSheetOptions) {
  // Snapshot before awaiting so changing the form cannot relabel an older report.
  const { days, kind, signal, agentId, agentScope } = options;
  if (![7, 30, 90].includes(days) || !["daily", "sessions"].includes(kind)) {
    throw new Error("Choose a 7, 30 or 90-day daily or conversation sheet.");
  }
  if (agentScope !== "all" && (!agentId || !agentId.trim())) {
    throw new Error("Choose a Trunk or all Trunks for the usage sheet.");
  }
  if (agentScope === "all" && agentId !== undefined) {
    throw new Error("All-Trunk usage cannot be combined with a specific Trunk.");
  }
  signal?.throwIfAborted();
  const report = await client.request<SessionsUsageResult>("sessions.usage", {
    range: `${days}d`, mode: "utc", groupBy: "instance", limit: 1000,
    ...(agentScope === "all" ? { agentScope } : { agentId }),
  });
  signal?.throwIfAborted();
  if (!report || !Array.isArray(report.sessions) || !report.aggregates || !report.totals ||
      !/^\d{4}-\d{2}-\d{2}$/.test(report.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(report.endDate)) {
    throw new Error("The engine did not return a complete usage report.");
  }
  if ((report.cacheStatus && (report.cacheStatus.status !== "fresh" || report.cacheStatus.pendingFiles > 0 || report.cacheStatus.staleFiles > 0)) ||
      report.sessions.some(row => row.computing || row.usage?.refreshing || row.usage?.staleSince !== undefined)) {
    throw new Error("Usage is still being refreshed. Refresh Usage before saving a sheet.");
  }
  if (kind === "sessions" && ((report.aggregates.sessionCount ?? report.sessions.length) > report.sessions.length ||
      report.sessions.some(row => !row.usage))) {
    throw new Error("The conversation report is incomplete. Narrow its Trunk scope before saving.");
  }
  if (kind === "daily" && !Array.isArray(report.aggregates.costDaily)) {
    throw new Error("The engine did not return complete daily token and cost rows.");
  }
  return {
    filename: `branch-usage-${days}days-${kind}-${report.endDate}.csv`,
    contentType: "text/csv;charset=utf-8" as const,
    content: kind === "daily" ? buildDailyCsv(report.aggregates.costDaily!) : buildSessionsCsv(report.sessions),
    startDate: report.startDate,
    endDate: report.endDate,
    // Missing prices are reported honestly, not relabeled as known zero-cost calls.
    missingCostEntries: report.totals.missingCostEntries,
  };
}
