import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import App from '../../App';
import { readApproval, type ApprovalsSnapshot } from '../approvals/approvals';
import { chatRows, readAgents, type ChatListSnapshot } from '../chats/chatList';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureApprovals } from '../testing/approvalFixtures';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { type } from '../theme/tokens';
import { HomeScreen } from './HomeScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);
const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);
const trunks = Object.fromEntries(agents);
const exec = readApproval(fixtureApprovals.exec[0], 'exec')!;
const plugin = readApproval(fixtureApprovals.plugin[0], 'plugin')!;
const approvals: ApprovalsSnapshot = { pending: [exec, plugin], answered: [], trunks, loaded: true, error: null, sending: {}, failed: {} };
const list: ChatListSnapshot = { rows, loaded: true, error: null };

afterEach(() => {
  cleanup();
});

async function renderHome(extra: Partial<Parameters<typeof HomeScreen>[0]> = {}) {
  const mocks = {
    onNewChat: jest.fn(),
    onComputer: jest.fn(),
    onAnswer: jest.fn(),
    onLookFirst: jest.fn(),
    onPlace: jest.fn(),
    onOpenChat: jest.fn(),
  };
  await render(
    <ThemeProvider scheme="light">
      <HomeScreen chats={list} approvals={approvals} online now={FIXTURE_NOW} look="ios" {...mocks} {...extra} />
    </ThemeProvider>,
  );
  return mocks;
}

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, approvals: fixtureApprovals });
  const { session } = createFakeSession(engine);
  const view = await render(<App scheme="light" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
  return { session, engine, unmount: view.unmount };
}

describe('home screen', () => {
  it('shows the greeting, the one-line summary, Needs you, Working now, quick actions and Branch', async () => {
    await renderHome();
    expect(screen.getByTestId('home-greeting')).toHaveTextContent('Good evening');
    expect(screen.getByTestId('home-summary')).toHaveTextContent('2 waiting for you · 1 working');
    expect(screen.getByTestId('home-need-exec-1')).toBeOnTheScreen();
    expect(within(screen.getByTestId('home-need-exec-1')).getByText('Oak')).toBeOnTheScreen();
    expect(within(screen.getByTestId('home-need-exec-1')).getByText('Run a command')).toBeOnTheScreen();
    expect(screen.getByTestId('home-allow-exec-1')).toHaveTextContent('Allow');
    expect(screen.getByTestId('home-deny-exec-1')).toHaveTextContent('Deny');
    expect(screen.getByTestId('home-look-exec-1')).toHaveTextContent('Look first');
    expect(screen.getByTestId('home-allow-plugin:mail-1')).toHaveTextContent('Send it');
    expect(screen.getByTestId('home-deny-plugin:mail-1')).toHaveTextContent('Don’t send');
    expect(screen.getByTestId('home-work-agent:oak:main')).toBeOnTheScreen();
    expect(screen.getByTestId('home-still-agent:oak:main')).toHaveProp('accessibilityLabel', 'Oak: Live');
    expect(screen.getByTestId('home-meter-agent:oak:main')).toBeOnTheScreen();
    expect(screen.getByTestId('home-quick-new-chat')).toBeOnTheScreen();
    expect(screen.getByTestId('home-quick-computer')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-quick-talk')).toBeNull();
    expect(screen.queryByTestId('home-usage')).toBeNull();
    expect(screen.getByTestId('home-finished-agent:main:main')).toBeOnTheScreen();
    expect(screen.getByTestId('home-branch')).toHaveTextContent(/Branch on your computer/);
    expect(screen.getByTestId('home-branch')).toHaveTextContent(/Gateway on/);
    expect(screen.getByTestId('home-branch')).not.toHaveTextContent(/LEGION|taofik|@/i);
    expect(screen.getByTestId('place-home')).toHaveProp('accessibilityState', { selected: true });
  });

  it('uses the iPhone large title and a reserved status band', async () => {
    await renderHome();
    const title = StyleSheet.flatten(screen.getByTestId('home-greeting').props.style);
    expect(title.fontSize).toBe(type.largeTitle.fontSize);
    expect(screen.getByTestId('phone-large-title')).toBeOnTheScreen();
    expect(screen.getByTestId('phone-status-band')).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByTestId('phone-status-band').props.style).height).toBeGreaterThanOrEqual(50);
    const bar = StyleSheet.flatten(screen.getByTestId('places-bar').props.style);
    expect(bar.position).toBe('absolute');
    expect(bar.borderRadius).toBe(32);
  });

  it('says nothing needs you and nothing is running when the lists are empty', async () => {
    await renderHome({
      chats: { rows: [], loaded: true, error: null },
      approvals: { pending: [], answered: [], trunks, loaded: true, error: null, sending: {}, failed: {} },
    });
    expect(screen.getByTestId('home-summary')).toHaveTextContent('Nothing waiting for you · 0 working');
    expect(screen.getByTestId('home-needs-empty')).toHaveTextContent('Nothing needs you.');
    expect(screen.getByTestId('home-working-empty')).toHaveTextContent('Nothing is running.');
    expect(screen.queryByTestId('home-finished')).toBeNull();
  });

  it('answers Allow or Deny and opens Look first', async () => {
    const mocks = await renderHome();
    await fireEvent.press(screen.getByTestId('home-allow-exec-1'));
    await fireEvent.press(screen.getByTestId('home-deny-plugin:mail-1'));
    await fireEvent.press(screen.getByTestId('home-look-exec-1'));
    expect(mocks.onAnswer.mock.calls).toEqual([
      ['exec-1', 'allow-once'],
      ['plugin:mail-1', 'deny'],
    ]);
    expect(mocks.onLookFirst).toHaveBeenCalledWith('exec-1', 'agent:oak:chat-1');
  });

  it('opens New chat and Computer, and hides unfinished actions on Regular', async () => {
    const mocks = await renderHome();
    await fireEvent.press(screen.getByTestId('home-quick-new-chat'));
    await fireEvent.press(screen.getByTestId('home-quick-computer'));
    expect(mocks.onNewChat).toHaveBeenCalled();
    expect(mocks.onComputer).toHaveBeenCalled();
    expect(screen.queryByTestId('home-quick-talk')).toBeNull();
    expect(screen.queryByTestId('home-quick-scan')).toBeNull();
    expect(screen.queryByText(/comes in a later update/)).toBeNull();
  });

  it('at Advanced, unfinished actions say they come in a later update', async () => {
    await renderHome({ accessLevel: 'advanced' });
    expect(screen.getByTestId('home-quick-talk')).toBeOnTheScreen();
    expect(screen.getByTestId('home-quick-new-trunk')).toBeOnTheScreen();
    expect(screen.getByTestId('home-quick-scan')).toBeOnTheScreen();
    expect(screen.getByTestId('home-quick-automations')).toBeOnTheScreen();
    expect(screen.getByTestId('home-usage')).toHaveTextContent('What’s left comes in a later update.');
    await fireEvent.press(screen.getByTestId('home-quick-talk'));
    expect(screen.getByTestId('home-later')).toHaveTextContent('Talk comes in a later update.');
    await fireEvent.press(screen.getByTestId('home-all-accounts'));
    expect(screen.getByTestId('home-later')).toHaveTextContent('What’s left comes in a later update.');
  });

  it('does not draw a visible vertical scrollbar', async () => {
    await renderHome();
    expect(screen.getByTestId('home-scroll')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('home-scroll')).toHaveProp('showsHorizontalScrollIndicator', false);
  });
});

