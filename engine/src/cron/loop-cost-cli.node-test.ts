import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Command } from 'commander';
import { registerCronEstimateCommand } from '../cli/cron-cli/register.cron-estimate.js';
import { isCommandJsonOutputMode } from '../cli/program/json-mode.js';
async function execute(args:string[]) {
  const output:string[]=[];
  const parent=new Command('cron').exitOverride();
  const command=registerCronEstimateCommand(parent,{log:(value:unknown)=>output.push(String(value))});
  await parent.parseAsync(['estimate',...args],{from:'user'});
  return {output,command};
}
async function json(args:string[]=[]) {
  const {output}=await execute([...args,'--json']);
  assert.equal(output.length,1);
  return JSON.parse(output[0]!);
}
test('actual Commander consumer preserves pinned daily-triage L1 single defaults',async()=>{
  const result=await json();
  assert.equal(result.patternId,'daily-triage');
  assert.equal(result.level,'L1');
  assert.equal(result.orchestration.mode,'single');
  assert.equal(result.cadence,'1d-2h');
  assert.equal(result.runsPerDay,12);
  assert.match(result.source,/10a5f859a16a69d3ee4942b8b7b8b3af781c08e2/);
  assert.match(result.basis,/no measured usage or model pricing/);
});
test('conservative option keeps slower source cadence without enabling a job',async()=>{
  const result=await json(['--conservative']);
  assert.equal(result.runsPerDay,1);
});
test('actual CLI source orchestration multiplies only action scenario',async()=>{
  const args=['--pattern','ci-sweeper','--cadence','15m','--level','L2'];
  const base=await json(args);
  const parallel=await json([...args,'--orchestration','parallel:3']);
  assert.equal(parallel.scenarios.action.tokensPerRun,base.scenarios.action.tokensPerRun*4);
  assert.equal(parallel.scenarios.noop.tokensPerRun,base.scenarios.noop.tokensPerRun);
  assert.equal(parallel.scenarios.report.tokensPerRun,base.scenarios.report.tokensPerRun);
});
test('cache scenario remains explicitly optional and identifies its source weighting',async()=>{
  const plain=await json();
  const cached=await json(['--with-caching']);
  assert.equal(plain.scenarios.caching,undefined);
  assert.ok(cached.scenarios.caching.savingsPercent>0);
  assert.match(cached.basis,/0\.1 cost weighting/);
});
test('list exposes exact eight source registry identities in valid JSON',async()=>{
  const rows=await json(['--list']);
  assert.deepEqual(rows.map((p:{id:string})=>p.id),['pr-babysitter','daily-triage','ci-sweeper','post-merge-cleanup','dependency-sweeper','changelog-drafter','issue-triage','thin-loop']);
});
test('invalid source pattern, level and cadence fail without success output',async()=>{
  for(const args of [['--pattern','missing'],['--level','unknown'],['--cadence','0m'],['--orchestration','parallel:1'],['--orchestration','debate:0']]) await assert.rejects(()=>execute(args));
});
test('non-finite cadence or fanout cannot serialize misleading null estimates',async()=>{
  const overflowing='9'.repeat(400);
  for(const args of [['--cadence',overflowing+'m'],['--orchestration','parallel:'+overflowing],['--orchestration','debate:'+overflowing]]) await assert.rejects(()=>execute(args),/finite/);
});
test('human output and command JSON metadata use existing CLI channels truthfully',async()=>{
  const human=await execute([]);
  assert.match(human.output[0]!,/heuristic token scenarios, not metered usage or model pricing/);
  const machine=await execute(['--json']);
  assert.equal(isCommandJsonOutputMode(machine.command,['node','branch','cron','estimate','--json']),true);
});
