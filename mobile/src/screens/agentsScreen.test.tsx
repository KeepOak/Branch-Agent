import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { PAUSE_METHOD, PAUSE_UNAVAILABLE, RESUME_METHOD, type AgentListSnapshot } from '../agents/agentList';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AgentsScreen } from './AgentsScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
const CONTROL = [PAUSE_METHOD, RESUME_METHOD];
const rows: AgentListSnapshot['rows'] = [
  { id: 'main', name: 'Branch Agent', avatar: '🌿', status: 'idle' },
  { id: 'oak', name: 'Oak', avatar: 'O', status: 'running' },
  { id: 'researcher', name: 'Researcher', avatar: '🔎', status: 'paused' },
];

async function renderScreen(list: Partial<AgentListSnapshot> = {}, extra: Partial<Parameters<typeof AgentsScreen>[0]> = {}) {
  const mocks = { onRefresh: jest.fn(async () => undefined), onPause: jest.fn(), onResume: jest.fn(), onBack: jest.fn() };
  const snapshot: AgentListSnapshot = { rows, loaded: true, error: null, canControl: true, sending: {}, failed: {}, ...list };
  await render(
    <ThemeProvider scheme="light">
      <AgentsScreen list={snapshot} online onRefresh={mocks.onRefresh} onPause={mocks.onPause} onResume={mocks.onResume} onBack={mocks.onBack} {...extra} />
    </ThemeProvider>,
  );
  return { mocks };
}

async function pairedApp(methods: string[] = CONTROL) {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, methods });
  const { session } = createFakeSession(engine);
  await render(<App scheme="dark" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('agents-button')).toBeOnTheScreen());
  return { session, engine };
}

describe('agents screen', () => {
  it('lists each agent with its name and running, paused or idle status', async () => {
    await renderScreen();
    expect(within(screen.getByTestId('agent-main')).getByText('Branch Agent')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-main')).getByText('Idle')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-oak')).getByText('Running')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-researcher')).getByText('Paused')).toBeOnTheScreen();
    expect(screen.getByTestId('pause-oak')).toBeOnTheScreen();
    expect(screen.getByTestId('resume-researcher')).toBeOnTheScreen();
    expect(screen.queryByTestId('agents-readonly')).toBeNull();
  });

  it('asks before pausing, and Resume starts it again', async () => {
    const { mocks } = await renderScreen();
    await fireEvent.press(screen.getByTestId('pause-oak'));
    expect(mocks.onPause).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-pause-oak')).toHaveTextContent(/won’t start anything new/);
    await fireEvent.press(screen.getByTestId('confirm-pause-oak-no'));
    expect(screen.queryByTestId('confirm-pause-oak')).toBeNull();
    await fireEvent.press(screen.getByTestId('pause-oak'));
    await fireEvent.press(screen.getByTestId('confirm-pause-oak-yes'));
    expect(mocks.onPause).toHaveBeenCalledWith('oak');
    await fireEvent.press(screen.getByTestId('resume-researcher'));
    expect(mocks.onResume).toHaveBeenCalledWith('researcher');
  });

  it('shows why a pause or resume failed, and a failed list with a way to try again', async () => {
    await renderScreen({ failed: { oak: 'Your computer couldn’t change that Trunk just now. Try again in a moment.' } });
    expect(screen.getByTestId('failed-oak')).toHaveTextContent(/couldn’t change that Trunk/);
    const { mocks } = await renderScreen({ rows: [], loaded: false, error: 'Your computer didn’t send its agents. Try again in a moment.' });
    expect(screen.getByTestId('agents-error')).toHaveTextContent(/didn’t send its agents/);
    fireEvent.press(screen.getByTestId('agents-error-action'));
    expect(mocks.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('is read-only when the engine has no pause or resume method, and says so', async () => {
    await renderScreen({ canControl: false });
    expect(screen.getByTestId('agents-readonly')).toHaveTextContent(PAUSE_UNAVAILABLE);
    expect(screen.queryByTestId('pause-oak')).toBeNull();
    expect(screen.queryByTestId('resume-researcher')).toBeNull();
  });
});

describe('agents in the app', () => {
  it('opens Agents from Chats, lists the computer’s agents, and goes back', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('agents-screen')).toBeOnTheScreen());
    expect(screen.getByText('Agents')).toBeOnTheScreen();
    expect(within(screen.getByTestId('agent-oak')).getByText('Oak')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-oak')).getByText('Running')).toBeOnTheScreen();
    expect(within(screen.getByTestId('status-researcher')).getByText('Paused')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('agents-back'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('confirms, then pauses and resumes through the engine', async () => {
    const { session, engine } = await pairedApp();
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('pause-oak')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('pause-oak'));
    await fireEvent.press(screen.getByTestId('confirm-pause-oak-yes'));
    await eventually(() => expect(screen.getByTestId('resume-oak')).toBeOnTheScreen());
    expect(engine.requests).toContainEqual({ method: PAUSE_METHOD, params: { agentId: 'oak' } });
    expect(within(screen.getByTestId('status-oak')).getByText('Paused')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('resume-researcher'));
    await eventually(() => expect(screen.getByTestId('pause-researcher')).toBeOnTheScreen());
    expect(engine.requests).toContainEqual({ method: RESUME_METHOD, params: { agentId: 'researcher' } });
    session.dispose();
  });

  it('stays read-only against an engine that has not advertised pause or resume', async () => {
    const { session } = await pairedApp([]);
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('agents-readonly')).toBeOnTheScreen());
    expect(screen.queryByTestId('pause-oak')).toBeNull();
    session.dispose();
  });

  it('says in plain words when the roster cannot be read, and Try again reads it again', async () => {
    const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, methods: CONTROL });
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
});
