import { describe, expect, it, vi } from "vitest";
import { createSessionCostUsageStore } from "./session-cost-store.js";
import { COST_CONTROL_RESOURCE_ID_KEY, TokenCostControl } from "./token-cost-control.js";

function totals(totalCost: number) {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function createLoaders(costs: {
  agents?: Record<string, number>;
  sessions?: Record<string, number>;
}) {
  return {
    loadCostUsageSummary: vi.fn(async (params: { agentId: string }) => ({
      updatedAt: 0,
      days: 7,
      daily: [],
      totals: totals(costs.agents?.[params.agentId] ?? 0),
    })),
    loadSessionCostSummary: vi.fn(async (params: { sessionId?: string }) => {
      const cost = params.sessionId ? costs.sessions?.[params.sessionId] : undefined;
      return cost === undefined ? null : totals(cost);
    }),
  };
}

function blockingArgs(context: Map<string, unknown>) {
  return {
    requestContext: context,
    state: {},
    abort: (reason: string) => {
      throw new Error(reason);
    },
  };
}

describe("createSessionCostUsageStore", () => {
  it("sums an agent's recorded spend from the window start for the resource scope", async () => {
    const loaders = createLoaders({ agents: { main: 0.7 } });
    const store = createSessionCostUsageStore({ agentId: "main", loaders: loaders as never });
    const start = new Date(Date.UTC(2026, 9, 1));

    const result = await store.getMetricAggregate({
      name: ["branch_model_total_input_tokens"],
      aggregation: "sum",
      filters: { resourceId: "main", entityType: "agent", timestamp: { start } },
    });

    expect(result).toEqual({ estimatedCost: 0.7, costUnit: "usd" });
    expect(loaders.loadCostUsageSummary).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "main", startMs: start.getTime() }),
    );
  });

  it("sums one session of the agent for the session scope", async () => {
    const loaders = createLoaders({ sessions: { "session-1": 0.25 } });
    const store = createSessionCostUsageStore({ agentId: "main", loaders: loaders as never });

    const result = await store.getMetricAggregate({
      name: ["branch_model_total_input_tokens"],
      aggregation: "sum",
      filters: { sessionId: "session-1", entityType: "agent" },
    });

    expect(result).toEqual({ estimatedCost: 0.25, costUnit: "usd" });
    expect(loaders.loadSessionCostSummary).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "main", sessionId: "session-1", startMs: undefined }),
    );
  });

  it("reports no spend for a session with no recorded usage", async () => {
    const store = createSessionCostUsageStore({
      agentId: "main",
      loaders: createLoaders({}) as never,
    });
    const result = await store.getMetricAggregate({
      name: [],
      aggregation: "sum",
      filters: { sessionId: "missing" },
    });
    expect(result.estimatedCost).toBeNull();
  });

  it("rejects scopes Branch does not record so the guard fails open", async () => {
    const store = createSessionCostUsageStore({
      agentId: "main",
      loaders: createLoaders({}) as never,
    });
    await expect(
      store.getMetricAggregate({ name: [], aggregation: "sum", filters: { userId: "u1" } }),
    ).rejects.toThrow("resource and session scopes");

    const warn = vi.fn();
    const guard = new TokenCostControl({ maxCost: 0.01, scope: "user" });
    guard.attach({ store, logger: { warn } });
    await expect(
      guard.processInputStep(blockingArgs(new Map([["userId", "u1"]]))),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("cost query failed"),
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it("blocks the over-budget agent and allows another through TokenCostControl", async () => {
    const loaders = createLoaders({ agents: { spender: 0.7, saver: 0.01 } });
    const guard = new TokenCostControl({ maxCost: 0.5, scope: "resource", window: "30d" });
    guard.attach({
      store: createSessionCostUsageStore({ agentId: "main", loaders: loaders as never }),
    });

    await expect(
      guard.processInputStep(blockingArgs(new Map([[COST_CONTROL_RESOURCE_ID_KEY, "spender"]]))),
    ).rejects.toThrow("0.7/0.5");
    await expect(
      guard.processInputStep(blockingArgs(new Map([[COST_CONTROL_RESOURCE_ID_KEY, "saver"]]))),
    ).resolves.toBeUndefined();
  });
});
