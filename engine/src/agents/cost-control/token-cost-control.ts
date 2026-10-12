// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/core/src/processors/processors/token-cost-control.ts (atlas MODELS-ACCOUNTS-0080).
// Mastra's observability storage becomes a CostMetricStore. Branch's store over
// its recorded session usage is createSessionCostUsageStore in ./session-cost-store.ts.

/**
 * Cost scope determines what usage is tracked:
 * - 'run': Only cost from the current agent run
 * - 'resource': Cumulative cost across runs for the same resourceId (default)
 * - 'thread': Cumulative cost across runs for the same threadId
 * - 'user': Cumulative cost across runs for the same userId
 * - 'organization': Cumulative cost across runs for the same organizationId
 * - 'session': Cumulative cost across runs for the same sessionId
 *
 * The 'user', 'organization', and 'session' scopes read the plain request
 * context keys `userId` / `organizationId` / `sessionId`. If the key is
 * missing from the request context, the check is skipped (fail-open).
 */
export type CostScope = "run" | "resource" | "thread" | "user" | "organization" | "session";

/** Named time windows for cost aggregation. Applicable to all scopes except 'run'. */
export type CostWindow = "1h" | "6h" | "24h" | "7d" | "30d" | "365d";

/** Reserved request context key for the 'resource' scope id. */
export const COST_CONTROL_RESOURCE_ID_KEY = "branch__resourceId";
/** Reserved request context key for the 'thread' scope id. */
export const COST_CONTROL_THREAD_ID_KEY = "branch__threadId";

export const TOKEN_TOTAL_METRIC_NAMES = [
  "branch_model_total_input_tokens",
  "branch_model_total_output_tokens",
];

/** Read-only view of the per-request context (a Map works). */
export type CostControlRequestContext = { get(key: string): unknown };

export type CostControlLogger = {
  warn(message: string, meta?: Record<string, unknown>): void;
  debug?(message: string, meta?: Record<string, unknown>): void;
};

export type CostMetricQuery = {
  name: string[];
  aggregation: "sum";
  filters: Record<string, unknown>;
};

export type CostMetricAggregate = {
  value?: number | null;
  estimatedCost?: number | null;
  costUnit?: string | null;
};

export type CostMetricBreakdown = {
  groups: Array<{
    dimensions: Record<string, string | null | undefined>;
    value?: number | null;
    estimatedCost?: number | null;
    costUnit?: string | null;
  }>;
};

/** Source of recorded spend. `getMetricBreakdown` is optional. */
export type CostMetricStore = {
  getMetricAggregate: (query: CostMetricQuery) => Promise<CostMetricAggregate>;
  getMetricBreakdown?: (
    query: CostMetricQuery & { groupBy: string[]; limit: number },
  ) => Promise<CostMetricBreakdown>;
};

/** Cost usage summary for cost control decisions */
export interface TokenCostControlUsage {
  estimatedCost: number | null;
  costUnit: string | null;
}

/** Per-provider/model cost breakdown entry attached when `includeBreakdown` is enabled. */
export interface TokenCostControlBreakdownEntry {
  provider: string | null;
  model: string | null;
  estimatedCost: number | null;
  costUnit: string | null;
}

/** Metadata passed to `abort` when the cost control blocks */
export interface TokenCostControlTripwireMetadata {
  processorId: "token-cost-control";
  usage: TokenCostControlUsage;
  maxCost: number;
  scope: CostScope;
  scopeKey?: string;
  /** Which threshold was crossed. Always 'hard': only the hard limit aborts. */
  threshold: "hard";
  /** Present only when `includeBreakdown` is enabled and the breakdown query succeeds. */
  breakdown?: TokenCostControlBreakdownEntry[];
}