describe('home in the app', () => {
  it('stays on Chats after pairing, and Home is one tap from the places bar', async () => {
    const { session, unmount } = await pairedApp();
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('place-home')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('place-home'));
    expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('home-greeting')).toBeOnTheScreen();
    expect(screen.getByTestId('home-need-exec-1')).toBeOnTheScreen();
    expect(screen.getByTestId('home-work-agent:oak:main')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('place-chats'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
    unmount();
  });

  it('Allow on Home answers the computer, and Look first opens the chat', async () => {
    const { session, engine, unmount } = await pairedApp();
    await fireEvent.press(screen.getByTestId('place-home'));
    await eventually(() => expect(screen.getByTestId('home-allow-exec-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('home-allow-exec-1'));
    await eventually(() => expect(engine.requests.some((r) => r.method === 'exec.approval.resolve' && r.params && (r.params as { id?: string }).id === 'exec-1')).toBe(true));
    await fireEvent.press(screen.getByTestId('home-look-plugin:mail-1'));
    await eventually(() => expect(screen.getByTestId('chat-screen')).toBeOnTheScreen());
    session.dispose();
    unmount();
  });

  it('New chat goes to Chats and Computer opens Computers, Inbox opens Approvals, More opens More', async () => {
    const { session, unmount } = await pairedApp();
    await fireEvent.press(screen.getByTestId('place-home'));
    await fireEvent.press(screen.getByTestId('home-quick-new-chat'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('place-home'));
    await fireEvent.press(screen.getByTestId('home-quick-computer'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('computers-back'));
    await fireEvent.press(screen.getByTestId('place-home'));
    await fireEvent.press(screen.getByTestId('place-inbox'));
    expect(screen.getByTestId('approvals-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('approvals-back'));
    await fireEvent.press(screen.getByTestId('place-home'));
    await fireEvent.press(screen.getByTestId('place-more'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();
    session.dispose();
    unmount();
  });
});
