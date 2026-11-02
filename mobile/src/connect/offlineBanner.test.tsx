import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { createFakeEngine } from './fakeEngine';
import { PHONE_RECONNECT } from './phoneGateway';

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });

async function pairedApp(reconnect?: { initialMs: number; multiplier: number; maxMs: number }) {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  const { session } = createFakeSession(engine, undefined, reconnect ? { reconnect } : {});
  await render(<App scheme="light" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
  return { session, engine };
}

describe('offline banner and reconnect', () => {
  it('shows the offline banner when the connection to the computer drops', async () => {
    const { session, engine } = await pairedApp();
    expect(screen.queryByTestId('chats-offline')).toBeNull();

    engine.drop();
    await eventually(() => expect(screen.getByTestId('chats-offline')).toBeOnTheScreen());
    expect(screen.getByTestId('chats-offline')).toHaveTextContent('Reconnecting to your computer… These chats may be out of date.');
    expect(screen.getByTestId('chats-offline')).toHaveProp('accessibilityRole', 'alert');
    session.dispose();
  });

  it('reconnects with backoff after the connection drops', async () => {
    expect(PHONE_RECONNECT).toEqual({ initialMs: 800, multiplier: 1.7, maxMs: 5_000 });
    const reconnect = { initialMs: 80, multiplier: 2, maxMs: 200 };
    const { session, engine } = await pairedApp(reconnect);
    const before = engine.connects.length;

    engine.drop();
    await eventually(() => expect(session.getState()).toMatchObject({ step: 'paired', online: false }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(engine.connects.length).toBe(before);
    expect(session.getState()).toMatchObject({ online: false });

    await eventually(() => expect(session.getState()).toMatchObject({ step: 'paired', online: true }));
    expect(engine.connects.length).toBeGreaterThan(before);
    session.dispose();
  });

  it('clears the offline banner when the computer is back', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('chat-agent:main:main'));
    await eventually(() => expect(screen.getByTestId('chat-screen')).toBeOnTheScreen());
    expect(screen.queryByTestId('chat-offline')).toBeNull();

    engine.drop();
    await eventually(() => expect(screen.getByTestId('chat-offline')).toBeOnTheScreen());
    expect(screen.getByTestId('chat-offline')).toHaveTextContent('Reconnecting to your computer… This chat may be out of date.');
    await eventually(() => expect(screen.queryByTestId('chat-offline')).toBeNull());
    expect(session.getState()).toMatchObject({ step: 'paired', online: true });
    session.dispose();
  });
});