/** Configuration options for TokenCostControl */
export interface TokenCostControlOptions {
  /**
   * Maximum estimated cost allowed (e.g. 0.50 for $0.50 USD). Either a fixed
   * number or a function of the request context for per-request budgets. If
   * the function returns anything other than a finite positive number, the
   * check is skipped for that request (fail-open) and a warning is logged.
   */
  maxCost: number | ((requestContext?: CostControlRequestContext) => number);
  /** Scope for cost tracking. Defaults to 'resource'. */
  scope?: CostScope;
  /** Time window for all scopes except 'run'. Defaults to '7d'. */
  window?: CostWindow;
  /** 'block' aborts (default); 'warn' logs and lets the step proceed. */
  strategy?: "block" | "warn";
  /** Custom message template for the abort reason. Placeholders: {usage}, {limit} */
  message?: string;
  /**
   * Optional soft threshold as a percentage of maxCost (exclusive 0-100). When
   * reached (but still below the limit), a warning is logged and onViolation is
   * called once per request, regardless of strategy. Never aborts the step.
   */
  warnAtPercent?: number;
  /** When true, violations include a per-provider/model breakdown. Defaults to false. */
  includeBreakdown?: boolean;
}

/** Cost control specific violation detail */
export interface TokenCostControlViolationDetail {
  usage: number;
  limit: number;
  totalUsage: TokenCostControlUsage;
  scope: CostScope;
  scopeKey?: string;
  /** 'soft' for the warnAtPercent threshold, 'hard' for the maxCost limit. */
  threshold: "soft" | "hard";
  breakdown?: TokenCostControlBreakdownEntry[];
}

export type TokenCostControlViolation = {
  processorId: string;
  message: string;
  detail: TokenCostControlViolationDetail;
};

export type TokenCostControlAbort = (
  reason: string,
  options: { retry: false; metadata: TokenCostControlTripwireMetadata },
) => void;

/** Arguments for one pre-model-call check. `state` lives for one request. */
export type TokenCostControlStepArgs = {
  requestContext?: CostControlRequestContext;
  tracing?: { currentSpan?: { traceId?: string } };
  state: Record<string, unknown>;
  abort: TokenCostControlAbort;
};

type ScopeFilter = { filter: Record<string, string>; scopeKey?: string };

/**
 * Monotonic counter distinguishing instances in per-request dedup state keys,
 * so several instances sharing one state bag don't suppress each other.
 */
let tokenCostControlInstanceCounter = 0;

function nextInstanceKey(): number {
  tokenCostControlInstanceCounter += 1;
  return tokenCostControlInstanceCounter;
}

const WINDOW_MS: Record<CostWindow, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000,
};

// Reserved keys for resource/thread; the other scopes read plain keys.
const SCOPE_KEYS: Record<Exclude<CostScope, "run">, { contextKey: string; filterKey: string }> = {
  resource: { contextKey: COST_CONTROL_RESOURCE_ID_KEY, filterKey: "resourceId" },
  thread: { contextKey: COST_CONTROL_THREAD_ID_KEY, filterKey: "threadId" },
  user: { contextKey: "userId", filterKey: "userId" },
  organization: { contextKey: "organizationId", filterKey: "organizationId" },
  session: { contextKey: "sessionId", filterKey: "sessionId" },
};

function validateOptions(options: TokenCostControlOptions): void {
  if (
    typeof options.maxCost === "number" &&
    (!Number.isFinite(options.maxCost) || options.maxCost <= 0)
  ) {
    throw new Error("TokenCostControl requires maxCost to be a finite positive number");
  }
  const pct = options.warnAtPercent;
  if (pct !== undefined && (!Number.isFinite(pct) || pct <= 0 || pct >= 100)) {
    throw new Error(
      "TokenCostControl requires warnAtPercent to be a number between 0 and 100 (exclusive)",
    );
  }
}

// Normalize float precision artifacts (e.g. 0.30000000000000004 -> 0.3)
function formatNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

/**
 * TokenCostControl checks cumulative estimated spend before each model call,
 * blocking or warning when a monetary limit is exceeded. It is approximate:
 * spend is read from recorded usage, so a fast run can pass the limit before
 * its own usage is recorded. Treat `maxCost` as a best-effort threshold.
 * Every failure to read spend fails open.
 */
export class TokenCostControl {
  public readonly id = "token-cost-control";
  public readonly name = "Token Cost Control";
  public onViolation?: (violation: TokenCostControlViolation) => void | Promise<void>;

  private maxCost: TokenCostControlOptions["maxCost"];
  private scope: CostScope;
  private window: CostWindow;
  private strategy: "block" | "warn";
  private messageTemplate: string;
  private warnAtPercent?: number;
  private includeBreakdown: boolean;
  private readonly instanceKey = nextInstanceKey();
  private observabilityStorage?: CostMetricStore;
  private logger?: CostControlLogger;

