import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeUsageRows, detectAnomalies, computeOptimizationScore, computeWeekOverWeek, type RunCost } from './usage-cost-insights.ts';
const run = (totalTokens: number, overrides: Partial<RunCost> = {}): RunCost => ({ts:1,jobId:'a',model:'claude-sonnet-4-6',provider:'anthropic',inputTokens:1000,outputTokens:200,totalTokens,cacheTokens:0,minCost:.006,...overrides});
test('source: outlier exceeds three times cohort median',()=>{
  const anomalies=detectAnomalies([run(200),run(200,{ts:2}),run(10000,{ts:3})],[{jobId:'a',runs:3}]);
  assert.equal(anomalies.length,1); assert.equal(anomalies[0]?.ratio,50); assert.equal(anomalies[0]?.medianTokens,200);
});
test('source: insufficient observations not flagged',()=>assert.deepEqual(detectAnomalies([run(100),run(10000)],[{jobId:'a',runs:2}]),[]));
test('source: zero medians and exact three-times threshold excluded',()=>{
  assert.deepEqual(detectAnomalies([run(0),run(0),run(10000)],[{jobId:'a',runs:3}]),[]);
  assert.deepEqual(detectAnomalies([run(100),run(100),run(300)],[{jobId:'a',runs:3}]),[]);
});
test('source: empty input perfect scoring sentinel',()=>assert.deepEqual(computeOptimizationScore([],[],{cacheTokens:0,estimatedSavings:0}),{overall:100,cacheScore:100,tieringScore:100,anomalyScore:100,efficiencyScore:100}));
test('source: expensive model overuse penalized',()=>{
  const score=computeOptimizationScore(Array.from({length:10},()=>run(1200,{model:'claude-opus-4-6'})),[],{cacheTokens:0,estimatedSavings:0}); assert.equal(score.tieringScore,0);
});
test('source: percentage-based anomaly score',()=>{
  const runs=Array.from({length:10},()=>run(1200));
  const anomalies=Array.from({length:3},()=>({ts:1,jobId:'a',totalTokens:10000,medianTokens:1000,ratio:10}));
  assert.equal(computeOptimizationScore(runs,anomalies,{cacheTokens:500,estimatedSavings:.001}).anomalyScore,0);
});
test('source: high cache ratio improves score',()=>{
  const runs=Array.from({length:5},()=>run(1000,{inputTokens:400}));
  assert.ok(computeOptimizationScore(runs,[],{cacheTokens:3000,estimatedSavings:.01}).cacheScore>computeOptimizationScore(runs,[],{cacheTokens:0,estimatedSavings:0}).cacheScore);
});
test('source: actual-cost week comparison has null percentage without baseline',()=>{
  const now=Date.UTC(2026,9,10); const week=7*86400000;
  assert.deepEqual(computeWeekOverWeek([run(1200,{ts:now-1,minCost:2})],now),{thisWeek:2,lastWeek:0,changePct:null});
  assert.deepEqual(computeWeekOverWeek([run(1200,{ts:now-week,minCost:2}),run(1200,{ts:now-week-1,minCost:1})],now),{thisWeek:2,lastWeek:1,changePct:100});
});
const row=(key:string,totalTokens:number,agentId='sapling')=>({key,agentId,model:'claude-sonnet-4-6',modelProvider:'anthropic',usage:{input:100,output:100,cacheRead:0,totalTokens,totalCost:.001,missingCostEntries:0,lastActivity:Number(key)||1}});
test('adapter: session anomaly exposes only input session identities',()=>{
  const result=analyzeUsageRows([row('1',200),row('2',200),row('3',10000)]);
  assert.equal(result.basis,'returned-session-cohort');assert.deepEqual(result.anomalies[0]?.sessionKeys,['3']);assert.equal(result.analyzedRows,3);
});
test('adapter: cohorts do not compare different agents, models or family scopes',()=>{
  for(const changed of [{...row('3',10000),agentId:'other'},{...row('3',10000),model:'other'},{...row('3',10000),scope:'family'}]) assert.deepEqual(analyzeUsageRows([row('1',200),row('2',200),changed]).anomalies,[]);
});
test('adapter: pending/stale/nonfinite usage excluded explicitly',()=>{
  const stale=row('2',200); const invalid=row('3',200);
  const r=analyzeUsageRows([row('1',200),{...stale,usage:{...stale.usage,staleSince:0}},{...invalid,usage:{...invalid.usage,totalTokens:NaN}},{...row('4',200),usage:null}]);
  assert.equal(r.analyzedRows,1);assert.equal(r.excludedRows,3);
});
test('adapter: cache writes are not invented as cache reads or dollar savings',()=>{
  const r=analyzeUsageRows([row('1',5000)]);assert.equal(r.optimizationScore.cacheScore,0);assert.equal('estimatedSavings' in r,false);
});
test('adapter: missing real prices remain explicit',()=>{
  const r=row('1',200);r.usage.missingCostEntries=2;assert.equal(analyzeUsageRows([r]).missingCostEntries,2);
});
