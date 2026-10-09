import { waitFor } from '@testing-library/react-native';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { FIXTURE_NOW, fixtureAgents } from '../testing/chatFixtures';
import { fixtureApprovals, fixtureExecApproval } from '../testing/approvalFixtures';
import { ApprovalInbox, readApproval, trunkOf } from './approvals';
import { actionWords, expiresIn, maskCommand, mixedAlphabets, notificationText, outcomeWords, shortFolder } from './approvalWords';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
const MINUTE = 60_000;

async function connected(opts: { now?: () => number; reconnectWaitMs?: number } = {}) {
  const engine = createFakeEngine({ agents: fixtureAgents, approvals: fixtureApprovals });
  const { session } = createFakeSession(engine);
  await session.restore();
  await session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  const inbox = new ApprovalInbox(session, { now: opts.now ?? (() => FIXTURE_NOW), ...(opts.reconnectWaitMs ? { reconnectWaitMs: opts.reconnectWaitMs } : {}) });
  inbox.attach();
  await eventually(() => expect(inbox.getSnapshot().loaded).toBe(true));
  return { engine, session, inbox };
}

const resolves = (engine: ReturnType<typeof createFakeEngine>) => engine.requests.filter((r) => r.method.endsWith('.approval.resolve'));

describe('approvals on the phone', () => {
  it('reads every waiting approval from the computer, with who asked and what for', async () => {
    const { session, inbox } = await connected();
    const { pending, trunks } = inbox.getSnapshot();
    expect(pending.map((a) => a.id)).toEqual(['exec-1', 'plugin:mail-1']);
    const [exec, plugin] = pending;
    expect(trunkOf(exec, trunks).name).toBe('Oak');
    expect(trunkOf(plugin, trunks)).toEqual({ name: 'Branch Agent', avatar: '🌿' });
    expect(exec).toMatchObject({ kind: 'exec', command: 'pnpm install --frozen-lockfile', cwd: '/Users/sam/Code/branch/window', sessionKey: 'agent:oak:chat-1', warnings: ['Downloads packages from the internet'] });
    expect(plugin).toMatchObject({ kind: 'plugin', title: 'Send an email to Dana?', allowedDecisions: ['allow-once', 'deny'] });
    session.dispose();
  });

  it('adds a new request live, and moves one answered on the computer to Answered', async () => {
    const { engine, session, inbox } = await connected();
    engine.requestApproval('exec', { id: 'exec-2', createdAtMs: FIXTURE_NOW, expiresAtMs: FIXTURE_NOW + 30 * MINUTE, request: { command: 'git push', agentId: 'researcher' } });
    await eventually(() => expect(inbox.getSnapshot().pending.map((a) => a.id)).toEqual(['exec-1', 'plugin:mail-1', 'exec-2']));
    engine.resolveApproval('exec-1', 'allow-once');
    await eventually(() => expect(inbox.getSnapshot().pending.map((a) => a.id)).toEqual(['plugin:mail-1', 'exec-2']));
    const [answered] = inbox.getSnapshot().answered;
    expect(answered).toMatchObject({ id: 'exec-1', outcome: 'allowed', by: 'elsewhere', always: false });
    expect(outcomeWords(answered)).toBe('Allowed somewhere else');
    session.dispose();
  });

  it('answers with the engine’s own resolve methods, and the answer is credited to this phone', async () => {
    const { engine, session, inbox } = await connected();
    await expect(inbox.answer('exec-1', 'allow-always')).resolves.toBe(true);
    await expect(inbox.answer('plugin:mail-1', 'deny')).resolves.toBe(true);
    expect(resolves(engine)).toEqual([
      { method: 'exec.approval.resolve', params: { id: 'exec-1', decision: 'allow-always' } },
      { method: 'plugin.approval.resolve', params: { id: 'plugin:mail-1', decision: 'deny' } },
    ]);
    expect(engine.pendingApprovals('exec')).toEqual([]);
    // The engine's resolved broadcast for our own answers arrives afterwards and changes nothing.
    await new Promise((r) => setTimeout(r, 20));
    const answered = inbox.getSnapshot().answered;
    expect(answered.map((a) => [a.id, a.outcome, a.by, a.always])).toEqual([
      ['plugin:mail-1', 'denied', 'phone', false],
      ['exec-1', 'allowed', 'phone', true],
    ]);
    expect(answered.map(outcomeWords)).toEqual(['Not sent on this phone', 'Always allowed on this phone']);
    expect(inbox.getSnapshot().pending).toEqual([]);
    session.dispose();
  });

  it('says plainly when someone else answered first', async () => {
    const { engine, session, inbox } = await connected();
    engine.failMethod('exec.approval.resolve', 'approval already resolved');
    await expect(inbox.answer('exec-1', 'deny')).resolves.toBe(false);
    const snapshot = inbox.getSnapshot();
    expect(snapshot.pending.map((a) => a.id)).toEqual(['plugin:mail-1']);
    expect(snapshot.failed).toEqual({});
    expect(outcomeWords(snapshot.answered[0])).toBe('Answered somewhere else');
    session.dispose();
  });

  it('keeps the card and says why when an answer doesn’t go through', async () => {
    const { engine, session, inbox } = await connected();
    engine.failMethod('exec.approval.resolve', 'gateway busy');
    await expect(inbox.answer('exec-1', 'allow-once')).resolves.toBe(false);
    const snapshot = inbox.getSnapshot();
    expect(snapshot.pending.map((a) => a.id)).toContain('exec-1');
    expect(snapshot.sending).toEqual({});
    expect(snapshot.failed['exec-1']).toBe('Your answer didn’t go through: gateway busy');
    engine.failMethod('exec.approval.resolve', null);
    await expect(inbox.answer('exec-1', 'allow-once')).resolves.toBe(true);
    expect(inbox.getSnapshot().failed).toEqual({});
    session.dispose();
  });

  it('waits for the computer to come back before sending an answer', async () => {
    const { engine, session, inbox } = await connected();
    engine.drop();
    await eventually(() => expect(session.hello).toBeNull());
    const answering = inbox.answer('exec-1', 'deny');
    expect(inbox.getSnapshot().sending).toEqual({ 'exec-1': 'deny' });
    await expect(answering).resolves.toBe(true);
    expect(resolves(engine)).toEqual([{ method: 'exec.approval.resolve', params: { id: 'exec-1', decision: 'deny' } }]);
    session.dispose();
  });

  it('gives up waiting with plain words when the computer stays away', async () => {
    const { engine, session, inbox } = await connected({ reconnectWaitMs: 30 });
    engine.refuse({ code: 'AUTH_RATE_LIMITED', message: 'slow down' });
    engine.drop();
    await eventually(() => expect(session.hello).toBeNull());
    await expect(inbox.answer('exec-1', 'deny')).resolves.toBe(false);
    expect(inbox.getSnapshot().failed['exec-1']).toBe('Your computer isn’t connected right now. Try again when it’s back.');
    session.dispose();
  });

  it('moves an approval answered while the phone was away to Answered on the next connect', async () => {
    const { engine, session, inbox } = await connected();
    engine.drop();
    await eventually(() => expect(session.hello).toBeNull());
    engine.resolveApproval('exec-1', 'deny');
    await eventually(() => expect(inbox.getSnapshot().answered.map((a) => a.id)).toEqual(['exec-1']));
    expect(inbox.getSnapshot().answered[0].outcome).toBe('gone');
    expect(inbox.getSnapshot().pending.map((a) => a.id)).toEqual(['plugin:mail-1']);
    session.dispose();
  });

  it('calls a refusal at the deadline what it is: expired', async () => {
    const { engine, session, inbox } = await connected({ now: () => FIXTURE_NOW + 31 * MINUTE });
    engine.resolveApproval('exec-1', 'deny', null);
    await eventually(() => expect(inbox.getSnapshot().answered[0]?.outcome).toBe('expired'));
    expect(outcomeWords(inbox.getSnapshot().answered[0])).toBe('Expired · not allowed');
    session.dispose();
  });
});