  constructor(options: TokenCostControlOptions) {
    validateOptions(options);
    this.warnAtPercent = options.warnAtPercent;
    this.maxCost = options.maxCost;
    this.scope = options.scope ?? "resource";
    this.window = options.window ?? "7d";
    this.strategy = options.strategy ?? "block";
    this.messageTemplate =
      options.message ?? "Cost control: estimated cost limit exceeded ({usage}/{limit})";
    this.includeBreakdown = options.includeBreakdown ?? false;
  }

  /** Connects the spend store and logger. Throws when the store cannot aggregate. */
  attach(host: { store?: unknown; logger?: CostControlLogger }): void {
    const store = host.store as Partial<CostMetricStore> | undefined;
    if (!store || typeof store.getMetricAggregate !== "function") {
      throw new Error(
        "TokenCostControl requires a cost usage store (observability storage) with getMetricAggregate support.",
      );
    }
    this.observabilityStorage = store as CostMetricStore;
    this.logger = host.logger;
  }

  private resolveScopeFilter(
    requestContext?: CostControlRequestContext,
    traceId?: string,
  ): ScopeFilter | undefined {
    if (this.scope === "run") {
      return traceId ? { filter: { traceId } } : undefined;
    }
    const { contextKey, filterKey } = SCOPE_KEYS[this.scope];
    const id = requestContext?.get(contextKey);
    if (typeof id !== "string" || !id) {
      return undefined;
    }
    return { filter: { [filterKey]: id }, scopeKey: `${this.scope}:${id}` };
  }

  private getWindowTimestamp(): { start: Date } {
    return { start: new Date(Date.now() - WINDOW_MS[this.window]) };
  }

  private buildFilters(scopeFilter: Record<string, string>): Record<string, unknown> {
    const filters: Record<string, unknown> = { ...scopeFilter, entityType: "agent" };
    // Apply time window for all non-run scopes
    if (this.scope !== "run") {
      filters["timestamp"] = this.getWindowTimestamp();
    }
    return filters;
  }

  private async queryCost(scopeFilter: Record<string, string>): Promise<TokenCostControlUsage> {
    if (!this.observabilityStorage) {
      return { estimatedCost: null, costUnit: null };
    }
    try {
      const result = await this.observabilityStorage.getMetricAggregate({
        name: TOKEN_TOTAL_METRIC_NAMES,
        aggregation: "sum",
        filters: this.buildFilters(scopeFilter),
      });
      const totalCost = result.estimatedCost ?? 0;
      return {
        estimatedCost: totalCost > 0 ? totalCost : null,
        costUnit: result.costUnit ?? null,
      };
    } catch (error) {
      this.logger?.warn("TokenCostControl: cost query failed; allowing step (fail-open)", {
        error,
      });
      return { estimatedCost: null, costUnit: null };
    }
  }

  /** Queried only when a violation trips and `includeBreakdown` is set. Degrades to undefined. */
  private async queryBreakdown(
    scopeFilter: Record<string, string>,
  ): Promise<TokenCostControlBreakdownEntry[] | undefined> {
    const store = this.observabilityStorage;
    if (!this.includeBreakdown || !store) {
      return undefined;
    }
    try {
      if (!store.getMetricBreakdown) {
        throw new Error("cost usage store does not support getMetricBreakdown");
      }
      const result = await store.getMetricBreakdown({
        name: TOKEN_TOTAL_METRIC_NAMES,
        groupBy: ["provider", "model"],
        aggregation: "sum",
        filters: this.buildFilters(scopeFilter),
        limit: 10,
      });
      return result.groups.map((group) => ({
        provider: group.dimensions["provider"] ?? null,
        model: group.dimensions["model"] ?? null,
        estimatedCost: group.estimatedCost ?? null,
        costUnit: group.costUnit ?? null,
      }));
    } catch (error) {
      this.logger?.debug?.("TokenCostControl: breakdown query failed; omitting breakdown", {
        error,
      });
      return undefined;
    }
  }

  private formatMessage(usage: number, limit: number): string {
    return this.messageTemplate
      .replace("{usage}", formatNumber(usage))
      .replace("{limit}", formatNumber(limit));
  }

