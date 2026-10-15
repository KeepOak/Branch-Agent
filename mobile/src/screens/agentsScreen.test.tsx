import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { type AgentListSnapshot } from '../agents/agentList';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AgentsScreen } from './AgentsScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
const rows: AgentListSnapshot['rows'] = [
  { id: 'main', name: 'Branch Agent', avatar: '🌿', status: 'idle' },
  { id: 'oak', name: 'Oak', avatar: 'O', status: 'running' },
  { id: 'researcher', name: 'Researcher', avatar: '🔎', status: 'idle' },
];

async function renderScreen(list: Partial<AgentListSnapshot> = {}, extra: Partial<Parameters<typeof AgentsScreen>[0]> = {}) {
  const mocks = { onRefresh: jest.fn(async () => undefined), onBack: jest.fn() };
  const snapshot: AgentListSnapshot = { rows, loaded: true, error: null, ...list };
  await render(
    <ThemeProvider scheme="light">
      <AgentsScreen list={snapshot} online onRefresh={mocks.onRefresh} onBack={mocks.onBack} {...extra} />
    </ThemeProvider>,
  );
  return { mocks };
}

async function pairedApp() {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  const { session } = createFakeSession(engine);
  await render(<App scheme="dark" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('agents-button')).toBeOnTheScreen());
  return { session, engine };
}

describe('agents screen', () => {
  it('lists each agent with its name and running or idle status, with no pause or resume', async () => {
    await renderScreen();
    expect(within(screen.getByTestId('agent-main')).getByText('Branch Agent')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-main')).getByText('Idle')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-oak')).getByText('Running')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-researcher')).getByText('Idle')).toBeOnTheScreen();
    expect(screen.queryByTestId('pause-oak')).toBeNull();
    expect(screen.queryByTestId('resume-researcher')).toBeNull();
    expect(screen.queryByTestId('agents-readonly')).toBeNull();
  });

  it('shows why a first read failed, with a way to try again', async () => {
    const { mocks } = await renderScreen({ rows: [], loaded: false, error: 'Your computer didn’t send its agents. Try again in a moment.' });
    expect(screen.getByTestId('agents-error')).toHaveTextContent(/didn’t send its agents/);
    fireEvent.press(screen.getByTestId('agents-error-action'));
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows a refresh failure beside the rows already loaded', async () => {
    const { mocks } = await renderScreen({ error: 'Your computer didn’t send its agents. Try again in a moment.' });
    expect(screen.getByTestId('agent-oak')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-oak')).getByText('Running')).toBeOnTheScreen();
    expect(screen.getByTestId('agents-error')).toHaveTextContent(/didn’t send its agents/);
    fireEvent.press(screen.getByTestId('agents-error-action'));
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('agents in the app', () => {
  it('opens Agents from Chats, lists the computer’s agents, and goes back', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('agents-screen')).toBeOnTheScreen());
    expect(screen.getByText('Agents')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agent-oak')).getByText('Oak')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-oak')).getByText('Running')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-researcher')).getByText('Idle')).toBeOnTheScreen();
    expect(screen.queryByTestId('pause-oak')).toBeNull();
    expect(engine.requests.some((r) => r.method === 'agents.pause' || r.method === 'agents.resume')).toBe(false);
    await fireEvent.press(screen.getByTestId('agents-back'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('says in plain words when the roster cannot be read, and Try again reads it again', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
    engine.failMethod('agents.list', 'agents unavailable', { reason: 'NOPE' }, 'INVALID_REQUEST');
    const { session } = createFakeSession(engine);
    await render(<App scheme="dark" session={session} />);
    await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
    engine.approve();
    await eventually(() => expect(screen.getByTestId('agents-button')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('agents-error')).toBeOnTheScreen());
    expect(screen.getByTestId('agents-error')).toHaveTextContent(/didn’t send its agents/);
    expect(screen.getByTestId('agents-error')).not.toHaveTextContent(/agents unavailable/);
    engine.failMethod('agents.list', null);
    await fireEvent.press(screen.getByTestId('agents-error-action'));
    await eventually(() => expect(screen.getByTestId('agent-oak')).toBeOnTheScreen());
    session.dispose();
  });

  it('keeps the rows on screen when a later list fails, with a way to try again', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('agent-oak')).toBeOnTheScreen());
    engine.failMethod('agents.list', 'agents unavailable', { reason: 'NOPE' }, 'INVALID_REQUEST');
    engine.emit('agents.changed', {});
    await eventually(() => expect(screen.getByTestId('agents-error')).toBeOnTheScreen());
    expect(screen.getByTestId('agent-oak')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-oak')).getByText('Running')).toBeOnTheScreen();
    expect(screen.queryByTestId('pause-oak')).toBeNull();
    session.dispose();
  });
});
