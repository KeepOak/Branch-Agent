import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeCronSchedule, describeIntervalMs, describeOnceAt, describeScheduleForDisplay } from './schedule-humanize.js';
import { computeNextRunAtMs } from './schedule.js';

test('upstream minute cadence agrees with actual scheduler gaps', () => {
  for (const n of [1, 5, 15, 30, 7, 25, 45, 59, 60]) {
    const expr = `*/${n} * * * *`;
    let cursor = Date.parse('2026-01-01T23:00:00Z');
    let uniform = true;
    for (let i = 0; i < 12; i++) {
      const next = computeNextRunAtMs({ kind: 'cron', expr, tz: 'UTC' }, cursor);
      if (typeof next !== 'number') throw new Error('no next schedule occurrence');
      uniform &&= (next - cursor) / 60_000 === n;
      cursor = next;
    }
    assert.equal(describeCronSchedule(expr), uniform ? (n === 1 ? 'every minute' : `every ${n} minutes`) : null);
  }
});
test('Branch rejects oversized steps while phrasing stays unknown', () => {
  assert.throws(() => computeNextRunAtMs({ kind: 'cron', expr: '*/90 * * * *', tz: 'UTC' }, Date.parse('2026-01-01T23:00:00Z')), /steps cannot be greater/);
  assert.equal(describeCronSchedule('*/90 * * * *'), null);
});
test('common calendars preserve daily, weekly and monthly wall-clock phrases', () => {
  for (const [expr, phrase] of [
    ['0 * * * *', 'every hour'], ['0 8 * * *', 'every morning at 8am'],
    ['30 15 * * *', 'every afternoon at 3:30pm'], ['0 19 * * *', 'every evening at 7pm'],
    ['0 0 * * *', 'every day at 12am'], ['0 9 * * 1-5', 'every weekday at 9am'],
    ['0 9 * * 0,6', 'every weekend at 9am'], ['0 9 * * 7', 'every Sunday at 9am'],
    ['0 9 11 * *', 'on the 11th of every month at 9am'], ['0 9 22 * *', 'on the 22nd of every month at 9am'],
  ] as const) assert.equal(describeCronSchedule(expr), phrase);
});
test('complex or invalid calendars do not claim a single fire time', () => {
  for (const expr of ['', '0 8,9 * * *', '0 8-10 * * *', '0 25 * * *', '60 8 * * *', '0 8 * JAN *', '0 8 0 * *', '0 8 32 * *', '0 0 8 * * *', '@daily']) assert.equal(describeCronSchedule(expr), null, expr);
});
test('whole intervals render in words and corrupt durations stay unknown', () => {
  for (const [ms, phrase] of [[86400000, 'every day'], [7200000, 'every 2 hours'], [5400000, 'every 90 minutes'], [1000, 'every second'], [1501, 'every 2 seconds']] as const) assert.equal(describeIntervalMs(ms), phrase);
  for (const ms of [0, -1, NaN, Infinity, -Infinity]) assert.equal(describeIntervalMs(ms), null);
});
test('one-shot countdown and daylight-saving calendar use supplied timezone', () => {
  const now = Date.parse('2026-03-07T17:00:00Z');
  assert.equal(describeOnceAt('2026-03-07T17:00:30Z', now, 'America/New_York'), 'in under a minute');
  assert.equal(describeOnceAt('2026-03-07T17:20:00Z', now, 'America/New_York'), 'in 20 minutes');
  assert.equal(describeOnceAt('2026-03-08T12:00:00Z', now, 'America/New_York'), 'tomorrow at 8am');
  assert.equal(describeOnceAt('2026-03-08T12:00:00Z', now, 'UTC'), 'tomorrow at 12pm');
  assert.equal(describeOnceAt('invalid', now, 'UTC'), null);
});
test('Branch bridge respects explicit cron zone and handles unknown schedules', () => {
  assert.equal(describeScheduleForDisplay({ kind: 'cron', expr: '0 8 * * *', tz: 'America/New_York' }, { timeZone: 'UTC' }), 'every morning at 8am (America/New_York)');
  assert.equal(describeScheduleForDisplay({ kind: 'cron', expr: '*/45 * * * *', tz: 'UTC' }), null);
  assert.equal(describeScheduleForDisplay({ kind: 'every', everyMs: 90000 }), 'every 90 seconds');
  assert.equal(describeScheduleForDisplay({ kind: 'at', at: '2026-03-08T12:00:00Z' }, { nowMs: Date.parse('2026-03-07T17:00:00Z'), timeZone: 'America/New_York' }), 'tomorrow at 8am (America/New_York)');
  assert.equal(describeScheduleForDisplay({ kind: 'at', at: '2026-03-08T12:00:00Z' }, { timeZone: 'Invalid/Zone' }), null);
  assert.equal(describeScheduleForDisplay(undefined), null);
});
