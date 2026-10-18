import { waitFor } from '@testing-library/react-native';
import { createFakeEngine } from '../connect/fakeEngine';
import { PHONE_PREFS_DEFAULT } from '../settings/phonePrefs';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { EventAlerts } from './eventAlerts';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });

async function setup(appState = 'background', prefs = PHONE_PREFS_DEFAULT) {
  const engine = createFakeEngine({ agents: fixtureAgents, sessions: fixtureSessions });
  const { session } = createFakeSession(engine);
  await session.restore();
  await session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' });
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  const fake = createFakeNotifier();
  const state = createFakeAppState(appState);
  const alerts = new EventAlerts(session, fake.notifier, state.source, () => prefs);
  alerts.attach();
  const done = () => {
    alerts.dispose();
    session.dispose();
  };
  return { engine, fake, state, alerts, done };
}

describe('event notifications', () => {
  it('while Branch is in the background, a finished reply posts one notification for that chat', async () => {
    const { engine, fake, done } = await setup();
    engine.emit('chat', { state: 'final', runId: 'run-9', sessionKey: 'agent:oak:main' });
    await eventually(() => expect(fake.shown.get('reply:run-9')).toBeDefined());
    expect(fake.shown.get('reply:run-9')).toEqual({
      key: 'reply:run-9',
      title: 'A reply is ready',
      body: 'A Trunk finished while you were away.',
      channel: 'replies',
      route: { screen: 'chat', sessionKey: 'agent:oak:main' },
    });
    done();
  });

  it('stays quiet while Branch is open, and when that kind is switched off', async () => {
    const open = await setup('active');
    open.engine.emit('chat', { state: 'final', runId: 'run-open', sessionKey: 'agent:oak:main' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(open.fake.shown.size).toBe(0);
    open.done();

    const muted = await setup('background', { ...PHONE_PREFS_DEFAULT, notifKinds: [true, false, true, false, false] });
    muted.engine.emit('chat', { state: 'final', runId: 'run-off', sessionKey: 'agent:oak:main' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(muted.fake.shown.size).toBe(0);
    muted.done();
  });

  it('posts a question, a failed routine, and a mention, each on its own channel', async () => {
    const { engine, fake, done } = await setup();
    engine.emit('question.requested', { id: 'q1', sessionKey: 'agent:oak:chat-1', questions: [{ question: 'Which folder?' }] });
    engine.emit('cron', {
      action: 'finished',
      status: 'error',
      jobId: 'nightly',
      runAtMs: 1_700_000_000_000,
      job: { name: 'Nightly filing' },
    });
    await eventually(() => expect(fake.shown.get('question:q1')).toBeDefined());
    await eventually(() => expect(fake.shown.get('cron:nightly:cron:nightly:1700000000000:error')).toBeDefined());
    expect(fake.shown.get('question:q1')?.channel).toBe('questions');
    expect(fake.shown.get('cron:nightly:cron:nightly:1700000000000:error')).toMatchObject({
      channel: 'automations',
      title: 'A routine couldn’t finish',
      route: { screen: 'approvals' },
    });

    engine.setMentions([
      { id: 'm1', senderLabel: 'Dana', sessionKey: 'agent:oak:room:launch', sessionTitle: 'Launch team', excerpt: 'can you confirm?' },
    ]);
    engine.emit('mentions.changed', { revision: 1 });
    await eventually(() => expect(fake.shown.get('mention:m1')).toBeDefined());
    expect(fake.shown.get('mention:m1')).toMatchObject({
      channel: 'mentions',
      title: 'Dana mentioned you',
      route: { screen: 'chat', sessionKey: 'agent:oak:room:launch' },
    });
    done();
  });

  it('posts a second finished event for the same routine as its own notification', async () => {
    const { engine, fake, done } = await setup();
    engine.emit('cron', {
      action: 'finished',
      status: 'ok',
      jobId: 'nightly',
      runId: 'cron:nightly:1000',
      job: { name: 'Nightly filing' },
    });
    engine.emit('cron', {
      action: 'finished',
      status: 'ok',
      jobId: 'nightly',
      runAtMs: 2000,
      job: { name: 'Nightly filing' },
    });
    await eventually(() => expect(fake.shown.get('cron:nightly:cron:nightly:1000:ok')).toBeDefined());
    await eventually(() => expect(fake.shown.get('cron:nightly:cron:nightly:2000:ok')).toBeDefined());
    expect(fake.posted.filter((alert) => alert.key.startsWith('cron:nightly:'))).toHaveLength(2);
    done();
  });

  it('clears a question notification when it is answered, and posts an update that is ready', async () => {
    const { engine, fake, alerts, done } = await setup();
    engine.emit('question.requested', { id: 'q1' });
    await eventually(() => expect(fake.shown.has('question:q1')).toBe(true));
    engine.emit('question.resolved', { id: 'q1' });
    await eventually(() => expect(fake.dismissed).toContain('question:q1'));

    await alerts.notifyUpdate({ status: 'available', offer: { version: '0.2.0' } });
    expect(fake.shown.get('update:apk')).toMatchObject({
      channel: 'updates',
      title: 'Update available',
      route: { screen: 'settings' },
    });
    done();
  });

  it('posts an update that became ready while the app was open, once it goes to the background', async () => {
    const { fake, state, alerts, done } = await setup('active');
    await alerts.notifyUpdate({ status: 'available', offer: { version: '0.2.0' } });
    expect(fake.shown.has('update:apk')).toBe(false);
    state.set('background');
    await eventually(() => expect(fake.shown.get('update:apk')).toMatchObject({ title: 'Update available' }));
    done();
  });
});
