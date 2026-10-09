import { waitFor } from '@testing-library/react-native';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { FIXTURE_NOW, fixtureAgents } from '../testing/chatFixtures';
import { fixtureApprovals, fixtureExecApproval } from '../testing/approvalFixtures';
import { ANSWER_FAILED_MESSAGE, ApprovalInbox, LIST_FAILED_MESSAGE, readApproval, trunkOf } from './approvals';
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
    // The engine broadcast each resolution to this phone before replying to it, naming the phone as the resolver.
    const heard = engine.delivered.filter((d) => d.event.endsWith('.approval.resolved'));
    expect(heard.map((d) => (d.payload as { id: string }).id)).toEqual(['exec-1', 'plugin:mail-1']);
    const phone = engine.connects[engine.connects.length - 1].client;
    expect(heard.map((d) => (d.payload as { resolvedBy: unknown }).resolvedBy)).toEqual([phone.displayName ?? phone.id, phone.displayName ?? phone.id]);
    const answered = inbox.getSnapshot().answered;
    expect(answered.map((a) => [a.id, a.outcome, a.by, a.always])).toEqual([
      ['plugin:mail-1', 'denied', 'phone', false],
      ['exec-1', 'allowed', 'phone', true],
    ]);
    expect(answered.map(outcomeWords)).toEqual(['Not sent on this phone', 'Always allowed on this phone']);
    expect(inbox.getSnapshot().pending).toEqual([]);
    session.dispose();
  });

  it('says what the other surface decided when it answered first', async () => {
    const { engine, session, inbox } = await connected();
    // The window allows it a moment before the phone's Deny reaches the engine.
    engine.resolveApproval('exec-1', 'allow-once');
    await expect(inbox.answer('exec-1', 'deny')).resolves.toBe(false);
    const snapshot = inbox.getSnapshot();
    expect(resolves(engine)).toEqual([{ method: 'exec.approval.resolve', params: { id: 'exec-1', decision: 'deny' } }]);
    expect(snapshot.pending.map((a) => a.id)).toEqual(['plugin:mail-1']);
    expect(snapshot.failed).toEqual({});
    expect(snapshot.answered[0]).toMatchObject({ id: 'exec-1', outcome: 'allowed', by: 'elsewhere' });
    expect(outcomeWords(snapshot.answered[0])).toBe('Allowed somewhere else');
    session.dispose();
  });

  it('knows an approval isn’t waiting any more from the engine’s reason, not its words', async () => {
    const { engine, session, inbox } = await connected();
    engine.failMethod('exec.approval.resolve', 'that one is gone', { reason: 'APPROVAL_NOT_FOUND' });
    await expect(inbox.answer('exec-1', 'deny')).resolves.toBe(false);
    expect(inbox.getSnapshot().failed).toEqual({});
    expect(outcomeWords(inbox.getSnapshot().answered[0])).toBe('Answered somewhere else');
    // The same words without the engine's reason are just a failed answer, and the card stays.
    engine.failMethod('plugin.approval.resolve', 'approval expired or not found', undefined, 'INVALID_REQUEST');
    await expect(inbox.answer('plugin:mail-1', 'deny')).resolves.toBe(false);
    expect(inbox.getSnapshot().pending.map((a) => a.id)).toEqual(['plugin:mail-1']);
    expect(inbox.getSnapshot().failed['plugin:mail-1']).toBe(ANSWER_FAILED_MESSAGE);
    session.dispose();
  });

  it('hears approvals only on a connection the engine gave operator.approvals', async () => {
    const { engine, session, inbox } = await connected();
    // A second client paired without the approvals scope, like a read-only dashboard.
    const frames: Array<{ type: string; event?: string; id?: string; ok?: boolean; error?: { details?: unknown } }> = [];
    const other = engine.createSocket('ws://computer.local:19031', {
      open: () => undefined,
      message: (data) => frames.push(JSON.parse(data)),
      close: () => undefined,
      error: () => undefined,
    });
    await eventually(() => expect(frames.some((f) => f.event === 'connect.challenge')).toBe(true));
    const client = { id: 'webchat-ui', version: '1', platform: 'web', mode: 'webchat' };
    other.send(JSON.stringify({ type: 'req', id: 'c1', method: 'connect', params: { minProtocol: 4, maxProtocol: 4, client, role: 'operator', scopes: ['operator.read'], auth: { deviceToken: 'device-token-1' } } }));
    await eventually(() => expect(frames.some((f) => f.id === 'c1' && f.ok)).toBe(true));
    other.send(JSON.stringify({ type: 'req', id: 'l1', method: 'exec.approval.list', params: {} }));
    await eventually(() => expect(frames.find((f) => f.id === 'l1')).toMatchObject({ ok: false, error: { details: { code: 'MISSING_SCOPE' } } }));
    engine.requestApproval('exec', { id: 'exec-2', createdAtMs: FIXTURE_NOW, expiresAtMs: FIXTURE_NOW + 30 * MINUTE, request: { command: 'git push', agentId: 'oak' } });
    await eventually(() => expect(inbox.getSnapshot().pending.map((a) => a.id)).toContain('exec-2'));
    expect(frames.filter((f) => f.event?.includes('.approval.'))).toEqual([]);
    other.close();
    session.dispose();
  });

  it('keeps what it heard while a read of the list was on its way', async () => {
    const { engine, session, inbox } = await connected();
    // The engine answers a read with the list as it stood when the read arrived.
    const release = engine.hold('exec.approval.list');
    const reading = inbox.refresh();
    await eventually(() => expect(engine.requests.filter((r) => r.method === 'exec.approval.list')).toHaveLength(2));
    engine.requestApproval('exec', { id: 'exec-2', createdAtMs: FIXTURE_NOW, expiresAtMs: FIXTURE_NOW + 30 * MINUTE, request: { command: 'git push', agentId: 'oak' } });
    engine.resolveApproval('exec-1', 'allow-once');
    await eventually(() => expect(inbox.getSnapshot().answered.map((a) => a.id)).toEqual(['exec-1']));
    release();
    await reading;
    const snapshot = inbox.getSnapshot();
    expect(snapshot.pending.map((a) => a.id)).toEqual(['plugin:mail-1', 'exec-2']);
    expect(snapshot.answered.map((a) => [a.id, a.outcome, a.by])).toEqual([['exec-1', 'allowed', 'elsewhere']]);
    session.dispose();
  });

  it('keeps the card and says why when an answer doesn’t go through', async () => {
    const { engine, session, inbox } = await connected();
    engine.failMethod('exec.approval.resolve', 'gateway busy');
    await expect(inbox.answer('exec-1', 'allow-once')).resolves.toBe(false);
    const snapshot = inbox.getSnapshot();
    expect(snapshot.pending.map((a) => a.id)).toContain('exec-1');
    expect(snapshot.sending).toEqual({});
    expect(snapshot.failed['exec-1']).toBe('Your computer couldn’t take the answer just now. Try again in a moment.');
    engine.failMethod('exec.approval.resolve', null);
    await expect(inbox.answer('exec-1', 'allow-once')).resolves.toBe(true);
    expect(inbox.getSnapshot().failed).toEqual({});
    session.dispose();
  });

  it('never shows the engine’s own words when it refuses an answer', async () => {
    const { engine, session, inbox } = await connected();
    // The engine's refusals (approval-shared.ts, error-codes.ts), each with the plain words the card says instead.
    const refusals: Array<[string, unknown, string | undefined, string]> = [
      ['missing scope: operator.approvals', { code: 'MISSING_SCOPE', missingScope: 'operator.approvals' }, 'FORBIDDEN', 'This phone isn’t allowed to answer approvals any more. Answer this one on your computer, or pair this phone again.'],
      ['invalid decision', undefined, 'INVALID_REQUEST', ANSWER_FAILED_MESSAGE],
      ['approval resolver authority is no longer active', undefined, 'INVALID_REQUEST', ANSWER_FAILED_MESSAGE],
      ['approval storage unavailable', undefined, 'UNAVAILABLE', 'Your computer couldn’t take the answer just now. Try again in a moment.'],
      ['something a later engine says', { code: 'SOMETHING_NEW' }, 'SOMETHING_NEW', ANSWER_FAILED_MESSAGE],
    ];
    for (const [message, details, code, words] of refusals) {
      engine.failMethod('exec.approval.resolve', message, details, code);
      await expect(inbox.answer('exec-1', 'allow-once')).resolves.toBe(false);
      expect(inbox.getSnapshot().failed['exec-1']).toBe(words);
      expect(inbox.getSnapshot().failed['exec-1']).not.toContain(message);
    }
    expect(inbox.getSnapshot().pending.map((a) => a.id)).toContain('exec-1');
    session.dispose();
  });

  it('treats the engine’s APPROVAL_NOT_FOUND code as already settled, not as a failed answer', async () => {
    const { engine, session, inbox } = await connected();
    engine.failMethod('exec.approval.resolve', 'unknown or expired approval id', undefined, 'APPROVAL_NOT_FOUND');
    await expect(inbox.answer('exec-1', 'allow-once')).resolves.toBe(false);
    const snapshot = inbox.getSnapshot();
    expect(snapshot.failed).toEqual({});
    expect(snapshot.answered.map((a) => [a.id, a.by])).toEqual([['exec-1', 'elsewhere']]);
    session.dispose();
  });

  it('says in plain words why the list couldn’t be read', async () => {
    const { engine, session, inbox } = await connected();
    engine.failMethod('exec.approval.list', 'approval storage unavailable');
    await inbox.refresh();
    expect(inbox.getSnapshot().error).toBe('Your computer is busy right now. Try again in a moment.');
    engine.failMethod('exec.approval.list', 'missing scope: operator.approvals', { code: 'MISSING_SCOPE', missingScope: 'operator.approvals' }, 'FORBIDDEN');
    await inbox.refresh();
    expect(inbox.getSnapshot().error).toBe('This phone isn’t allowed to see approvals any more. Pair it again from Branch on your computer.');
    engine.failMethod('exec.approval.list', 'invalid exec.approval.list params', undefined, 'INVALID_REQUEST');
    await inbox.refresh();
    expect(inbox.getSnapshot().error).toBe(LIST_FAILED_MESSAGE);
    engine.failMethod('exec.approval.list', null);
    await inbox.refresh();
    expect(inbox.getSnapshot().error).toBeNull();
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
