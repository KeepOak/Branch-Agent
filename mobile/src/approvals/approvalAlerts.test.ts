import { waitFor } from '@testing-library/react-native';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { FIXTURE_NOW, fixtureAgents } from '../testing/chatFixtures';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { ApprovalAlerts } from './approvalAlerts';
import { ApprovalInbox } from './approvals';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
const MINUTE = 60_000;
const later = { id: 'exec-2', createdAtMs: FIXTURE_NOW, expiresAtMs: FIXTURE_NOW + 30 * MINUTE, request: { command: 'rm -rf build && pnpm build', agentId: 'oak', cwd: '/Users/sam/Code/branch' } };
const email = { id: 'plugin:mail-2', createdAtMs: FIXTURE_NOW, expiresAtMs: FIXTURE_NOW + 5 * MINUTE, request: { title: 'Send a reply to Sam?', description: 'To: Sam\nThanks, see you Monday.', agentId: 'main' } };

async function setup(appState = 'background') {
  const engine = createFakeEngine({ agents: fixtureAgents, approvals: fixtureApprovals });
  const { session } = createFakeSession(engine);
  await session.restore();
  await session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  const inbox = new ApprovalInbox(session, { now: () => FIXTURE_NOW });
  inbox.attach();
  await eventually(() => expect(inbox.getSnapshot().loaded).toBe(true));
  const fake = createFakeNotifier();
  const state = createFakeAppState(appState);
  const opened: string[] = [];
  const alerts = new ApprovalAlerts(inbox, fake.notifier, state.source, (id) => opened.push(id));
  alerts.attach();
  const done = () => {
    alerts.dispose();
    inbox.dispose();
    session.dispose();
  };
  return { engine, inbox, fake, state, opened, done };
}

describe('approval notifications', () => {
  it('while Branch is in the background, a new request posts one notification with real buttons', async () => {
    const { engine, fake, done } = await setup();
    // What was already waiting at launch was seen before; only new requests ring.
    expect(fake.shown.size).toBe(0);
    engine.requestApproval('exec', later);
    await eventually(() => expect(fake.shown.get('approval:exec-2')).toBeDefined());
    expect(fake.shown.get('approval:exec-2')).toEqual({ key: 'approval:exec-2', title: 'Oak needs a yes', body: 'Run: rm -rf build && pnpm build', category: 'approval', approvalId: 'exec-2' });
    expect(fake.prepared).toBe(1);
    engine.requestApproval('plugin', email);
    await eventually(() => expect(fake.shown.get('approval:plugin:mail-2')).toMatchObject({ title: 'Branch Agent needs a yes', body: 'Send a reply to Sam?\nTo: Sam', category: 'approval-send' }));
    expect(fake.badges.at(-1)).toBe(4);
    expect(fake.prepared).toBe(1);
    done();
  });

  it('stays quiet while Branch is open, but keeps the badge right', async () => {
    const { engine, fake, done } = await setup('active');
    engine.requestApproval('exec', later);
    await eventually(() => expect(fake.badges.at(-1)).toBe(3));
    expect(fake.shown.size).toBe(0);
    done();
  });

  it('Allow on the notification answers it on the computer, and the notification goes away', async () => {
    const { engine, fake, inbox, done } = await setup();
    engine.requestApproval('exec', later);
    await eventually(() => expect(fake.shown.has('approval:exec-2')).toBe(true));
    fake.respond({ approvalId: 'exec-2', action: 'allow' });
    await eventually(() => expect(engine.requests).toContainEqual({ method: 'exec.approval.resolve', params: { id: 'exec-2', decision: 'allow-once' } }));
    await eventually(() => expect(fake.dismissed).toContain('approval:exec-2'));
    expect(inbox.getSnapshot().answered[0]).toMatchObject({ id: 'exec-2', outcome: 'allowed', by: 'phone' });
    expect(fake.badges.at(-1)).toBe(2);
    done();
  });

  it('Deny on the notification refuses it on the computer', async () => {
    const { engine, fake, done } = await setup();
    engine.requestApproval('plugin', email);
    await eventually(() => expect(fake.shown.has('approval:plugin:mail-2')).toBe(true));
    fake.respond({ approvalId: 'plugin:mail-2', action: 'deny' });
    await eventually(() => expect(engine.requests).toContainEqual({ method: 'plugin.approval.resolve', params: { id: 'plugin:mail-2', decision: 'deny' } }));
    await eventually(() => expect(fake.dismissed).toContain('approval:plugin:mail-2'));
    done();
  });

  it('when the computer answers first, the phone’s notification clears by itself', async () => {
    const { engine, fake, done } = await setup();
    engine.requestApproval('exec', later);
    await eventually(() => expect(fake.shown.has('approval:exec-2')).toBe(true));
    engine.resolveApproval('exec-2', 'deny');
    await eventually(() => expect(fake.dismissed).toEqual(['approval:exec-2']));
    expect(fake.badges.at(-1)).toBe(2);
    done();
  });

  it('a tap on the notification opens Needs you at that approval, also when it launched the app', async () => {
    const { fake, opened, done } = await setup();
    fake.respond({ approvalId: 'exec-1', action: 'open' });
    expect(opened).toEqual(['exec-1']);
    done();

    const second = await (async () => {
      const engine = createFakeEngine({ agents: fixtureAgents, approvals: fixtureApprovals });
      const { session } = createFakeSession(engine);
      const inbox = new ApprovalInbox(session);
      const notifier = createFakeNotifier();
      notifier.setLaunch({ approvalId: 'plugin:mail-1', action: 'open' });
      const ids: string[] = [];
      const alerts = new ApprovalAlerts(inbox, notifier.notifier, createFakeAppState('active').source, (id) => ids.push(id));
      alerts.attach();
      await eventually(() => expect(ids).toEqual(['plugin:mail-1']));
      alerts.dispose();
      session.dispose();
      return ids;
    })();
    expect(second).toEqual(['plugin:mail-1']);
  });

  it('says so on the phone when a button’s answer couldn’t reach the computer', async () => {
    const { engine, fake, done } = await setup();
    engine.requestApproval('exec', later);
    await eventually(() => expect(fake.shown.has('approval:exec-2')).toBe(true));
    engine.failMethod('exec.approval.resolve', 'gateway busy');
    fake.respond({ approvalId: 'exec-2', action: 'allow' });
    await eventually(() =>
      expect(fake.shown.get('approval-failed:exec-2')).toEqual({ key: 'approval-failed:exec-2', title: 'Your answer didn’t reach your computer', body: 'Open Branch to try again.', approvalId: 'exec-2' }),
    );
    expect(fake.shown.has('approval:exec-2')).toBe(true);
    done();
  });

  it('coming back to the front reads the approvals again', async () => {
    const { engine, state, done } = await setup();
    const reads = () => engine.requests.filter((r) => r.method === 'exec.approval.list').length;
    const before = reads();
    state.set('active');
    await eventually(() => expect(reads()).toBe(before + 1));
    done();
  });
});
