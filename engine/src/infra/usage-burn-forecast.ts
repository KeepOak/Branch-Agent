// Ported from ypollak2/llm-router@e4644871b4d434887b6dfe1cac6be9a3c166561a
// src/llm_router/forecast.py. Uses existing owner-scoped daily cost data.
export type BurnForecast = Readonly<{
  projectedMonthlyUsd: number;
  daysToLimit: number;
  pctRemaining: number;
  confidence: number;
  dailyBurnUsd: number;
  daysOfData: number;
}>;

type DailyCost = { date: string; totalCost: number };
const DAY_MS = 86_400_000;

function parseDay(day: string): Date {
  const date = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== day) {
    throw new Error("Invalid forecast calendar date");
  }
  return date;
}

/** Pure source forecast; missing usage days remain absent, as in upstream SQL GROUP BY. */
export function calculateBurnForecast(params: {
  daily: readonly DailyCost[];
  today: string;
  budgetLimitUsd?: number;
}): BurnForecast {
  const budget = params.budgetLimitUsd ?? 0;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("Invalid forecast budget");
  }
  const today = parseDay(params.today);
  const monthStart = `${params.today.slice(0, 7)}-01`;
  const windowStart = new Date(today.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
  const byDay = new Map<string, number>();
  for (const entry of params.daily) {
    parseDay(entry.date);
    if (!Number.isFinite(entry.totalCost) || entry.totalCost < 0) {
      throw new Error("Invalid forecast daily cost");
    }
    if (entry.date <= params.today) {
      byDay.set(entry.date, (byDay.get(entry.date) ?? 0) + entry.totalCost);
    }
  }
  const spends = [...byDay].filter(([day]) => day >= windowStart)
    .sort(([a], [b]) => a.localeCompare(b)).map(([, cost]) => cost);
  const count = spends.length;
  if (count < 3) {
    return Object.freeze({ projectedMonthlyUsd: 0, daysToLimit: -1, pctRemaining: -1,
      confidence: 0, dailyBurnUsd: 0, daysOfData: count });
  }
  const average = spends.reduce((sum, cost) => sum + cost, 0) / count;
  const meanX = (count - 1) / 2;
  let covariance = 0;
  let variance = 0;
  for (let index = 0; index < count; index += 1) {
    const x = index - meanX;
    covariance += x * ((spends[index] ?? 0) - average);
    variance += x * x;
  }
  const slope = covariance / variance;
  const dailyBurnUsd = slope > 0 ? average * 0.6 + slope * 0.4 : average;
  const currentSpend = [...byDay].filter(([day]) => day >= monthStart)
    .reduce((sum, [, cost]) => sum + cost, 0);
  const nextMonth = new Date(today);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 1);
  const daysRemaining = (nextMonth.getTime() - today.getTime()) / DAY_MS;
  const remaining = Math.max(0, budget - currentSpend);
  return Object.freeze({
    projectedMonthlyUsd: currentSpend + dailyBurnUsd * daysRemaining,
    daysToLimit: budget > 0 ? (dailyBurnUsd > 0 ? Math.floor(remaining / dailyBurnUsd) : 999) : -1,
    pctRemaining: budget > 0 ? remaining / budget * 100 : -1,
    confidence: Math.min(1, (count - 2) / 5),
    dailyBurnUsd, daysOfData: count,
  });
}

/** Do not present a partial/historical query as a current full-month forecast. */
export function forecastCoveredUsage(params: {
  daily: readonly DailyCost[];
  today: string;
  startDate: string;
  endDate: string;
  cacheStatus?: string;
  budgetLimitUsd?: number;
}): BurnForecast | null {
  const today = parseDay(params.today);
  const windowStart = new Date(today.getTime() - 7 * DAY_MS).toISOString().slice(0, 10);
  const monthStart = `${params.today.slice(0, 7)}-01`;
  const requiredStart = windowStart < monthStart ? windowStart : monthStart;
  if (params.startDate > requiredStart || params.endDate < params.today ||
      (params.cacheStatus !== undefined && params.cacheStatus !== "fresh")) {
    return null;
  }
  return calculateBurnForecast(params);
}
