// Ported from JohnRiceML/clawport-ui@40db84d69b793048a9f738db57fe6e5db9751df3 lib/costs.ts.
// Statistical analysis only: costs come from Branch's real accounting, not source price fallbacks.
export type RunCost = {
  ts: number; jobId: string; model: string; provider: string;
  inputTokens: number; outputTokens: number; totalTokens: number; cacheTokens: number; minCost: number;
};
export type JobCostSummary = { jobId: string; runs: number };
export type TokenAnomaly = { ts: number; jobId: string; totalTokens: number; medianTokens: number; ratio: number };
export type WeekOverWeek = { thisWeek: number; lastWeek: number; changePct: number | null };
export type CacheSavings = { cacheTokens: number; estimatedSavings: number };
export type OptimizationScore = { overall: number; cacheScore: number; tieringScore: number; anomalyScore: number; efficiencyScore: number };
const EXPENSIVE_MODELS = ['claude-opus-4-6', 'claude-opus-4-5'];

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function detectAnomalies(runCosts: RunCost[], jobSummaries: JobCostSummary[]): TokenAnomaly[] {
  const medianMap = new Map<string, number>()
  const countMap = new Map<string, number>()
  for (const js of jobSummaries) {
    countMap.set(js.jobId, js.runs)
  }

  // Compute median total_tokens per job
  const tokensByJob = new Map<string, number[]>()
  for (const rc of runCosts) {
    const arr = tokensByJob.get(rc.jobId) ?? []
    arr.push(rc.totalTokens)
    tokensByJob.set(rc.jobId, arr)
  }
  for (const [jobId, tokens] of tokensByJob) {
    medianMap.set(jobId, median(tokens))
  }

  const anomalies: TokenAnomaly[] = []
  for (const rc of runCosts) {
    const count = countMap.get(rc.jobId) ?? 0
    if (count < 3) continue
    const med = medianMap.get(rc.jobId) ?? 0
    if (med === 0) continue
    const ratio = rc.totalTokens / med
    if (ratio > 3) {
      anomalies.push({
        ts: rc.ts,
        jobId: rc.jobId,
        totalTokens: rc.totalTokens,
        medianTokens: med,
        ratio,
      })
    }
  }
  return anomalies.sort((a, b) => b.ratio - a.ratio)
}

export function computeWeekOverWeek(runCosts: RunCost[], now = Date.now()): WeekOverWeek {
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000
  const thisWeekStart = now - ONE_WEEK
  const lastWeekStart = now - 2 * ONE_WEEK

  let thisWeek = 0
  let lastWeek = 0
  for (const rc of runCosts) {
    if (rc.ts >= thisWeekStart) thisWeek += rc.minCost
    else if (rc.ts >= lastWeekStart) lastWeek += rc.minCost
  }

  const changePct = lastWeek > 0
    ? ((thisWeek - lastWeek) / lastWeek) * 100
    : null

  return { thisWeek, lastWeek, changePct }
}

