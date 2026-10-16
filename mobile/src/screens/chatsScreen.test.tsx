import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { FIXTURE_NOW, fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { ChatsScreen } from './ChatsScreen';
import { ThemeProvider } from '../theme/ThemeProvider';
import { chatRows, readAgents, type ChatListSnapshot } from '../chats/chatList';

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });
const { agents, mainKey } = readAgents(fixtureAgents);
const rows = chatRows({ sessions: fixtureSessions }, agents, mainKey);

function renderList(list: ChatListSnapshot, online = true, extra: Partial<Parameters<typeof ChatsScreen>[0]> = {}) {
  return render(
    <ThemeProvider scheme="light">
      <ChatsScreen list={list} online={online} onRefresh={async () => undefined} onComputer={() => undefined} now={FIXTURE_NOW} {...extra} />
    </ThemeProvider>,
  );
}

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  const { session } = createFakeSession(engine);
  await render(<App scheme="dark" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen());
  return { session, engine };
}

describe('chats screen', () => {
  it('shows grey rows until the first read, never a blank list', async () => {
    await renderList({ rows: [], loaded: false, error: null });
    expect(screen.getByTestId('chats-loading')).toBeOnTheScreen();
    expect(screen.queryByTestId('chats-empty')).toBeNull();
  });

  it('shows each chat with its name, last line, time, and what needs you', async () => {
    await renderList({ rows, loaded: true, error: null });
    const main = within(screen.getByTestId('chat-agent:main:main'));
    expect(main.getByText('Branch Agent')).toBeOnTheScreen();
    expect(main.getByText('🌿')).toBeOnTheScreen();
    expect(main.getByText('Your expenses for September are filed. Anything else?')).toBeOnTheScreen();
    expect(main.getByText('9:39 PM')).toBeOnTheScreen();
    expect(screen.getByTestId('unread-agent:main:main')).toBeOnTheScreen();
    expect(screen.getByTestId('working-agent:oak:main')).toBeOnTheScreen();
    expect(screen.queryByTestId('working-agent:main:main')).toBeNull();
    const settings = within(screen.getByTestId('chat-agent:oak:chat-1'));
    expect(settings.getByText('Needs you')).toBeOnTheScreen();
    expect(settings.getByText('Yesterday')).toBeOnTheScreen();
    expect(within(screen.getByTestId('chat-agent:main:old')).getByText('With Branch Agent')).toBeOnTheScreen();
    expect(screen.getByTestId('pinned-trunks')).toBeOnTheScreen();
    expect(screen.getByTestId('pin-agent:researcher:main')).toBeOnTheScreen();
    expect(screen.getByText('Recent')).toBeOnTheScreen();
    expect(screen.getByTestId('status-agent:oak:main')).toHaveTextContent('Working');
    expect(screen.getByTestId('status-agent:oak:chat-1')).toHaveTextContent('Waiting for you');
    expect(screen.getByTestId('status-agent:main:main')).toHaveTextContent('Done');
    expect(screen.queryByTestId('status-agent:oak:room:launch')).toBeNull();
    expect(screen.getByTestId('unread-agent:main:main')).toHaveTextContent('1');
    expect(screen.queryByText('Heartbeat')).toBeNull();
    expect(screen.queryByText('Archived chat')).toBeNull();
  });

  it('counts the chats that want a look and narrows the list with chips', async () => {
    await renderList({ rows, loaded: true, error: null });
    expect(screen.getByTestId('chats-count')).toHaveTextContent('2');
    expect(screen.queryByTestId('chat-agent:researcher:taxes')).toBeNull();
    expect(screen.queryByTestId('chat-agent:main:cron:daily')).toBeNull();
    await fireEvent.press(screen.getByTestId('filter-rooms'));
    expect(screen.getByTestId('chat-agent:oak:room:launch')).toBeOnTheScreen();
    expect(screen.queryByTestId('chat-agent:main:main')).toBeNull();
    expect(screen.queryByText('Pinned')).toBeNull();
    await fireEvent.press(screen.getByTestId('filter-snoozed'));
    expect(screen.getByTestId('chat-agent:researcher:taxes')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('filter-archived'));
    expect(screen.getByText('Archived chat')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('filter-automations'));
    expect(screen.getByText('Daily digest')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('filter-all'));
    expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen();
    expect(screen.getByTestId('pinned-trunks')).toBeOnTheScreen();
  });

  it('hides chips with nothing behind them, and an emptied chip leads back to All', async () => {
    const only = rows.filter((r) => r.key === 'agent:main:main' || r.key === 'agent:oak:chat-1');
    await renderList({ rows: only, loaded: true, error: null });
    expect(screen.queryByTestId('filter-rooms')).toBeNull();
    await fireEvent.press(screen.getByTestId('filter-needsYou'));
    expect(screen.getByTestId('chat-agent:oak:chat-1')).toBeOnTheScreen();
    await renderList({ rows: only.map((r) => ({ ...r, needsYou: false })), loaded: true, error: null });
    expect(screen.queryByTestId('filter-needsYou')).toBeNull();
  });

  it('finds words inside messages as well as chat names', async () => {
    const searchMessages = jest.fn(async () => ({ results: [{ sessionKey: 'agent:oak:chat-1', role: 'user', snippet: 'please fix the settings toggle', timestamp: FIXTURE_NOW - 60_000, messageId: 'm1' }] }));
    await renderList({ rows, loaded: true, error: null }, true, { searchMessages });
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'settings');
    expect(screen.getByTestId('section-Chats')).toBeOnTheScreen();
    await eventually(() => expect(screen.getByTestId('hit-agent:oak:chat-1-m1')).toBeOnTheScreen());
    expect(screen.getByText('You: please fix the settings toggle')).toBeOnTheScreen();
    expect(searchMessages).toHaveBeenLastCalledWith('settings');
  });

  it('keeps name matches when message search fails, and says so', async () => {
    const searchMessages = jest.fn(async () => {
      throw new Error('search unavailable');
    });
    await renderList({ rows, loaded: true, error: null }, true, { searchMessages });
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'lisbon');
    await eventually(() => expect(screen.getByTestId('search-note')).toHaveTextContent(/Showing chat names only/));
    expect(screen.getByTestId('chat-agent:main:old')).toBeOnTheScreen();
  });

  it('searches as you type and says when nothing matches', async () => {
    await renderList({ rows, loaded: true, error: null });
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'lisbon');
    expect(screen.getByTestId('chat-agent:main:old')).toBeOnTheScreen();
    expect(screen.queryByTestId('chat-agent:main:main')).toBeNull();
    expect(screen.queryByText('Pinned')).toBeNull();
    expect(screen.queryByTestId('chat-filters')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'zebra');
    expect(screen.getByTestId('chats-no-match')).toHaveTextContent(/No chats or messages match “zebra”/);
  });

  it('says there are no chats yet, and why a read failed with a way to try again', async () => {
    await renderList({ rows: [], loaded: true, error: null });
    expect(screen.getByTestId('chats-empty')).toBeOnTheScreen();
    const onRefresh = jest.fn(async () => undefined);
    await renderList({ rows: [], loaded: false, error: 'sessions unavailable' }, true, { onRefresh });
    expect(screen.getByTestId('chats-error')).toHaveTextContent(/sessions unavailable/);
    await fireEvent.press(screen.getByTestId('chats-error-action'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await renderList({ rows: [], loaded: false, error: 'not connected' }, false);
    expect(screen.getByTestId('chats-waiting')).toBeOnTheScreen();
  });

  it('opens on Chats once paired, follows the computer live, and goes to Computers and back', async () => {
    const { session, engine } = await pairedApp();
    expect(screen.getByTestId('settings-button')).toBeOnTheScreen();
    expect(screen.getByTestId('computer-button')).toHaveProp('accessibilityLabel', 'Computers, connected');
    expect(screen.queryByTestId('chats-offline')).toBeNull();

    engine.setSessions([...fixtureSessions, { key: 'agent:oak:new', agentId: 'oak', label: 'Plan the launch', updatedAt: Date.now(), lastMessagePreview: 'On it' }]);
    engine.emit('sessions.changed', {});
    await eventually(() => expect(screen.getByText('Plan the launch')).toBeOnTheScreen());

    engine.drop();
    await eventually(() => expect(screen.getByTestId('chats-offline')).toBeOnTheScreen());
    expect(screen.getByText('Plan the launch')).toBeOnTheScreen();
    await eventually(() => expect(screen.queryByTestId('chats-offline')).toBeNull());

    await fireEvent.press(screen.getByTestId('computer-button'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    expect(screen.getByText('Computers')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('computers-back'));
    expect(screen.getByText('Plan the launch')).toBeOnTheScreen();
    expect(screen.queryByTestId('chats-loading')).toBeNull();
    session.dispose();
  });

  it('filters by Working from the Filter sheet and can keep automation runs in All', async () => {
    await renderList({ rows, loaded: true, error: null });
    await fireEvent.press(screen.getByTestId('chats-filter'));
    expect(screen.getByTestId('chats-filter-sheet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('filter-status'));
    await fireEvent.press(screen.getByTestId('filter-status-working'));
    expect(screen.getByTestId('chat-agent:oak:main')).toBeOnTheScreen();
    expect(screen.queryByTestId('chat-agent:main:main')).toBeNull();
    await fireEvent.press(screen.getByTestId('chats-filter'));
    await fireEvent.press(screen.getByTestId('filter-status'));
    await fireEvent.press(screen.getByTestId('filter-status-all'));
    await fireEvent.press(screen.getByTestId('filter-autos'));
    expect(screen.getByText('Daily digest')).toBeOnTheScreen();
  });

  it('hides unfinished Filter and New Trunk rows on Regular, and names them at Advanced', async () => {
    await renderList({ rows, loaded: true, error: null });
    await fireEvent.press(screen.getByTestId('chats-filter'));
    expect(screen.queryByTestId('filter-system')).toBeNull();
    expect(screen.queryByTestId('new-trunk-row')).toBeNull();
    expect(screen.queryByTestId('chats-sort')).toBeNull();
    await renderList({ rows, loaded: true, error: null }, true, { level: 'advanced' });
    expect(screen.getByTestId('new-trunk-row')).toHaveTextContent(/New Trunk comes in a later update/);
    expect(screen.getByTestId('chats-sort')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('chats-filter'));
    expect(screen.getByTestId('filter-system')).toHaveTextContent(/Show system conversations comes in a later update/);
    await fireEvent.press(screen.getByTestId('chats-sort'));
    expect(screen.getByTestId('chats-sort-sheet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('sort-old'));
    await fireEvent.press(screen.getByTestId('layout-compact'));
    expect(screen.getByTestId('chat-agent:main:old')).toBeOnTheScreen();
    expect(screen.queryByText('Your expenses for September are filed. Anything else?')).toBeNull();
  });

  it('shows the Android New chat control and opens the default Trunk', async () => {
    const onNewChat = jest.fn();
    const onOpen = jest.fn();
    await renderList({ rows, loaded: true, error: null }, true, { look: 'android', onNewChat, onOpen });
    expect(screen.getByTestId('chats-new')).toHaveTextContent(/New chat/);
    await fireEvent.press(screen.getByTestId('chats-new'));
    expect(onNewChat).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('pin-agent:researcher:main'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'agent:researcher:main' }));
  });

  it('finds Settings and New chat in search, and hides Talk on Regular', async () => {
    const onSettings = jest.fn();
    const onNewChat = jest.fn();
    await renderList({ rows, loaded: true, error: null }, true, { onSettings, onNewChat });
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'settings');
    expect(screen.getByTestId('action-settings')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'talk');
    expect(screen.queryByTestId('action-talk')).toBeNull();
    await renderList({ rows, loaded: true, error: null }, true, { level: 'advanced', onNewChat });
    await fireEvent.changeText(screen.getByTestId('chat-search'), 'talk');
    expect(screen.getByTestId('action-talk')).toHaveTextContent(/Talk live comes in a later update/);
  });
});
