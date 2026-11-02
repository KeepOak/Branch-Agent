import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import type { AgentRow } from '../agents/agentList';
import { createFakeEngine } from '../connect/fakeEngine';
import { laterUpdate } from '../settings/showLevel';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { ProfileScreen, profileRows } from './ProfileScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const oak: AgentRow = { id: 'oak', name: 'Oak', avatar: 'O', status: 'running' };

async function renderProfile(extra: Partial<Parameters<typeof ProfileScreen>[0]> = {}) {
  const mocks = { onComputer: jest.fn(), onBack: jest.fn() };
  await render(
    <ThemeProvider scheme="light">
      <ProfileScreen row={oak} level="regular" computer="This computer" {...mocks} {...extra} />
    </ThemeProvider>,
  );
  return { mocks };
}

async function pairedApp(extra: Parameters<typeof App>[0] = {}) {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  const { session } = createFakeSession(engine);
  const fake = createFakeNotifier('granted');
  await render(
    <App
      session={session}
      notifier={fake.notifier}
      appState={createFakeAppState('active').source}
      identity={{ version: '0.1.0', build: '14' }}
      {...extra}
    />,
  );
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chats-screen')).toBeOnTheScreen());
  return { session };
}

describe('profile rows', () => {
  it('keeps Its computer at Regular, and hides unfinished rows', () => {
    const groups = profileRows({ level: 'regular', row: oak, computer: 'This computer' });
    expect(groups.flatMap((group) => group.rows.map((row) => row.id))).toEqual(['computer']);
  });

  it('adds every preview Profile row at Advanced, with a later-update line on unfinished ones', () => {
    const rows = profileRows({ level: 'advanced', row: oak, computer: 'This computer' }).flatMap((group) => group.rows);
    expect(rows.map((row) => row.id)).toEqual(['computer', 'model', 'may', 'library', 'default', 'pause']);
    expect(rows.find((row) => row.id === 'model')?.detail).toBe(laterUpdate('Model'));
    expect(rows.find((row) => row.id === 'computer')?.detail).toBe('Open the computer pane');
  });
});

describe('profile screen', () => {
  it('shows the Trunk, a short line under every row, and opens Its computer', async () => {
    const { mocks } = await renderProfile({ level: 'advanced' });
    expect(screen.getByRole('header')).toHaveTextContent('Oak');
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Running');
    expect(screen.getByTestId('profile-computer')).toHaveTextContent(/Open the computer pane/);
    expect(screen.getByTestId('profile-model')).toHaveTextContent(/Model comes in a later update/);
    expect(screen.getByTestId('profile-pause')).toHaveTextContent(/Pause Oak comes in a later update/);
    await fireEvent.press(screen.getByTestId('profile-computer'));
    expect(mocks.onComputer).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('profile-back'));
    expect(mocks.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('profile in the app', () => {
  it('opens from Agents, opens Its computer, and comes back', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('agents-button'));
    await eventually(() => expect(screen.getByTestId('agent-oak')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('agent-oak'));
    expect(screen.getByTestId('profile-screen')).toBeOnTheScreen();
    expect(screen.getByText('Oak')).toBeOnTheScreen();
    expect(screen.getByTestId('profile-status')).toHaveTextContent('Running');
    expect(screen.getByTestId('profile-computer')).toHaveTextContent(/This computer/);
    expect(screen.queryByTestId('profile-model')).toBeNull();

    await fireEvent.press(screen.getByTestId('profile-computer'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('computers-back'));
    expect(screen.getByTestId('profile-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('profile-back'));
    expect(screen.getByTestId('agents-screen')).toBeOnTheScreen();
    session.dispose();
  });
});
