// Fail if the engine's web-push event mapping or category list drifts from what the phone posts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHANNEL_FOR_KIND, kindEnabled } from './kinds';
import { PHONE_PREFS_DEFAULT } from '../settings/phonePrefs';
import { cronRunIdentity, isTranscriptOnly } from './fromEvent';

const repo = resolve(__dirname, '../../..');

function readEngine(rel: string): string {
  return readFileSync(resolve(repo, rel), 'utf8');
}

describe('phone alerts stay aligned with engine web-push', () => {
  const webPush = readEngine('engine/src/gateway/event-web-push.ts');
  const prefs = readEngine('engine/src/infra/push-web-preferences.ts');
  const transcript = readEngine('engine/src/shared/transcript-only-branch-assistant.ts');
  const runId = readEngine('engine/src/cron/run-id.ts');

  it('still maps the same gateway events the engine pushes', () => {
    const events = [...webPush.matchAll(/event === "([^"]+)"/g)].map((match) => match[1]);
    expect(events).toEqual(['question.requested', 'chat', 'cron']);
    expect(webPush).toMatch(/value\.state === "final"/);
    expect(webPush).toMatch(/value\.yielded !== true/);
    expect(webPush).toMatch(/isTranscriptOnlyBranchAssistantMessage\(value\.message\)/);
    expect(webPush).toMatch(/value\.action === "finished"/);
    expect(webPush).toMatch(/value\.status === "error"/);
    expect(webPush).toMatch(/normalizeOptionalString\(value\.runId\)/);
    expect(webPush).toMatch(/value\.runAtMs/);
    expect(webPush).toMatch(/createCronExecutionId\(jobId, value\.runAtMs\)/);
    expect(webPush).toMatch(/normalizeWebPushDisplayLabel\(value\.id\) \?\? "pending"/);
    expect(webPush).toMatch(/normalizeWebPushDisplayLabel\(value\.runId\) \?\? "finished"/);
  });

  it('still uses the same cron execution id and transcript-only rows', () => {
    expect(runId).toMatch(/return `cron:\$\{jobId\}:\$\{startedAt\}`/);
    expect(cronRunIdentity({ runAtMs: 42 }, 'nightly')).toBe('cron:nightly:42');
    expect(transcript).toMatch(/gateway-injected/);
    expect(transcript).toMatch(/delivery-mirror/);
    expect(transcript).toMatch(/channel-final-suppressed/);
    expect(transcript).toMatch(/cron-direct-delivery-context/);
    expect(isTranscriptOnly({ role: 'assistant', provider: 'branch', model: 'gateway-injected' })).toBe(true);
    expect(isTranscriptOnly({ role: 'assistant', branchDeliveryMirror: { kind: 'channel-final' } })).toBe(true);
  });

  it('still maps each engine web-push category onto a phone kind switch', () => {
    expect(prefs).toMatch(/"approvalRequested"/);
    expect(prefs).toMatch(/"agentFinished"/);
    expect(prefs).toMatch(/"agentQuestion"/);
    expect(prefs).toMatch(/"humanMentioned"/);
    expect(prefs).toMatch(/"scheduledTaskFailed"/);
    const keys = [...prefs.matchAll(/"((?:approvalRequested|agentFinished|agentQuestion|humanMentioned|scheduledTaskFailed))"/g)].map(
      (match) => match[1],
    );
    expect([...new Set(keys)].sort()).toEqual(
      ['agentFinished', 'agentQuestion', 'approvalRequested', 'humanMentioned', 'scheduledTaskFailed'].sort(),
    );
    expect(CHANNEL_FOR_KIND.approval).toBe('approvals');
    expect(CHANNEL_FOR_KIND.finished).toBe('replies');
    expect(CHANNEL_FOR_KIND.question).toBe('questions');
    expect(CHANNEL_FOR_KIND.mention).toBe('mentions');
    expect(CHANNEL_FOR_KIND.automation).toBe('automations');
    expect(kindEnabled(PHONE_PREFS_DEFAULT, 'approval')).toBe(true);
    expect(kindEnabled({ ...PHONE_PREFS_DEFAULT, notifKinds: [false, true, true, false, false] }, 'approval')).toBe(false);
    expect(kindEnabled({ ...PHONE_PREFS_DEFAULT, notifKinds: [true, false, true, false, false] }, 'finished')).toBe(false);
    expect(kindEnabled({ ...PHONE_PREFS_DEFAULT, notifKinds: [true, true, false, false, false] }, 'mention')).toBe(false);
    expect(kindEnabled({ ...PHONE_PREFS_DEFAULT, notifKinds: [true, true, false, false, false] }, 'question')).toBe(false);
    expect(kindEnabled({ ...PHONE_PREFS_DEFAULT, notifKinds: [true, true, false, false, false] }, 'automation')).toBe(false);
  });
});
