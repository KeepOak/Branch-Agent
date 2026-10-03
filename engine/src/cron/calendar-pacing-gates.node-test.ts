import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_DATE_TIMESTAMP_MS } from '@branch/normalization-core/number-coercion';
import { computeNextRunAtMs, computePreviousRunAtMs } from './schedule.js';
import { parseAbsoluteTimeMs } from './parse.js';
import { validateScheduleTimestamp } from './validate-timestamp.js';
import { parseCronPacingBounds, resolvePacedNextRunAtMs } from './pacing.js';
import { cronSchedulingInputsEqual, tryCronScheduleIdentity } from './schedule-identity.js';
import { isWithinActiveHours } from '../infra/heartbeat-active-hours.js';
import { shouldDeferWake, recordRunStart } from '../infra/heartbeat-cooldown.js';
import { resolveHeartbeatVisibility } from '../infra/heartbeat-visibility.js';
import type { BranchConfig } from '../config/types.branch.js';
const ms = (iso: string) => Date.parse(iso);
// Cases harvested from pinned OpenClaw schedule.test.ts (native tests, real Croner).
for (const [label, tz, expr, now, next, previous] of [
  ['New York fold keeps later reminder', 'America/New_York', '30 1,3 * * *', '2026-11-01T06:15:00Z', '2026-11-01T08:30:00Z', '2026-11-01T05:30:00Z'],
  ['New York fold skips duplicate minutes', 'America/New_York', '* * * * *', '2026-11-01T06:15:00Z', '2026-11-01T07:00:00Z', '2026-11-01T05:59:00Z'],
  ['Oslo fold keeps later reminder', 'Europe/Oslo', '30 2,4 * * *', '2026-10-25T01:15:00Z', '2026-10-25T03:30:00Z', '2026-10-25T00:30:00Z'],
  ['Lord Howe half-hour fold', 'Australia/Lord_Howe', '45 1,2 * * *', '2026-04-04T15:10:00Z', '2026-04-04T16:15:00Z', '2026-04-04T14:45:00Z'],
  ['New York missing spring hour', 'America/New_York', '30 2 * * *', '2027-03-14T06:45:00Z', '2027-03-15T06:30:00Z', '2027-03-13T07:30:00Z'],
] as const) test(label, () => {
  const schedule = { kind: 'cron', expr, tz } as const;
  assert.equal(computeNextRunAtMs(schedule, ms(now)), ms(next));
  assert.equal(computePreviousRunAtMs(schedule, ms(now)), ms(previous));
});
test('Asia Shanghai timezone advances the local calendar year correctly', () => {
  assert.equal(computeNextRunAtMs({ kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai' }, ms('2026-03-01T00:00:00Z')), ms('2026-03-02T00:00:00Z'));
});
test('absolute and every scheduling preserve boundary and anchor semantics', () => {
  assert.equal(parseAbsoluteTimeMs('2024-01-15T10:30:00'), ms('2024-01-15T10:30:00Z'));
  assert.equal(parseAbsoluteTimeMs('1700000000000'), 1700000000000);
  assert.equal(parseAbsoluteTimeMs(String(Number.MAX_SAFE_INTEGER)), null);
  assert.equal(computeNextRunAtMs({ kind: 'every', everyMs: 60000, anchorMs: 100000 }, 90000), 100000);
  assert.equal(computeNextRunAtMs({ kind: 'every', everyMs: 60000, anchorMs: 100000 }, 100000), 160000);
  assert.equal(computeNextRunAtMs({ kind: 'at', at: '2026-01-01T00:00:00Z' }, ms('2026-01-01T00:00:00Z')), undefined);
});
test('one-shot validation retains source grace and far-future cap', () => {
  const now=ms('2026-01-01T00:00:00Z');
  assert.equal(validateScheduleTimestamp({ kind: 'at', at: new Date(now-60000).toISOString() }, now).ok, true);
  assert.equal(validateScheduleTimestamp({ kind: 'at', at: new Date(now-60001).toISOString() }, now).ok, false);
  assert.equal(validateScheduleTimestamp({ kind: 'at', at: '2037-01-01T00:00:00Z' }, now).ok, false);
});
test('pacing parses composite units and rejects empty, zero and reversed bounds', () => {
  assert.deepEqual(parseCronPacingBounds({ min: '1h30m', max: '4h' }), { minMs: 5400000, maxMs: 14400000 });
  for (const pacing of [{}, { min: '0' }, { max: 'bogus' }, { min: '2h', max: '1h' }]) assert.throws(() => parseCronPacingBounds(pacing), /cron pacing/);
});
test('pacing clamps actual next-run proposals without changing job bounds', () => {
  const now=ms('2026-07-18T12:00:00Z');
  const pacing={ min:'15m', max:'4h' };
  for (const [delay, expected] of [[0, 900000], [1800000, 1800000], [86400000, 14400000]]) assert.equal(resolvePacedNextRunAtMs({ nowMs: now, delayMs: delay!, pacing }), now+expected!);
  assert.equal(resolvePacedNextRunAtMs({ nowMs: MAX_DATE_TIMESTAMP_MS-1000, delayMs: 60000, pacing }), undefined);
});
test('pacing participates in authoritative schedule identities using normalized durations', () => {
  const base={ schedule:{kind:'every',everyMs:60000},enabled:true,pacing:{min:'60m'} };
  assert.equal(cronSchedulingInputsEqual(base,{...base,pacing:{min:'1h'}}),true);
  assert.equal(cronSchedulingInputsEqual(base,{...base,pacing:{min:'2h'}}),false);
  assert.equal(tryCronScheduleIdentity({...base,pacing:{min:'bad'}}),undefined);
});
const cfg: BranchConfig={ agents:{ defaults:{ userTimezone:'UTC' } } };
const window=(start:string,end:string,timezone='UTC')=>({activeHours:{start,end,timezone}});
test('active windows include start, exclude end and handle midnight24:00',()=>{
  assert.equal(isWithinActiveHours(cfg,window('08:00','24:00','user'),ms('2026-01-01T07:59:00Z')),false);
  assert.equal(isWithinActiveHours(cfg,window('08:00','24:00','user'),ms('2026-01-01T08:00:00Z')),true);
  assert.equal(isWithinActiveHours(cfg,window('08:00','24:00','user'),ms('2026-01-01T23:59:00Z')),true);
});
test('overnight and zero-width windows preserve source admission policy',()=>{
  assert.equal(isWithinActiveHours(cfg,window('22:00','06:00'),ms('2026-01-01T05:59:00Z')),true);
  assert.equal(isWithinActiveHours(cfg,window('22:00','06:00'),ms('2026-01-01T06:00:00Z')),false);
  assert.equal(isWithinActiveHours(cfg,window('08:00','08:00'),ms('2026-01-01T08:00:00Z')),false);
});
test('malformed active-hours configuration retains upstream permissive fallback',()=>{
  assert.equal(isWithinActiveHours(cfg,undefined,0),true);
  assert.equal(isWithinActiveHours(cfg,window('bad','10:00'),0),true);
  assert.equal(isWithinActiveHours(cfg,window('08:00','24:30'),0),true);
  assert.equal(isWithinActiveHours(cfg,window('08:00','10:00','Bad/Zone'),ms('2026-01-01T09:00:00Z')),true);
});
test('local clock gate follows DST through the configured IANA timezone',()=>{
  assert.equal(isWithinActiveHours(cfg,window('08:00','09:00','America/New_York'),ms('2026-03-08T12:00:00Z')),true);
  assert.equal(isWithinActiveHours(cfg,window('08:00','09:00','America/New_York'),ms('2026-03-07T12:00:00Z')),false);
});
test('manual wake exemption and default flood cooldown retain precise retry time',()=>{
  const recent=[1000,2000,3000,4000,5000];
  assert.deepEqual(shouldDeferWake({intent:'manual',now:6000,nextDueMs:90000,recentRunStarts:recent}),{defer:false});
  assert.deepEqual(shouldDeferWake({intent:'immediate',now:6000,nextDueMs:90000,recentRunStarts:recent}),{defer:true,reason:'flood',retryAtMs:61001});
});
test('task min spacing and bounded run history preserve source defaults',()=>{
  assert.deepEqual(shouldDeferWake({intent:'task',now:10000,nextDueMs:90000,lastRunStartedAtMs:5000}),{defer:true,reason:'min-spacing',retryAtMs:35000});
  const buffer:number[]=[];
  for(let i=0;i<20;i++) recordRunStart(buffer,i);
  assert.deepEqual(buffer,[14,15,16,17,18,19]);
});
test('presentation precedence stays account over channel over defaults',()=>{
  const visibilityCfg={channels:{defaults:{heartbeatVisibility:{showOk:true,useIndicator:false}},telegram:{heartbeatVisibility:{showOk:false},accounts:{work:{heartbeatVisibility:{showAlerts:false}}}}}} as BranchConfig;
  assert.deepEqual(resolveHeartbeatVisibility({cfg:visibilityCfg,channel:'telegram',accountId:'work'}),{showOk:false,showAlerts:false,useIndicator:false});
  assert.deepEqual(resolveHeartbeatVisibility({cfg:visibilityCfg,channel:'webchat'}),{showOk:true,showAlerts:true,useIndicator:false});
});
