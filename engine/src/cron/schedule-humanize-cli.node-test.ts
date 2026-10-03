import assert from 'node:assert/strict';
import { test } from 'node:test';
import { printCronShow } from '../cli/cron-cli/shared.js';
import type { CronJob } from './types.js';
import type { RuntimeEnv } from '../runtime.js';
function show(schedule: CronJob['schedule']) {
  const lines: string[] = [];
  const runtime: RuntimeEnv = { log: (...args) => lines.push(args.join(' ')), error: () => {}, exit: () => {} };
  const job = { id: 'pure-display-proof', name: 'Calendar', enabled: false, schedule, payload: { kind: 'systemEvent', text: 'unused' }, state: {} } as CronJob;
  printCronShow(job, runtime);
  return lines;
}
test('real CLI detail adds base schedule phrase and retains exact source metadata', () => {
  const lines = show({ kind: 'cron', expr: '0 8 * * 1-5', tz: 'America/New_York', staggerMs: 0 });
  assert.ok(lines.includes('schedule description: every weekday at 8am (America/New_York)'));
  assert.ok(lines.includes('schedule: cron 0 8 * * 1-5 @ America/New_York (exact)'));
});
test('real CLI detail leaves uneven cadence in exact machine form', () => {
  const lines = show({ kind: 'cron', expr: '*/45 * * * *', tz: 'UTC', staggerMs: 0 });
  assert.ok(lines.includes('schedule: cron */45 * * * * @ UTC (exact)'));
  assert.ok(!lines.some((line) => line.startsWith('schedule description:')));
});
