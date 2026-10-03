import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { forecastCoveredUsage } from '../../infra/usage-burn-forecast.ts';
import { analyzeUsageRows } from '../../infra/usage-cost-insights.ts';

// Execute the actual source handler with controlled cache/policy/date dependencies.
// This is a handler integration fixture, not a native Gateway/auth/storage acceptance test.
const require = createRequire(import.meta.url);
const ts = require(process.env.BRANCH_TEST_TYPESCRIPT_MODULE ?? 'typescript');
const source = fs.readFileSync(new URL('./usage.ts', import.meta.url),'utf8');
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
function fixture({admin=true,cap='all',agent='sapling',summary,sessionResult,startDate='2026-09-01',endDate='2026-12-31'}={}){
  const calls=[];
  const ranges={startMs:Date.parse(`${startDate}T00:00:00Z`),endMs:Date.parse(`${endDate}T23:59:59Z`)};
  const stubs={
    normalizeOptionalString:value=>typeof value==='string'&&value.trim()?value.trim():undefined,
    normalizeAgentId:value=>value,
    forecastCoveredUsage,analyzeUsageRows,
    isGatewayAdmin:()=>admin,operatorSessionCap:()=>cap,
    resolveRequestedSessionAgentId:()=>({ok:true,agentId:agent}),
    resolveDateInterpretation:()=>({ok:true,value:{mode:'utc'}}),
    resolveDateRange:()=>({ok:true,value:ranges}),
    resolveDayBucket:()=>undefined,
    formatDateLabel:ms=>new Date(ms).toISOString().slice(0,10),
    errorShape:(code,message)=>({code,message}),ErrorCodes:{FORBIDDEN:'FORBIDDEN',INVALID_REQUEST:'INVALID_REQUEST'},
    loadCostUsageSummaryCached:async params=>{calls.push(params);return summary;},
    loadSessionsUsageResultCached:async params=>{calls.push(params);return sessionResult;},
    assertValidParams:()=>true,gatewayClientSessionCreator:()=>undefined,
    createSessionListEntryFilter:()=>()=>false,
  };
  const exports={};
  Function('require','exports',js)(()=>stubs,exports);
  const responses=[];
  const context={getRuntimeConfig:()=>({})};
  const dispatch=async(method,params={})=>{await exports.usageHandlers[method]({params,context,client:{},respond:(...args)=>responses.push(args)});return responses.at(-1);};
  return {calls,dispatch};
}
const day=new Date().toISOString().slice(0,10);
const daily=Array.from({length:3},(_,i)=>({date:new Date(Date.parse(`${day}T00:00:00Z`)-(2-i)*86400000).toISOString().slice(0,10),totalCost:1}));
const summary={daily,totals:{totalCost:3},days:30,updatedAt:1,cacheStatus:{status:'fresh'}};
test('actual usage.cost handler preserves default agent and real source projection',async()=>{
  const f=fixture({summary});const [ok,data]=await f.dispatch('usage.cost');
  assert.equal(ok,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].agentId,'sapling');assert.equal(f.calls[0].agentScope,undefined);
  assert.deepEqual(data.totals,summary.totals);assert.equal(data.forecast.daysOfData,3);
});
test('actual usage.cost handler passes explicit all-agent scope without widening default',async()=>{
  const f=fixture({summary});await f.dispatch('usage.cost',{agentScope:'all'});
  assert.equal(f.calls[0].agentScope,'all');assert.equal(f.calls[0].agentId,undefined);
});
test('actual usage.cost handler exposes optional budget countdown with no-limit default',async()=>{
  const f=fixture({summary});const [ok,data]=await f.dispatch('usage.cost',{budgetLimitUsd:10});
  assert.equal(ok,true);assert.ok(data.forecast.pctRemaining>=0);assert.ok(data.forecast.daysToLimit>=0);
  const defaults=fixture({summary});const [,absolute]=await defaults.dispatch('usage.cost');assert.equal(absolute.forecast.daysToLimit,-1);
});
test('actual usage.cost handler validates budget before reading cached data',async()=>{
  for(const budgetLimitUsd of [-1,NaN,Infinity,'10',null]){
    const f=fixture({summary});const [ok,,error]=await f.dispatch('usage.cost',{budgetLimitUsd});
    assert.equal(ok,false);assert.equal(error.code,'INVALID_REQUEST');assert.equal(f.calls.length,0);
  }
});
test('actual usage.cost handler forbids bounded role before reading cache',async()=>{
  const f=fixture({admin:false,cap:'none',summary});const [ok,,error]=await f.dispatch('usage.cost');
  assert.equal(ok,false);assert.equal(error.code,'FORBIDDEN');assert.equal(f.calls.length,0);
});
test('actual usage.cost handler rejects inconsistent all+agent request before cache',async()=>{
  const f=fixture({summary});const [ok,,error]=await f.dispatch('usage.cost',{agentScope:'all',agentId:'other'});
  assert.equal(ok,false);assert.equal(error.code,'INVALID_REQUEST');assert.equal(f.calls.length,0);
});
test('actual usage.cost handler preserves stale and historical no-forecast state',async()=>{
  const f=fixture({summary:{...summary,cacheStatus:{status:'stale'}}});const [,data]=await f.dispatch('usage.cost');assert.equal(data.forecast,null);
  const h=fixture({summary,endDate:'2020-01-01'});const [,historical]=await h.dispatch('usage.cost');assert.equal(historical.forecast,null);
});
test('actual sessions.usage handler analyzes only returned visible cohort',async()=>{
  const rows=[200,200,10000].map((totalTokens,i)=>({key:String(i),agentId:'sapling',model:'x',usage:{input:100,output:100,cacheRead:0,totalTokens,totalCost:1,missingCostEntries:0,lastActivity:i}}));
  const result={sessions:rows,totals:{totalCost:3},aggregates:{sessionCount:99},cacheStatus:{status:'fresh'}};
  const f=fixture({sessionResult:result});const [ok,data]=await f.dispatch('sessions.usage');assert.equal(ok,true);
  assert.equal(f.calls[0].agentId,'sapling');assert.equal(data.costInsights.analyzedRows,3);assert.deepEqual(data.costInsights.anomalies[0].sessionKeys,['2']);assert.equal(data.aggregates.sessionCount,99);
});