export function computeOptimizationScore(
  runCosts: RunCost[],
  anomalies: TokenAnomaly[],
  cacheSavings: CacheSavings,
): OptimizationScore {
  if (runCosts.length === 0) return { overall: 100, cacheScore: 100, tieringScore: 100, anomalyScore: 100, efficiencyScore: 100 }

  // Cache score: 80%+ cache read ratio = 100, linear scale down
  // Source: OpenRouter docs recommend 80%+ hit rate; real-world Claude Code sessions show 90%+
  const totalInput = runCosts.reduce((s, r) => s + r.inputTokens, 0)
  const cacheRatio = totalInput > 0 ? cacheSavings.cacheTokens / (totalInput + cacheSavings.cacheTokens) : 0
  const cacheScore = Math.min(100, Math.round(cacheRatio * 125))

  // Tiering score: penalize Opus overuse, but Opus 4.6 is only 1.67x Sonnet so softer curve
  // Source: ClaudeFast recommends <15% Opus; Anthropic docs say reserve Opus for complex reasoning
  const expensiveCount = runCosts.filter(r => EXPENSIVE_MODELS.some(m => r.model.startsWith(m))).length
  const expensivePct = expensiveCount / runCosts.length
  const tieringScore = Math.min(100, Math.round(Math.max(0, 100 - expensivePct * 120)))

  // Anomaly score: percentage-based so it scales with run count
  // Source: Token Budget Pattern recommends flagging runs >3x p95; we use >3x median
  const anomalyPct = anomalies.length / runCosts.length
  const anomalyScore = Math.min(100, Math.round(Math.max(0, 100 - anomalyPct * 500)))

  // Efficiency: output / effective input ratio -- coding agents typically 0.2-1.5x
  // Source: Efficient Agents paper (arXiv:2508.02694) shows Claude at ~0.79x for agentic tasks
  // Use inputTokens + cacheTokens as denominator since cache reads are real context processed
  // (input_tokens from the API is only non-cached input; with good caching it can be tiny)
  const totalOutput = runCosts.reduce((s, r) => s + r.outputTokens, 0)
  const totalCache = runCosts.reduce((s, r) => s + r.cacheTokens, 0)
  const effectiveInput = totalInput + totalCache
  const outputRatio = effectiveInput > 0 ? totalOutput / effectiveInput : 0
  const efficiencyScore = Math.min(100, Math.round(Math.max(0, (1 - Math.max(0, outputRatio - 0.3) / 4.7) * 100)))

  // Weighted average: model routing and cache have highest controllable impact
  const overall = Math.round(tieringScore * 0.30 + cacheScore * 0.25 + efficiencyScore * 0.25 + anomalyScore * 0.20)

  return { overall, cacheScore, tieringScore, anomalyScore, efficiencyScore }
}

type UsageRow = {
  key: string; agentId?: string; model?: string; modelProvider?: string;
  modelOverride?: string; providerOverride?: string; updatedAt?: number;
  scope?: string;
  usage: {
    input: number; output: number; cacheRead: number; totalTokens: number; totalCost: number;
    missingCostEntries: number; lastActivity?: number; refreshing?: boolean; staleSince?: number;
  } | null;
};

/** Only the caller-visible returned session cohort is analyzed; row limits remain explicit. */
export function analyzeUsageRows(rows: readonly UsageRow[]) {
  const observations: RunCost[] = [];
  const keyByObservation = new Map<RunCost, string>();
  let excludedRows = 0;
  let missingCostEntries = 0;
  for (const row of rows) {
    const usage = row.usage;
    if (!usage || usage.refreshing || usage.staleSince !== undefined ||
        ![usage.input, usage.output, usage.cacheRead, usage.totalTokens, usage.totalCost]
          .every(value => Number.isFinite(value) && value >= 0)) {
      excludedRows += 1;
      continue;
    }
    missingCostEntries += usage.missingCostEntries;
    const model = row.modelOverride ?? row.model ?? 'unknown';
    const provider = row.providerOverride ?? row.modelProvider ?? 'unknown';
    const rc: RunCost = {
      ts: usage.lastActivity ?? row.updatedAt ?? 0,
      jobId: JSON.stringify([row.agentId ?? 'unknown', model, provider, row.scope ?? 'instance']),
      model, provider, inputTokens: usage.input, outputTokens: usage.output,
      totalTokens: usage.totalTokens, cacheTokens: usage.cacheRead, minCost: usage.totalCost,
    };
    observations.push(rc);
    keyByObservation.set(rc, row.key);
  }
  const counts = new Map<string, number>();
  for (const rc of observations) counts.set(rc.jobId, (counts.get(rc.jobId) ?? 0) + 1);
  const anomalies = detectAnomalies(observations, [...counts].map(([jobId, runs]) => ({jobId, runs})));
  const cacheTokens = observations.reduce((sum, rc) => sum + rc.cacheTokens, 0);
  return {
    basis: 'returned-session-cohort' as const,
    analyzedRows: observations.length, excludedRows, missingCostEntries,
    anomalies: anomalies.map(anomaly => ({
      ...anomaly,
      sessionKeys: observations.filter(rc => rc.jobId === anomaly.jobId && rc.ts === anomaly.ts &&
        rc.totalTokens === anomaly.totalTokens).map(rc => keyByObservation.get(rc)!),
    })),
    optimizationScore: computeOptimizationScore(observations, anomalies, {cacheTokens, estimatedSavings: 0}),
  };
}
