import { act, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  const { session } = createFakeSession(engine);
  const fake = createFakeNotifier('granted');
  const appState = createFakeAppState('background');
  const view = await render(<App scheme="dark" session={session} notifier={fake.notifier} appState={appState.source} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(session.hello).not.toBeNull());
  await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
  return { session, engine, fake, appState, view };
}

describe('notification deep links', () => {
  it('opens the chat a finished-reply notification was tapped for', async () => {
    const { session, fake } = await pairedApp();
    await act(async () => fake.respond({ action: 'open', route: { screen: 'chat', sessionKey: 'agent:oak:main' } }));
    await eventually(() => expect(screen.getByTestId('chat-screen')).toBeOnTheScreen());
    expect(screen.getByTestId('chat-screen')).toHaveTextContent(/Oak/);
    session.dispose();
  });

  it('opens Approvals from a tap with no chat, and Settings from an update', async () => {
    const { session, fake } = await pairedApp();
    await act(async () => fake.respond({ action: 'open', route: { screen: 'approvals' } }));
    await eventually(() => expect(screen.getByTestId('approvals-screen')).toBeOnTheScreen());
    await act(async () => fake.respond({ action: 'open', route: { screen: 'settings' } }));
    await eventually(() => expect(screen.getByTestId('settings-screen')).toBeOnTheScreen());
    session.dispose();
  });

  it('ignores a tap whose sessionKey is not an agent session', async () => {
    const { session, fake } = await pairedApp();
    await act(async () => fake.respond({ action: 'open', route: { screen: 'chat', sessionKey: 'main' } }));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('chat-screen')).toBeNull();
    session.dispose();
  });

  it('posts a finished reply only once after the app re-renders', async () => {
    const { session, engine, fake, appState, view } = await pairedApp();
    engine.emit('chat', { state: 'final', runId: 'run-once', sessionKey: 'agent:oak:main' });
    await eventually(() => expect(fake.posted.filter((alert) => alert.key === 'reply:run-once')).toHaveLength(1));
    await act(async () => {
      view.rerender(<App scheme="dark" session={session} notifier={fake.notifier} appState={appState.source} />);
    });
    engine.emit('sessions.changed', {});
    engine.emit('chat', { state: 'final', runId: 'run-once', sessionKey: 'agent:oak:main' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fake.posted.filter((alert) => alert.key === 'reply:run-once')).toHaveLength(1);
    session.dispose();
  });
});
