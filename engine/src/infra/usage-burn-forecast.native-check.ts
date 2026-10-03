import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateBurnForecast, forecastCoveredUsage } from './usage-burn-forecast.ts';

const today = '2026-10-10';
const daily = (costs: number[]) => costs.map((totalCost, i) => ({ date: `2026-10-${String(10 - costs.length + i + 1).padStart(2, '0')}`, totalCost }));
const forecast = (costs: number[], budgetLimitUsd?: number) => calculateBurnForecast({daily: daily(costs), today, budgetLimitUsd});
test('source: no historical usage', () => assert.deepEqual(forecast([]), {projectedMonthlyUsd: 0, daysToLimit: -1, pctRemaining: -1, confidence: 0, dailyBurnUsd: 0, daysOfData: 0}));
test('source: fewer than three days', () => assert.equal(forecast([.01, .01]).confidence, 0));
test('source: sufficient data yields absolute projection', () => {
  const f = forecast([.02,.02,.02,.02,.02]);
  assert.equal(f.daysOfData, 5); assert.equal(f.dailyBurnUsd, .02);
  assert.ok(Math.abs(f.projectedMonthlyUsd - .54) < 1e-12); assert.equal(f.confidence, .6);
});
test('source: monthly budget countdown', () => {
  const f = forecast([1,1,1,1,1], 10); assert.equal(f.daysToLimit, 5); assert.equal(f.pctRemaining, 50);
});
test('source: independent scoped providers retain different prices', () => assert.ok(forecast([.05,.05,.05]).dailyBurnUsd > forecast([.001,.001,.001]).dailyBurnUsd));
test('source: exhausted budget', () => {
  const f = forecast([3,3,3], 5); assert.equal(f.daysToLimit, 0); assert.equal(f.pctRemaining, 0);
});
test('source: immutable result', () => assert.ok(Object.isFrozen(forecast([1,1,1]))));
test('source: missing usage days are not filled with synthetic zeros', () => {
  const f = calculateBurnForecast({today, daily: [{date:'2026-10-03',totalCost:2},{date:'2026-10-06',totalCost:2},{date:'2026-10-10',totalCost:2}]});
  assert.equal(f.daysOfData,3); assert.equal(f.dailyBurnUsd,2);
});
test('source: upward regression is tempered and downward uses mean', () => {
  assert.equal(forecast([1,2,3]).dailyBurnUsd,1.6); assert.equal(forecast([3,2,1]).dailyBurnUsd,2);
});
test('adapter: duplicate buckets merged, future/old rows excluded from burn', () => {
  const f = calculateBurnForecast({today, daily:[...daily([1,1,1]),{date:'2026-10-08',totalCost:1},{date:'2026-10-01',totalCost:4},{date:'2026-10-11',totalCost:100}]});
  assert.equal(f.daysOfData,3); assert.equal(f.dailyBurnUsd,4/3);
  assert.equal(f.projectedMonthlyUsd,8+(4/3)*22);
});
test('adapter: no-limit and zero-burn sentinel semantics', () => {
  assert.equal(forecast([1,1,1]).daysToLimit,-1); assert.equal(forecast([0,0,0],10).daysToLimit,999);
});
test('calendar: February leap year and December rollover', () => {
  for (const [today, dates, expected] of [
    ['2024-02-28',['2024-02-26','2024-02-27','2024-02-28'],5],
    ['2026-12-31',['2026-12-29','2026-12-30','2026-12-31'],4],
  ] as const) assert.equal(calculateBurnForecast({today,daily:dates.map(date=>({date,totalCost:1}))}).projectedMonthlyUsd,expected);
});
test('adapter: refuse incomplete month/trailing window and stale cache', () => {
  const base = {today,daily:daily([1,1,1]),startDate:'2026-10-01',endDate:today};
  assert.ok(forecastCoveredUsage(base));
  assert.equal(forecastCoveredUsage({...base,startDate:'2026-10-04'}),null);
  assert.equal(forecastCoveredUsage({...base,endDate:'2026-10-09'}),null);
  for (const cacheStatus of ['partial','refreshing','stale']) assert.equal(forecastCoveredUsage({...base,cacheStatus}),null);
  assert.ok(forecastCoveredUsage({...base,cacheStatus:'fresh'}));
});
test('adapter: month boundary requires prior-month burn observations', () => {
  assert.equal(forecastCoveredUsage({today:'2026-11-02',daily:[],startDate:'2026-11-01',endDate:'2026-11-02'}),null);
});
test('adapter: invalid calendar and nonfinite costs rejected', () => {
  assert.throws(()=>calculateBurnForecast({today:'2026-02-30',daily:[]}));
  for (const totalCost of [NaN,Infinity,-1]) assert.throws(()=>calculateBurnForecast({today,daily:[{date:today,totalCost}]}));
});
