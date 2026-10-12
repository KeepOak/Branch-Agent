// Branch spend source for TokenCostControl (atlas MODELS-ACCOUNTS-0080). It answers the
// guard's aggregate query from the session usage Branch already records, in USD.
import type { BranchConfig } from "../../config/types.branch.js";
import { loadCostUsageSummary, loadSessionCostSummary } from "../../infra/session-cost-usage.js";
import type {
  CostMetricAggregate,
  CostMetricQuery,
  CostMetricStore,
} from "./token-cost-control.js";

type SessionCostUsageLoaders = {
  loadCostUsageSummary: typeof loadCostUsageSummary;
  loadSessionCostSummary: typeof loadSessionCostSummary;
};

const defaultLoaders: SessionCostUsageLoaders = { loadCostUsageSummary, loadSessionCostSummary };

function readWindowStart(filters: Record<string, unknown>): number | undefined {
  const timestamp = filters["timestamp"] as { start?: unknown } | undefined;
  return timestamp?.start instanceof Date ? timestamp.start.getTime() : undefined;
}

function readStringFilter(filters: Record<string, unknown>, key: string): string | undefined {
  const value = filters[key];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Spend store over Branch's recorded usage for one agent.
 * - 'resource' scope: the resource id is an agent id; sums that agent's sessions.
 * - 'session' scope: sums one session of this agent.
 * Other scopes (run, thread, user, organization) are not recorded per id, so the
 * query throws and the guard fails open with a logged warning.
 */
export function createSessionCostUsageStore(params: {
  agentId: string;
  config?: BranchConfig;
  loaders?: SessionCostUsageLoaders;
}): CostMetricStore {
  const loaders = params.loaders ?? defaultLoaders;
  return {
    getMetricAggregate: async (query: CostMetricQuery): Promise<CostMetricAggregate> => {
      const startMs = readWindowStart(query.filters);
      const sessionId = readStringFilter(query.filters, "sessionId");
      if (sessionId) {
        const summary = await loaders.loadSessionCostSummary({
          agentId: params.agentId,
          sessionId,
          config: params.config,
          startMs,
        });
        return { estimatedCost: summary?.totalCost ?? null, costUnit: "usd" };
      }
      const resourceId = readStringFilter(query.filters, "resourceId");
      if (resourceId) {
        const summary = await loaders.loadCostUsageSummary({
          agentId: resourceId,
          config: params.config,
          startMs,
        });
        return { estimatedCost: summary.totals.totalCost, costUnit: "usd" };
      }
      throw new Error("Branch cost usage store supports only the resource and session scopes");
    },
  };
}
