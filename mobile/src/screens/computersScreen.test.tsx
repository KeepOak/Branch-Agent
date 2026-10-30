import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { createFakeSession } from '../testing/fakeSession';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { FIXTURE_NOW, fixtureEnvironments } from '../testing/computerFixtures';
import { computerRows, type ComputerListSnapshot } from '../computers/computerList';
import { computerLine, ComputersScreen } from './ComputersScreen';
import { ThemeProvider } from '../theme/ThemeProvider';

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });
const rows = computerRows({ environments: fixtureEnvironments });

function renderList(list: ComputerListSnapshot, online = true, extra: Partial<Parameters<typeof ComputersScreen>[0]> = {}) {
  return render(
    <ThemeProvider scheme="light">
      <ComputersScreen list={list} online={online} onRefresh={async () => undefined} onBack={() => undefined} now={FIXTURE_NOW} {...extra} />
    </ThemeProvider>,
  );
}

async function pairedApp(environments = fixtureEnvironments) {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, environments });
  const { session } = createFakeSession(engine);
  await render(<App scheme="dark" session={session} />);
  await act(() => session.begin({ url: 'ws://computer.local:19031', bootstrapToken: 'boot-1' }));
  engine.approve();
  await eventually(() => expect(screen.getByTestId('chat-agent:main:main')).toBeOnTheScreen());
  return { session, engine };
}

describe('computers screen', () => {
  it('shows each computer’s name and online or offline status, and never a write action', async () => {
    await renderList({ rows, loaded: true, error: null });
    const host = within(screen.getByTestId('computer-gateway'));
    expect(host.getByText('This computer')).toBeOnTheScreen();
    expect(host.getByText('Online · macOS')).toBeOnTheScreen();
    expect(within(screen.getByTestId('computer-node:home')).getByText('Home server')).toBeOnTheScreen();
    expect(within(screen.getByTestId('computer-node:home')).getByText('Online · Linux')).toBeOnTheScreen();
    expect(within(screen.getByTestId('computer-node:studio')).getByText('Studio')).toBeOnTheScreen();
    expect(within(screen.getByTestId('computer-node:studio')).getByText('Offline since Sunday · Windows')).toBeOnTheScreen();
    expect(computerLine(rows[2], FIXTURE_NOW)).toBe('Offline since Sunday · Windows');
    expect(screen.queryByText('Manage')).toBeNull();
    expect(screen.queryByText('Add a computer')).toBeNull();
    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.queryByText('Unpair')).toBeNull();
    expect(screen.queryByTestId('unpair')).toBeNull();
  });

  it('says there are no computers yet, and why a read failed with a way to try again', async () => {
    await renderList({ rows: [], loaded: false, error: null });
    expect(screen.getByTestId('computers-loading')).toBeOnTheScreen();
    await renderList({ rows: [], loaded: true, error: null });
    expect(screen.getByTestId('computers-empty')).toBeOnTheScreen();
    const onRefresh = jest.fn(async () => undefined);
    await renderList({ rows: [], loaded: false, error: "Can't reach Branch. Check your connection." }, true, { onRefresh });
    expect(screen.getByTestId('computers-error')).toHaveTextContent(/Can't reach Branch/);
    await fireEvent.press(screen.getByTestId('computers-error-action'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await renderList({ rows: [], loaded: false, error: 'not connected' }, false);
    expect(screen.getByTestId('computers-waiting')).toBeOnTheScreen();
  });

  it('opens from Chats, follows status live, and goes to This phone and back', async () => {
    const { session, engine } = await pairedApp();
    expect(screen.getByTestId('computer-button')).toHaveProp('accessibilityLabel', 'Computers, connected');
    await fireEvent.press(screen.getByTestId('computer-button'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    expect(screen.getByText('This computer')).toBeOnTheScreen();
    expect(screen.getByText('Home server')).toBeOnTheScreen();
    expect(screen.queryByText('Manage')).toBeNull();

    engine.setEnvironments(fixtureEnvironments.map((row) => (row.id === 'node:home' ? { ...row, status: 'unavailable' } : row)));
    engine.emit('environments.changed', {});
    await eventually(() => expect(within(screen.getByTestId('computer-node:home')).getByText(/Offline/)).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(screen.getByText('Your computer')).toBeOnTheScreen();
    expect(screen.getByTestId('unpair')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('back-to-chats'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
  });
});
