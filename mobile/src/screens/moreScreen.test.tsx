import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { laterUpdate } from '../settings/showLevel';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { MoreScreen, moreRows } from './MoreScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

async function renderMore(extra: Partial<Parameters<typeof MoreScreen>[0]> = {}) {
  const mocks = { onYou: jest.fn(), onSettings: jest.fn(), onTrunks: jest.fn(), onBack: jest.fn() };
  await render(
    <ThemeProvider scheme="light">
      <MoreScreen level="regular" trunkCount={3} workingCount={1} youName="Owner" {...mocks} {...extra} />
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
  return { session, engine };
}

describe('more rows', () => {
  it('keeps You, Trunks and Settings at Regular, and hides unfinished rows', () => {
    const groups = moreRows({ level: 'regular', trunkCount: 3, workingCount: 1, youName: 'Owner' });
    const ids = groups.flatMap((group) => group.rows.map((row) => row.id));
    expect(ids).toEqual(['you', 'trunks', 'settings']);
    expect(groups.find((group) => group.id === 'keepoak')).toBeUndefined();
  });

  it('adds every preview More row at Advanced, with a later-update line on unfinished ones', () => {
    const groups = moreRows({ level: 'advanced', trunkCount: 3, workingCount: 1, youName: 'Owner', youRole: 'Owner' });
    const rows = groups.flatMap((group) => group.rows);
    expect(rows.map((row) => row.id)).toEqual(['you', 'signin', 'canopy', 'people', 'automations', 'library', 'trunks', 'usage', 'settings', 'widgets']);
    expect(rows.find((row) => row.id === 'canopy')?.detail).toBe(laterUpdate('Canopy'));
    expect(rows.find((row) => row.id === 'trunks')?.detail).toBe('Each Trunk, its computer and its rules');
    expect(rows.find((row) => row.id === 'settings')?.action).toBe('settings');
  });
});

describe('more screen', () => {
  it('shows a short line under every row and opens Trunks and Settings', async () => {
    const { mocks } = await renderMore({ level: 'advanced' });
    expect(screen.getByRole('header')).toHaveTextContent('More');
    expect(screen.getByTestId('more-you')).toHaveTextContent(/Your name, picture and what this phone may do/);
    expect(screen.getByTestId('more-trunks')).toHaveTextContent(/Each Trunk, its computer and its rules/);
    expect(screen.getByTestId('more-settings')).toHaveTextContent(/Connection, voice, notifications and privacy/);
    expect(screen.getByTestId('more-canopy')).toHaveTextContent(/Canopy comes in a later update/);
    expect(within(screen.getByTestId('more-work')).getByText('3')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('more-you'));
    expect(mocks.onYou).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('more-trunks'));
    expect(mocks.onTrunks).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('more-settings'));
    expect(mocks.onSettings).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('more-back'));
    expect(mocks.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('more in the app', () => {
  it('is reachable from Chats, opens Settings and Trunks, and comes back', async () => {
    const { session } = await pairedApp();
    expect(screen.getByTestId('more-button')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('more-button'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('more-settings')).toBeOnTheScreen();
    expect(screen.getByTestId('more-you')).toBeOnTheScreen();
    expect(screen.queryByTestId('more-canopy')).toBeNull();

    await fireEvent.press(screen.getByTestId('more-settings'));
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('settings-back'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('more-you'));
    expect(screen.getByTestId('you-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('you-back'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('more-trunks'));
    expect(screen.getByTestId('agents-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('agents-back'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('more-back'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('shows unfinished More rows at Advanced', async () => {
    const { session } = await pairedApp({ showLevel: 'advanced' });
    await fireEvent.press(screen.getByTestId('more-button'));
    expect(screen.getByTestId('more-signin')).toHaveTextContent(/Sign in with KeepOak comes in a later update/);
    expect(screen.getByTestId('more-canopy')).toHaveTextContent(/1 working now/);
    expect(screen.getByTestId('more-widgets')).toHaveTextContent(/Widgets and lock screen comes in a later update/);
    session.dispose();
  });
});
