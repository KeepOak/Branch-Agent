import assert from 'node:assert/strict';
import test from 'node:test';
import { autoDisableCronJob, maybeAutoDisableCronJobAfterRunFailure } from './auto-disable.js';
import type { CronJob, CronFailureNotificationDetail } from '../types.js';
import type { DeferredCronNotifications } from './state.js';

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'closed-detail', name: 'Routine', enabled: true,
    createdAtMs: 1, updatedAtMs: 1, schedule: { kind: 'every', everyMs: 60_000 },
    sessionTarget: 'isolated', wakeMode: 'now', payload: { kind: 'agentTurn', message: 'Run' },
    state: { consecutiveErrors: 10, nextRunAtMs: 100_000 }, ...overrides,
  };
}
for (const [detail, cause] of [
  [{ kind: 'command-exit', exitCode: 7 }, 'Cause: command exited with code 7'],
  [{ kind: 'command-timeout', mode: 'wall-clock' }, 'Cause: command timed out'],
  [{ kind: 'command-timeout', mode: 'no-output' }, 'Cause: command stopped after producing no output'],
  [{ kind: 'script-failure', source: 'payload', code: 'output_limit_exceeded' }, 'Cause: automation script exceeded its output limit'],
  [{ kind: 'script-failure', source: 'trigger', code: 'plugin_reload_failed' }, 'The trigger script did not run. Automatic setup recovery failed.'],
] as const satisfies readonly (readonly [CronFailureNotificationDetail, string])[]) {
  test(`tenth failure notification retains ${JSON.stringify(detail)}`, () => {
    const target = job();
    const notifications: DeferredCronNotifications = [];
    assert.equal(maybeAutoDisableCronJobAfterRunFailure({ job: target, atMs: 50_000, deferredNotifications: notifications, failureNotificationDetail: detail }), true);
    assert.equal(target.enabled, false);
    assert.equal(target.state.nextRunAtMs, undefined);
    assert.deepEqual(target.state.autoDisabled, { reason: 'consecutive-failures', atMs: 50_000, consecutiveErrors: 10 });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.kind, 'auto-disabled');
    assert.ok(notifications[0] && 'text' in notifications[0] && notifications[0].text.includes(cause));
    assert.equal('failureNotificationDetail' in target.state, false);
  });
}
test('classified cause still takes priority over transient producer detail', () => {
  const target = job({ state: { consecutiveErrors: 10, lastErrorReason: 'model_not_found' } });
  const notifications: DeferredCronNotifications = [];
  maybeAutoDisableCronJobAfterRunFailure({ job: target, atMs: 1, deferredNotifications: notifications, failureNotificationDetail: { kind: 'command-exit', exitCode: 7 } });
  const notification = notifications[0];
  assert.ok(notification && 'text' in notification);
  assert.match(notification.text, /Cause: model_not_found/);
  assert.doesNotMatch(notification.text, /exited with code/);
});
test('threshold, one-shots, monitors and existing disabled state retain source exclusions', () => {
  for (const target of [job({ state: { consecutiveErrors: 9 } }), job({ schedule: { kind: 'at', at: '2026-10-03T00:00:00Z' } }), job({ declarationKey: 'heartbeat:agent' }), job({ declarationKey: 'skill-collection-review:agent' }), job({ enabled: false }), job({ state: { consecutiveErrors: 10, autoDisabled: { reason: 'consecutive-failures', atMs: 0, consecutiveErrors: 10 } } })]) {
    const notifications: DeferredCronNotifications = [];
    assert.equal(maybeAutoDisableCronJobAfterRunFailure({ job: target, atMs: 1, deferredNotifications: notifications, failureNotificationDetail: { kind: 'command-exit', exitCode: 7 } }), false);
    assert.deepEqual(notifications, []);
  }
});
test('schedule-error disables cannot inherit a run cause', () => {
  const notifications: DeferredCronNotifications = [];
  autoDisableCronJob({ job: job(), atMs: 1, reason: 'schedule-errors', consecutiveErrors: 3, deferredNotifications: notifications, failureNotificationDetail: { kind: 'command-exit', exitCode: 7 } });
  const notification = notifications[0];
  assert.ok(notification && 'text' in notification);
  assert.match(notification.text, /Check automation history for details/);
  assert.doesNotMatch(notification.text, /exited with code/);
});
test('missing detail preserves generic restart recovery notification', () => {
  const notifications: DeferredCronNotifications = [];
  assert.equal(maybeAutoDisableCronJobAfterRunFailure({ job: job(), atMs: 1, deferredNotifications: notifications }), true);
  const notification = notifications[0];
  assert.ok(notification && 'text' in notification);
  assert.match(notification.text, /Check automation history for details/);
});
