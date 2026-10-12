// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/core/src/processors/processors/token-cost-control.test.ts (atlas MODELS-ACCOUNTS-0080).
// Not ported: the MastraMemory fallback, __registerMastra and deprecated-alias cases
// (Mastra-only surfaces; attach() replaces __registerMastra) and the two live-fire
// cases on Mastra's in-memory store. session-cost-store.test.ts covers Branch's store.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenCostControl } from "./token-cost-control.js";
import {
  RequestContext,
  TripWire,
  createInputStepArgs,
  createMockCostMetricStore,
  createMockHost,
  createMockTracing,
  createRunScopeGuard,
  mockLogger,
} from "./token-cost-control.test-support.js";

describe("TokenCostControl thresholds and scopes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  describe("soft threshold (warnAtPercent) and once-per-run dedup", () => {
    it("constructor rejects invalid warnAtPercent values", () => {
      for (const warnAtPercent of [0, 100, 150, Number.NaN]) {
        expect(() => new TokenCostControl({ maxCost: 1, warnAtPercent })).toThrow("warnAtPercent");
      }
    });

    it("constructor accepts valid warnAtPercent", () => {
      expect(() => new TokenCostControl({ maxCost: 1, warnAtPercent: 80 })).not.toThrow();
    });

    it("soft threshold fires onViolation with threshold soft and does not abort (block strategy)", async () => {
      // cost 0.45 >= 80% of 0.5 (0.4) but < 0.5
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.25,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "block",
        warnAtPercent: 80,
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-soft-block") as any,
      });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0]![0].detail.threshold).toBe("soft");
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("80%"));
    });

    it("soft threshold fires onViolation with threshold soft and does not abort (warn strategy)", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.25,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "warn",
        warnAtPercent: 80,
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-soft-warn") as any,
      });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0]![0].detail.threshold).toBe("soft");
    });

    it("soft warning fires once across multiple steps sharing the same state object", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.25,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", warnAtPercent: 80 });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const sharedState: Record<string, unknown> = {};
      for (let step = 1; step <= 3; step++) {
        const args = createInputStepArgs({
          stepNumber: step,
          state: sharedState,
          tracing: createMockTracing("trace-soft-dedup") as any,
        });
        await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      }

      expect(onViolation).toHaveBeenCalledTimes(1);
    });

    it("hard warn-strategy violation fires log + onViolation once across steps sharing state", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", strategy: "warn" });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const sharedState: Record<string, unknown> = {};
      for (let step = 1; step <= 3; step++) {
        const args = createInputStepArgs({
          stepNumber: step,
          state: sharedState,
          tracing: createMockTracing("trace-hard-dedup") as any,
        });
        // Step still proceeds every time
        await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      }

      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0]![0].detail.threshold).toBe("hard");
      const violationLogs = (mockLogger.warn as any).mock.calls.filter((c: any[]) =>
        String(c[0]).includes("cost limit exceeded"),
      );
      expect(violationLogs).toHaveLength(1);
    });

    it("cost below soft threshold: no callbacks, no logs", async () => {
      // cost 0.3 < 80% of 0.5 (0.4)
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.1,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", warnAtPercent: 80 });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-under-soft") as any,
      });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(onViolation).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("at exactly maxCost only the hard path fires", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.3,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "warn",
        warnAtPercent: 80,
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-exact-limit") as any,
      });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0]![0].detail.threshold).toBe("hard");
    });
  });

  describe("includeBreakdown", () => {
    const breakdownGroups = [
      {
        dimensions: { provider: "openai", model: "gpt-5" },
        value: 1000,
        estimatedCost: 0.4,
        costUnit: "usd",
      },
      {
        dimensions: { provider: "anthropic", model: "claude-sonnet-4-5" },
        value: 500,
        estimatedCost: 0.2,
        costUnit: "usd",
      },
    ];

    const expectedBreakdown = [
      { provider: "openai", model: "gpt-5", estimatedCost: 0.4, costUnit: "usd" },
      { provider: "anthropic", model: "claude-sonnet-4-5", estimatedCost: 0.2, costUnit: "usd" },
    ];

    function withBreakdown(
      obsStorage: CostMetricStore,
      impl?: () => Promise<{ groups: typeof breakdownGroups }>,
    ) {
      (obsStorage as any).getMetricBreakdown = vi
        .fn()
        .mockImplementation(impl ?? (async () => ({ groups: breakdownGroups })));
      return obsStorage;
    }

    it("violation detail carries the mapped breakdown (warn strategy)", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
      );
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "warn",
        includeBreakdown: true,
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-warn") as any,
      });
      await expect(guard.processInputStep(args)).resolves.toBeUndefined();

      expect(onViolation.mock.calls[0]![0].detail.breakdown).toEqual(expectedBreakdown);
    });

    it("block-strategy tripwire metadata carries the mapped breakdown", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
      );
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", includeBreakdown: true });
      (guard as any).observabilityStorage = obsStorage;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-block") as any,
      });
      try {
        await guard.processInputStep(args);
        expect.fail("Expected TripWire to be thrown");
      } catch (error) {
        const tripwire = error as TripWire<any>;
        expect(tripwire.options.metadata.breakdown).toEqual(expectedBreakdown);
      }
    });

    it("soft-threshold violation carries the breakdown", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.3, outputCost: 0.1, costUnit: "usd" }),
      );
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        warnAtPercent: 80,
        includeBreakdown: true,
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-soft") as any,
      });
      await expect(guard.processInputStep(args)).resolves.toBeUndefined();

      expect(onViolation.mock.calls[0]![0].detail.threshold).toBe("soft");
      expect(onViolation.mock.calls[0]![0].detail.breakdown).toEqual(expectedBreakdown);
    });

    it("breakdown query uses the same filters as the cost query", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
      );
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "warn",
        includeBreakdown: true,
      });
      (guard as any).observabilityStorage = obsStorage;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-filters") as any,
      });
      await guard.processInputStep(args);

      const aggregateFilters = (obsStorage.getMetricAggregate as any).mock.calls[0][0].filters;
      const breakdownCall = (obsStorage as any).getMetricBreakdown.mock.calls[0][0];
      expect(breakdownCall.filters).toEqual(aggregateFilters);
      expect(breakdownCall.name).toEqual([
        "branch_model_total_input_tokens",
        "branch_model_total_output_tokens",
      ]);
      expect(breakdownCall.groupBy).toEqual(["provider", "model"]);
      expect(breakdownCall.aggregation).toBe("sum");
      expect(breakdownCall.limit).toBe(10);
    });

    it("includeBreakdown unset -> getMetricBreakdown never called on violation", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
      );
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", strategy: "warn" });
      guard.attach(createMockHost(obsStorage));

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-off") as any,
      });
      await guard.processInputStep(args);

      expect((obsStorage as any).getMetricBreakdown).not.toHaveBeenCalled();
    });

    it("no violation -> getMetricBreakdown never called even when enabled", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.01, outputCost: 0.01, costUnit: "usd" }),
      );
      const guard = new TokenCostControl({ maxCost: 10, scope: "run", includeBreakdown: true });
      (guard as any).observabilityStorage = obsStorage;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-happy") as any,
      });
      await expect(guard.processInputStep(args)).resolves.toBeUndefined();

      expect((obsStorage as any).getMetricBreakdown).not.toHaveBeenCalled();
    });

    it("getMetricBreakdown throwing -> violation fires without breakdown, debug logged", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
        async () => {
          throw new Error("getMetricBreakdown not implemented");
        },
      );
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "warn",
        includeBreakdown: true,
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-err") as any,
      });
      await expect(guard.processInputStep(args)).resolves.toBeUndefined();

      expect(onViolation).toHaveBeenCalledTimes(1);
      expect(onViolation.mock.calls[0]![0].detail.breakdown).toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "TokenCostControl: breakdown query failed; omitting breakdown",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("getMetricBreakdown throwing on block strategy -> still aborts, no breakdown in metadata", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
        async () => {
          throw new Error("not implemented");
        },
      );
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", includeBreakdown: true });
      (guard as any).observabilityStorage = obsStorage;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-err-block") as any,
      });
      try {
        await guard.processInputStep(args);
        expect.fail("Expected TripWire to be thrown");
      } catch (error) {
        const tripwire = error as TripWire<any>;
        expect(tripwire.options.metadata.breakdown).toBeUndefined();
        expect(tripwire.options.metadata.processorId).toBe("token-cost-control");
      }
    });

    it("null dimensions map to null provider/model entries", async () => {
      const obsStorage = withBreakdown(
        createMockCostMetricStore({ inputCost: 0.4, outputCost: 0.2, costUnit: "usd" }),
        async () =>
          ({
            groups: [{ dimensions: {}, value: 100, estimatedCost: null, costUnit: null }],
          }) as any,
      );
      const guard = new TokenCostControl({
        maxCost: 0.5,
        scope: "run",
        strategy: "warn",
        includeBreakdown: true,
      });
      (guard as any).observabilityStorage = obsStorage;
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-bd-null") as any,
      });
      await guard.processInputStep(args);

      expect(onViolation.mock.calls[0]![0].detail.breakdown).toEqual([
        { provider: null, model: null, estimatedCost: null, costUnit: null },
      ]);
    });
  });

  describe("user, organization, and session scopes", () => {
    const scopeCases = [
      { scope: "user" as const, contextKey: "userId", filterKey: "userId", id: "user-123" },
      {
        scope: "organization" as const,
        contextKey: "organizationId",
        filterKey: "organizationId",
        id: "org-456",
      },
      {
        scope: "session" as const,
        contextKey: "sessionId",
        filterKey: "sessionId",
        id: "session-789",
      },
    ];

    it.each(scopeCases)(
      "$scope scope passes the $filterKey filter from RequestContext key $contextKey",
      async ({ scope, contextKey, filterKey, id }) => {
        const obsStorage = createMockCostMetricStore({
          inputCost: 0.05,
          outputCost: 0.05,
          costUnit: "usd",
        });
        const guard = new TokenCostControl({ maxCost: 10, scope });
        (guard as any).observabilityStorage = obsStorage;

        const requestContext = new RequestContext();
        requestContext.set(contextKey, id);
        const args = createInputStepArgs({ stepNumber: 1, requestContext });

        await expect(guard.processInputStep(args)).resolves.toBeUndefined();
        expect(obsStorage.getMetricAggregate).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: expect.objectContaining({ [filterKey]: id }),
          }),
        );
      },
    );

    it.each(scopeCases)(
      "$scope scope applies the time window filter",
      async ({ scope, contextKey, id }) => {
        const obsStorage = createMockCostMetricStore();
        const guard = new TokenCostControl({ maxCost: 10, scope, window: "24h" });
        (guard as any).observabilityStorage = obsStorage;

        const requestContext = new RequestContext();
        requestContext.set(contextKey, id);
        const args = createInputStepArgs({ stepNumber: 1, requestContext });

        await guard.processInputStep(args);

        const call = (obsStorage.getMetricAggregate as any).mock.calls[0][0];
        expect(call.filters.timestamp).toBeDefined();
        expect(call.filters.timestamp.start).toBeInstanceOf(Date);
      },
    );

    it.each(scopeCases)(
      "$scope scope: missing RequestContext key -> fail-open, no query, no onViolation",
      async ({ scope }) => {
        const obsStorage = createMockCostMetricStore({
          inputCost: 5,
          outputCost: 5,
          costUnit: "usd",
        });
        const guard = new TokenCostControl({ maxCost: 0.5, scope });
        (guard as any).observabilityStorage = obsStorage;
        const onViolation = vi.fn();
        guard.onViolation = onViolation;

        const args = createInputStepArgs({ stepNumber: 1, requestContext: new RequestContext() });

        await expect(guard.processInputStep(args)).resolves.toBeUndefined();
        expect(obsStorage.getMetricAggregate).not.toHaveBeenCalled();
        expect(onViolation).not.toHaveBeenCalled();
      },
    );

    it("non-string RequestContext value -> fail-open, no query", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 5,
        outputCost: 5,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "user" });
      (guard as any).observabilityStorage = obsStorage;

      const requestContext = new RequestContext();
      requestContext.set("userId", 42);
      const args = createInputStepArgs({ stepNumber: 1, requestContext });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(obsStorage.getMetricAggregate).not.toHaveBeenCalled();
    });

    it("tripwire metadata carries the new scope and scopeKey", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "user" });
      (guard as any).observabilityStorage = obsStorage;

      const requestContext = new RequestContext();
      requestContext.set("userId", "user-meta");
      const args = createInputStepArgs({ stepNumber: 1, requestContext });

      try {
        await guard.processInputStep(args);
        expect.fail("Expected TripWire to be thrown");
      } catch (error) {
        const tripwire = error as TripWire<any>;
        expect(tripwire.options.metadata.scope).toBe("user");
        expect(tripwire.options.metadata.scopeKey).toBe("user:user-meta");
      }
    });

    it("violation detail carries the new scope and scopeKey (warn strategy)", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "organization", strategy: "warn" });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const requestContext = new RequestContext();
      requestContext.set("organizationId", "org-detail");
      const args = createInputStepArgs({ stepNumber: 1, requestContext });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      const detail = onViolation.mock.calls[0]![0].detail;
      expect(detail.scope).toBe("organization");
      expect(detail.scopeKey).toBe("organization:org-detail");
    });
  });

  describe("dynamic maxCost", () => {
    it("function maxCost receives the requestContext and drives block/allow", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const maxCostFn = vi.fn((requestContext?: Pick<RequestContext, "get">) =>
        requestContext?.get("tier") === "pro" ? 10 : 0.5,
      );
      const guard = new TokenCostControl({ maxCost: maxCostFn, scope: "run" });
      guard.attach(createMockHost(obsStorage));

      const requestContext = new RequestContext();
      requestContext.set("tier", "free");
      const args = createInputStepArgs({
        stepNumber: 1,
        requestContext,
        tracing: createMockTracing("trace-dyn-block") as any,
      });

      // cost 0.6 >= free-tier limit 0.5 -> blocks
      await expect(guard.processInputStep(args)).rejects.toThrow(TripWire);
      expect(maxCostFn).toHaveBeenCalledWith(requestContext);
    });

    it("two requests with different context-derived limits produce different outcomes", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({
        maxCost: (requestContext?: Pick<RequestContext, "get">) =>
          requestContext?.get("tier") === "pro" ? 10 : 0.5,
        scope: "run",
      });
      guard.attach(createMockHost(obsStorage));

      const proContext = new RequestContext();
      proContext.set("tier", "pro");
      const proArgs = createInputStepArgs({
        stepNumber: 1,
        requestContext: proContext,
        tracing: createMockTracing("trace-dyn-pro") as any,
      });
      // Same cost 0.6 < pro-tier limit 10 -> allows
      await expect(guard.processInputStep(proArgs)).resolves.toBeUndefined();

      const freeContext = new RequestContext();
      freeContext.set("tier", "free");
      const freeArgs = createInputStepArgs({
        stepNumber: 1,
        requestContext: freeContext,
        tracing: createMockTracing("trace-dyn-free") as any,
      });
      // cost 0.6 >= free-tier limit 0.5 -> blocks
      await expect(guard.processInputStep(freeArgs)).rejects.toThrow(TripWire);
    });

    it("tripwire metadata maxCost reflects the resolved value", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: () => 0.25, scope: "run" });
      guard.attach(createMockHost(obsStorage));

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-dyn-meta") as any,
      });

      try {
        await guard.processInputStep(args);
        expect.fail("Expected TripWire to be thrown");
      } catch (error) {
        const tripwire = error as TripWire<any>;
        expect(tripwire.options.metadata.maxCost).toBe(0.25);
      }
    });

    it.each([0, -1, Number.NaN])(
      "function returning %s -> step proceeds, logger warned, no onViolation",
      async (invalid) => {
        const obsStorage = createMockCostMetricStore({
          inputCost: 0.4,
          outputCost: 0.2,
          costUnit: "usd",
        });
        const guard = new TokenCostControl({ maxCost: () => invalid, scope: "run" });
        guard.attach(createMockHost(obsStorage));
        const onViolation = vi.fn();
        guard.onViolation = onViolation;

        const args = createInputStepArgs({
          stepNumber: 1,
          tracing: createMockTracing("trace-dyn-invalid") as any,
        });

        await expect(guard.processInputStep(args)).resolves.toBeUndefined();
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining("dynamic maxCost resolved to an invalid value"),
          expect.objectContaining({ value: invalid }),
        );
        expect(onViolation).not.toHaveBeenCalled();
      },
    );
  });

  describe("hardening (single query, logger, precision)", () => {
    it("queries both token metric names in a single getMetricAggregate call", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.1,
        outputCost: 0.1,
        costUnit: "usd",
      });
      const guard = createRunScopeGuard(10, obsStorage);

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-single-query") as any,
      });

      await guard.processInputStep(args);

      expect(obsStorage.getMetricAggregate).toHaveBeenCalledTimes(1);
      expect(obsStorage.getMetricAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: ["branch_model_total_input_tokens", "branch_model_total_output_tokens"],
          aggregation: "sum",
        }),
      );
    });

    it("logs through the attached logger when the cost query fails (fail-open)", async () => {
      const obsStorage = {
        getMetricAggregate: vi.fn().mockRejectedValue(new Error("storage down")),
      } as unknown as CostMetricStore;
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run" });
      guard.attach(createMockHost(obsStorage));

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-query-fail") as any,
      });

      // Fail-open: step proceeds
      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("cost query failed"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("normalizes float precision artifacts in violation messages", async () => {
      // 0.1 + 0.2 = 0.30000000000000004 in IEEE 754
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.1,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = createRunScopeGuard(0.25, obsStorage);

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-precision") as any,
      });

      try {
        await guard.processInputStep(args);
        expect.fail("Expected TripWire to be thrown");
      } catch (error) {
        const tripwire = error as TripWire<any>;
        expect(tripwire.message).toContain("0.3");
        expect(tripwire.message).not.toContain("0.30000000000000004");
      }
    });

    it("logs a warning when onViolation throws and still logs the violation warning", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", strategy: "warn" });
      guard.attach(createMockHost(obsStorage));
      guard.onViolation = vi.fn().mockRejectedValue(new Error("callback boom"));

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-cb-throw") as any,
      });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("onViolation callback threw"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("cost limit exceeded"));
    });
  });

  describe("review fixes", () => {
    it("constructor rejects Number.NaN and Infinity maxCost", () => {
      expect(() => new TokenCostControl({ maxCost: Number.NaN })).toThrow("finite positive number");
      expect(() => new TokenCostControl({ maxCost: Infinity })).toThrow("finite positive number");
    });

    it("two guard instances sharing one state bag each fire their own warning", async () => {
      // The runner keys per-processor state by processor.id, which is
      // hardcoded 'token-cost-control' - two instances in one pipeline share a state
      // bag. Their dedup keys must not collide.
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const lowGuard = new TokenCostControl({ maxCost: 0.5, scope: "run", strategy: "warn" });
      const highGuard = new TokenCostControl({ maxCost: 0.55, scope: "run", strategy: "warn" });
      lowGuard.attach(createMockHost(obsStorage));
      highGuard.attach(createMockHost(obsStorage));
      const lowViolation = vi.fn();
      const highViolation = vi.fn();
      lowGuard.onViolation = lowViolation;
      highGuard.onViolation = highViolation;

      const sharedState: Record<string, unknown> = {};
      const tracing = createMockTracing("trace-shared-state") as any;
      await lowGuard.processInputStep(
        createInputStepArgs({ stepNumber: 1, tracing, state: sharedState }),
      );
      await highGuard.processInputStep(
        createInputStepArgs({ stepNumber: 1, tracing, state: sharedState }),
      );

      expect(lowViolation).toHaveBeenCalledTimes(1);
      expect(highViolation).toHaveBeenCalledTimes(1);
    });

    it("two instances with the same limit but different warnAtPercent each fire their soft warning", async () => {
      // Cost 0.6 against maxCost 1 crosses both the 50% and 55% soft
      // thresholds; each instance must fire despite the shared state bag.
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const fiftyGuard = new TokenCostControl({ maxCost: 1, scope: "run", warnAtPercent: 50 });
      const fiftyFiveGuard = new TokenCostControl({
        maxCost: 1,
        scope: "run",
        warnAtPercent: 55,
      });
      fiftyGuard.attach(createMockHost(obsStorage));
      fiftyFiveGuard.attach(createMockHost(obsStorage));
      const fiftyViolation = vi.fn();
      const fiftyFiveViolation = vi.fn();
      fiftyGuard.onViolation = fiftyViolation;
      fiftyFiveGuard.onViolation = fiftyFiveViolation;

      const sharedState: Record<string, unknown> = {};
      const tracing = createMockTracing("trace-soft-shared") as any;
      await fiftyGuard.processInputStep(
        createInputStepArgs({ stepNumber: 1, tracing, state: sharedState }),
      );
      await fiftyFiveGuard.processInputStep(
        createInputStepArgs({ stepNumber: 1, tracing, state: sharedState }),
      );

      expect(fiftyViolation).toHaveBeenCalledTimes(1);
      expect(fiftyFiveViolation).toHaveBeenCalledTimes(1);
    });

    it("dedup stays once-per-request when a dynamic maxCost resolves differently per step", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      let call = 0;
      const guard = new TokenCostControl({
        // Varies per step but always below the queried cost of 0.6
        maxCost: () => 0.5 + call++ * 0.01,
        scope: "run",
        strategy: "warn",
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const sharedState: Record<string, unknown> = {};
      const tracing = createMockTracing("trace-varying-limit") as any;
      for (let step = 1; step <= 3; step++) {
        await guard.processInputStep(
          createInputStepArgs({ stepNumber: step, tracing, state: sharedState }),
        );
      }

      expect(onViolation).toHaveBeenCalledTimes(1);
    });

    it("two distinct state objects (two requests) each fire the warning once", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run", strategy: "warn" });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const tracing = createMockTracing("trace-two-requests") as any;
      const stateA: Record<string, unknown> = {};
      await guard.processInputStep(createInputStepArgs({ stepNumber: 1, tracing, state: stateA }));
      await guard.processInputStep(createInputStepArgs({ stepNumber: 2, tracing, state: stateA }));
      expect(onViolation).toHaveBeenCalledTimes(1);

      const stateB: Record<string, unknown> = {};
      await guard.processInputStep(createInputStepArgs({ stepNumber: 1, tracing, state: stateB }));
      expect(onViolation).toHaveBeenCalledTimes(2);
    });

    it("block tripwire metadata carries threshold: hard", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({ maxCost: 0.5, scope: "run" });
      guard.attach(createMockHost(obsStorage));

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-threshold-meta") as any,
      });

      try {
        await guard.processInputStep(args);
        expect.fail("Expected TripWire");
      } catch (error) {
        expect((error as TripWire<any>).options.metadata.threshold).toBe("hard");
      }
    });

    it("throwing dynamic maxCost function fails open with a logged warning", async () => {
      const obsStorage = createMockCostMetricStore({
        inputCost: 0.4,
        outputCost: 0.2,
        costUnit: "usd",
      });
      const guard = new TokenCostControl({
        maxCost: () => {
          throw new Error("tier lookup failed");
        },
        scope: "run",
      });
      guard.attach(createMockHost(obsStorage));
      const onViolation = vi.fn();
      guard.onViolation = onViolation;

      const args = createInputStepArgs({
        stepNumber: 1,
        tracing: createMockTracing("trace-maxcost-throw") as any,
      });

      await expect(guard.processInputStep(args)).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("dynamic maxCost function threw"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
      expect(onViolation).not.toHaveBeenCalled();
      expect(obsStorage.getMetricAggregate).not.toHaveBeenCalled();
    });
  });
});