describe('approval words', () => {
  const exec = readApproval(fixtureExecApproval, 'exec')!;

  it('says Send it for a request that sends, Allow otherwise', () => {
    expect(actionWords({ kind: 'plugin', title: 'Send an email to Dana?' })).toMatchObject({ yes: 'Send it', no: 'Don’t send' });
    expect(actionWords({ kind: 'plugin', title: 'Delete 3 files?' })).toMatchObject({ yes: 'Allow', no: 'Deny' });
    expect(actionWords(exec)).toMatchObject({ yes: 'Allow', no: 'Deny' });
  });

  it('dots out secrets and calls out letters from two alphabets', () => {
    expect(maskCommand('curl -H "Authorization: Bearer sk-123" https://x?token=abc&b=1')).toBe('curl -H "Authorization: Bearer ••••••••" https://x?token=••••••••&b=1');
    expect(mixedAlphabets('curl https://p\u0430ypal.com')).toBe(true);
    expect(mixedAlphabets('curl https://paypal.com')).toBe(false);
  });

  it('shortens the home folder and counts down the time left', () => {
    expect(shortFolder('/Users/sam/Code/branch')).toBe('~/Code/branch');
    expect(shortFolder('C:\\Users\\sam\\Code')).toBe('~\\Code');
    expect(expiresIn(FIXTURE_NOW + 4 * MINUTE + 12_000, FIXTURE_NOW)).toBe('Expires in 4:12');
    expect(expiresIn(FIXTURE_NOW + 27 * MINUTE, FIXTURE_NOW)).toBe('Expires in 27 min');
    expect(expiresIn(FIXTURE_NOW - 1, FIXTURE_NOW)).toBeNull();
  });

  it('writes a notification short enough for a lock screen', () => {
    expect(notificationText(exec, 'Oak')).toEqual({ title: 'Oak needs a yes', body: 'Run: pnpm install --frozen-lockfile' });
    const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;
    expect(notificationText(plugin, 'Branch Agent')).toEqual({ title: 'Branch Agent needs a yes', body: 'Send an email to Dana?\nTo: Dana Whitfield · Subject: September expenses' });
    const long = readApproval({ id: 'x', request: { command: 'echo ' + 'a'.repeat(300) } }, 'exec')!;
    expect(notificationText(long, 'Oak').body.length).toBeLessThanOrEqual(180);
  });
});
