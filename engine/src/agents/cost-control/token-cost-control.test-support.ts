// Shared helpers for the TokenCostControl tests.
import { vi } from "vitest";
import {
  TokenCostControl,
  type CostControlLogger,
  type CostMetricStore,
  type TokenCostControlStepArgs,
} from "./token-cost-control.js";

export class TripWire<TMeta = unknown> extends Error {
  constructor(
    message: string,
    public readonly options: { retry?: boolean; metadata?: TMeta } = {},
  ) {
    super(message);
  }
}

export class RequestContext extends Map<string, unknown> {}

export const mockLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
} satisfies CostControlLogger;

export function createMockHost(store: CostMetricStore) {
  return { store, logger: mockLogger };
}

export function createMockCostMetricStore(options?: {
  inputCost?: number;
  outputCost?: number;
  costUnit?: string;
}): CostMetricStore {
  return {
    getMetricAggregate: vi.fn().mockImplementation(async (args: { name: string[] }) => {
      // The guard queries both token totals in one call; sum the configured costs.
      let estimatedCost: number | null = null;
      if (
        args.name.includes("branch_model_total_input_tokens") &&
        options?.inputCost !== undefined
      ) {
        estimatedCost = (estimatedCost ?? 0) + options.inputCost;
      }
      if (
        args.name.includes("branch_model_total_output_tokens") &&
        options?.outputCost !== undefined
      ) {
        estimatedCost = (estimatedCost ?? 0) + options.outputCost;
      }
      return {
        value: 0,
        estimatedCost,
        costUnit: options?.costUnit ?? null,
      };
    }),
  };
}

export function createMockTracing(traceId: string) {
  return {
    currentSpan: { traceId },
  };
}

export function createInputStepArgs(overrides: Record<string, any> = {}): TokenCostControlStepArgs {
  return {
    abort: ((reason?: string, options?: any) => {
      throw new TripWire(reason ?? "abort", options ?? {});
    }) as any,
    state: {},
    ...overrides,
  } as TokenCostControlStepArgs;
}

export function createRunScopeGuard(
  maxCost: number,
  obsStorage: CostMetricStore,
  opts?: { strategy?: "block" | "warn"; message?: string },
) {
  const guard = new TokenCostControl({ maxCost, scope: "run", ...opts });
  (guard as any).observabilityStorage = obsStorage;
  return guard;
}
