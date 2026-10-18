import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { palettes } from '../theme/tokens';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, approvals: fixtureApprovals });
  const { session } = createFakeSession(engine);
  await render(<App scheme="light" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
  return { session, engine };
}

describe('iOS app shell', () => {
  it('keeps every existing Chats control after pairing, and adds the Places bar', async () => {
    const { session } = await pairedApp();
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('approvals-button')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-button')).toBeOnTheScreen();
    expect(screen.getByTestId('agents-button')).toBeOnTheScreen();
    expect(screen.getByTestId('computer-button')).toBeOnTheScreen();
    expect(screen.getByTestId('phone-shell')).toBeOnTheScreen();
    expect(screen.getByTestId('places-bar')).toBeOnTheScreen();
    const bar = StyleSheet.flatten(screen.getByTestId('places-bar').props.style);
    expect(bar.position).toBe('absolute');
    expect(bar.left).toBe(14);
    expect(bar.height).toBe(64);
    expect(bar.borderRadius).toBe(32);
    expect(bar.backgroundColor).toBe(palettes.light.glass);
    session.dispose();
  });

  it('hides the Places bar on a chat, and shows it again on Chats', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('chat-agent:main:main'));
    await eventually(() => expect(screen.getByTestId('chat-screen')).toBeOnTheScreen());
    expect(screen.queryByTestId('places-bar')).toBeNull();
    expect(screen.queryByTestId('phone-shell')).toBeNull();
    await fireEvent.press(screen.getByTestId('chat-back'));
    await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
    expect(screen.getByTestId('places-bar')).toBeOnTheScreen();
    session.dispose();
  });

  it('opens Inbox and More from the Places bar without dropping Approvals or Settings', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('place-inbox'));
    expect(screen.getByTestId('approvals-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('place-inbox')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('approvals-back')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('place-more'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('place-more')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('more-back')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('more-settings'));
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-back')).toBeOnTheScreen();
    session.dispose();
  });
});