  private async emitWarning(
    message: string,
    detail: TokenCostControlViolationDetail,
  ): Promise<void> {
    if (this.onViolation) {
      try {
        await this.onViolation({ processorId: this.id, message, detail });
      } catch (error) {
        // onViolation errors should not prevent the guard from functioning
        this.logger?.warn("TokenCostControl: onViolation callback threw", { error });
      }
    }
    this.logger?.warn(`TokenCostControl: ${message}`);
  }

  /** Stable per-instance, per-request dedup key, even when a dynamic maxCost varies per step. */
  private warnedStateKey(level: "hard" | "soft"): string {
    return `tokenCostControlWarned:${level}:${this.instanceKey}`;
  }

  private resolveMaxCost(requestContext?: CostControlRequestContext): number | undefined {
    if (typeof this.maxCost === "number") {
      return this.maxCost;
    }
    let value: number;
    try {
      value = this.maxCost(requestContext);
    } catch (error) {
      this.logger?.warn(
        "TokenCostControl: dynamic maxCost function threw; skipping check (fail-open)",
        { error },
      );
      return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      this.logger?.warn(
        "TokenCostControl: dynamic maxCost resolved to an invalid value; skipping check",
        { value },
      );
      return undefined;
    }
    return value;
  }

  /** Runs before each model call. Calls `args.abort` when the hard limit blocks. */
  async processInputStep(args: TokenCostControlStepArgs): Promise<void> {
    const traceId = args.tracing?.currentSpan?.traceId;
    const resolved = this.resolveScopeFilter(args.requestContext, traceId);
    if (!resolved) {
      return;
    }
    const maxCost = this.resolveMaxCost(args.requestContext);
    if (maxCost === undefined) {
      return;
    }
    const usage = await this.queryCost(resolved.filter);
    if (usage.estimatedCost === null) {
      return;
    }
    if (usage.estimatedCost >= maxCost) {
      await this.handleHardLimit(args, resolved, usage, maxCost);
      return;
    }
    await this.handleSoftThreshold(args, resolved, usage, maxCost);
  }

  private async handleHardLimit(
    args: TokenCostControlStepArgs,
    resolved: ScopeFilter,
    usage: TokenCostControlUsage,
    maxCost: number,
  ): Promise<void> {
    const cost = usage.estimatedCost ?? 0;
    const message = this.formatMessage(cost, maxCost);
    const { filter, scopeKey } = resolved;
    if (this.strategy === "warn") {
      // Fire the warning and onViolation at most once per request
      const stateKey = this.warnedStateKey("hard");
      if (args.state[stateKey]) {
        return;
      }
      args.state[stateKey] = true;
      const breakdown = await this.queryBreakdown(filter);
      const detail: TokenCostControlViolationDetail = {
        usage: cost,
        limit: maxCost,
        totalUsage: usage,
        scope: this.scope,
        scopeKey,
        threshold: "hard",
      };
      await this.emitWarning(message, breakdown ? { ...detail, breakdown } : detail);
      return;
    }
    const breakdown = await this.queryBreakdown(filter);
    const metadata: TokenCostControlTripwireMetadata = {
      processorId: this.id,
      usage,
      maxCost,
      scope: this.scope,
      scopeKey,
      threshold: "hard",
    };
    args.abort(message, {
      retry: false,
      metadata: breakdown ? { ...metadata, breakdown } : metadata,
    });
  }

  private async handleSoftThreshold(
    args: TokenCostControlStepArgs,
    resolved: ScopeFilter,
    usage: TokenCostControlUsage,
    maxCost: number,
  ): Promise<void> {
    const cost = usage.estimatedCost ?? 0;
    if (this.warnAtPercent === undefined || cost < (maxCost * this.warnAtPercent) / 100) {
      return;
    }
    const stateKey = this.warnedStateKey("soft");
    if (args.state[stateKey]) {
      return;
    }
    args.state[stateKey] = true;
    const message = `Cost control: estimated cost reached ${this.warnAtPercent}% of the limit (${formatNumber(cost)}/${formatNumber(maxCost)})`;
    const breakdown = await this.queryBreakdown(resolved.filter);
    const detail: TokenCostControlViolationDetail = {
      usage: cost,
      limit: maxCost,
      totalUsage: usage,
      scope: this.scope,
      scopeKey: resolved.scopeKey,
      threshold: "soft",
    };
    await this.emitWarning(message, breakdown ? { ...detail, breakdown } : detail);
  }
}
