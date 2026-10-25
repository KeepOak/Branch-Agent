import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import { EMPTY_SELF, FAILED_SELF, type SelfProfile } from '../people/self';
import { YouScreen } from './YouScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const owner: SelfProfile = { id: 'gateway-owner', name: 'Owner', emails: [], role: 'Owner', owner: true, hasAvatar: false };

async function renderYou(extra: Partial<Parameters<typeof YouScreen>[0]> = {}) {
  const mocks = { onComputer: jest.fn(), onBack: jest.fn(), onRename: jest.fn(async () => undefined) };
  await render(
    <ThemeProvider scheme="light">
      <YouScreen
        self={owner}
        level="regular"
        scopes={['operator.read', 'operator.write']}
        computer="computer.local:19031"
        computerStatus="Connected to your computer"
        {...mocks}
        {...extra}
      />
    </ThemeProvider>,
  );
  return { mocks };
}

async function pairedApp(
  extra: Parameters<typeof App>[0] = {},
  engineExtra: Parameters<typeof createFakeEngine>[0] = {},
  beforePair?: (engine: ReturnType<typeof createFakeEngine>) => void,
) {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents, ...engineExtra });
  beforePair?.(engine);
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

describe('you screen', () => {
  it('shows the person, a short line under every row, and opens This Branch', async () => {
    const { mocks } = await renderYou({ level: 'advanced' });
    expect(screen.getByTestId('you-name')).toHaveTextContent('Owner');
    expect(screen.getByTestId('you-role')).toHaveTextContent('Owner');
    expect(screen.getByTestId('you-row-access')).toHaveTextContent(/You may send messages and make changes/);
    expect(screen.getByTestId('you-row-picture')).toHaveTextContent(/Your picture comes in a later update/);
    expect(screen.getByTestId('you-row-computer')).toHaveTextContent(/computer\.local:19031/);
    await fireEvent.press(screen.getByTestId('you-row-computer'));
    expect(mocks.onComputer).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('you-back'));
    expect(mocks.onBack).toHaveBeenCalledTimes(1);
  });

  it('shows your picture as later-update at Regular and does not invent an email', async () => {
    await renderYou();
    expect(screen.getByTestId('you-row-picture')).toHaveTextContent(/Your picture comes in a later update/);
    expect(screen.queryByTestId('you-row-instructions')).toBeNull();
    expect(screen.queryByTestId('you-row-emails')).toBeNull();
    expect(screen.getByTestId('you-name')).toHaveTextContent('Owner');
    expect(screen.getByTestId('you-screen-scroll')).toHaveProp('showsVerticalScrollIndicator', false);
  });

  it('saves a new name through onRename', async () => {
    const { mocks } = await renderYou();
    await fireEvent.press(screen.getByTestId('you-name-change'));
    await fireEvent.changeText(screen.getByTestId('you-name-input'), 'Ada');
    await fireEvent.press(screen.getByTestId('you-name-save'));
    await waitFor(() => expect(mocks.onRename).toHaveBeenCalledWith('Ada'));
  });

  it('says why name change is off when there is no profile id', async () => {
    await renderYou({ self: EMPTY_SELF, onRename: undefined });
    expect(screen.getByTestId('you-name-disabled')).toHaveTextContent(/signed-in profile/);
    expect(screen.queryByTestId('you-name-change')).toBeNull();
  });

  it('shows a plain save failure, never raw exception text', async () => {
    const onRename = jest.fn(async () => {
      throw new Error('users.setDisplayName: ECONNREFUSED at EngineLink.request');
    });
    await renderYou({ onRename });
    await fireEvent.press(screen.getByTestId('you-name-change'));
    await fireEvent.changeText(screen.getByTestId('you-name-input'), 'Ada');
    await fireEvent.press(screen.getByTestId('you-name-save'));
    await waitFor(() => expect(screen.getByTestId('you-name-error')).toBeOnTheScreen());
    expect(screen.getByTestId('you-name-error')).toHaveTextContent(/Can’t reach Branch|Couldn’t save your name|That didn’t work/);
    expect(screen.getByTestId('you-name-error')).not.toHaveTextContent(/ECONNREFUSED|EngineLink|setDisplayName/);
  });

  it('shows Couldn’t load with an empty name when users.self failed', async () => {
    const onRetry = jest.fn();
    await renderYou({ self: FAILED_SELF, loadFailed: true, onRename: undefined, onRetry });
    expect(screen.getByTestId('you-name')).not.toHaveTextContent('Owner');
    expect(screen.getByTestId('you-load-error')).toHaveTextContent('Couldn’t load');
    expect(screen.queryByTestId('you-name-change')).toBeNull();
    expect(screen.queryByTestId('you-name-disabled')).toBeNull();
    await fireEvent.press(screen.getByTestId('you-load-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('you in the app', () => {
  it('opens from More, opens This Branch, and comes back', async () => {
    const { session } = await pairedApp();
    await fireEvent.press(screen.getByTestId('more-button'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();
    await eventually(() => expect(screen.getByTestId('more-you')).toHaveTextContent(/Owner/));
    await fireEvent.press(screen.getByTestId('more-you'));
    expect(screen.getByTestId('you-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('you-name')).toHaveTextContent('Owner');
    expect(screen.getByTestId('you-row-access')).toHaveTextContent(/You may send messages and make changes/);
    expect(screen.getByTestId('you-row-picture')).toHaveTextContent(/Your picture comes in a later update/);
    expect(screen.getByTestId('you-row-computer')).toHaveTextContent(/This computer/);
    expect(screen.queryByTestId('you-row-instructions')).toBeNull();

    await fireEvent.press(screen.getByTestId('you-row-computer'));
    expect(screen.getByTestId('computers-screen')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('computers-back'));
    expect(screen.getByTestId('you-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('you-back'));
    expect(screen.getByTestId('more-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('opens from Home, saves a real name, and does not invent KeepOak copy', async () => {
    const { session, engine } = await pairedApp({ showLevel: 'advanced' });
    await fireEvent.press(screen.getByTestId('place-home'));
    await eventually(() => expect(screen.getByTestId('home-screen')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('home-you'));
    expect(screen.getByTestId('you-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('you-row-picture')).toHaveTextContent(/Your picture comes in a later update/);
    expect(screen.queryByTestId('you-screen')).not.toHaveTextContent(/keepoak|Hartwell|Taofik/i);

    await fireEvent.press(screen.getByTestId('you-name-change'));
    await fireEvent.changeText(screen.getByTestId('you-name-input'), 'Ada');
    await fireEvent.press(screen.getByTestId('you-name-save'));
    await eventually(() => expect(screen.getByTestId('you-name')).toHaveTextContent('Ada'));
    expect(engine.requests.some((r) => r.method === 'users.setDisplayName')).toBe(true);

    await fireEvent.press(screen.getByTestId('you-back'));
    expect(screen.getByTestId('home-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('does not fall back to Owner when users.self fails, and Try again reloads', async () => {
    const { session, engine } = await pairedApp({}, {}, (eng) => {
      eng.failMethod('users.self', 'users.self: ECONNREFUSED at EngineLink.request');
    });
    await fireEvent.press(screen.getByTestId('more-button'));
    await eventually(() => expect(screen.getByTestId('more-you')).not.toHaveTextContent(/Owner/));
    await fireEvent.press(screen.getByTestId('more-you'));
    expect(screen.getByTestId('you-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('you-load-error')).toHaveTextContent('Couldn’t load');
    expect(screen.getByTestId('you-name')).not.toHaveTextContent('Owner');
    expect(screen.getByTestId('you-screen')).not.toHaveTextContent(/ECONNREFUSED|EngineLink/);

    engine.failMethod('users.self', null);
    await fireEvent.press(screen.getByTestId('you-load-retry'));
    await eventually(() => expect(screen.getByTestId('you-name')).toHaveTextContent('Owner'));
    expect(screen.queryByTestId('you-load-error')).toBeNull();
    session.dispose();
  });

  it('shows a plain rename failure from the engine, never raw text', async () => {
    const { session, engine } = await pairedApp();
    engine.failMethod('users.setDisplayName', 'users.setDisplayName: ECONNREFUSED at EngineLink.request');
    await fireEvent.press(screen.getByTestId('more-button'));
    await fireEvent.press(screen.getByTestId('more-you'));
    await fireEvent.press(screen.getByTestId('you-name-change'));
    await fireEvent.changeText(screen.getByTestId('you-name-input'), 'Ada');
    await fireEvent.press(screen.getByTestId('you-name-save'));
    await waitFor(() => expect(screen.getByTestId('you-name-error')).toBeOnTheScreen());
    expect(screen.getByTestId('you-name-error')).toHaveTextContent(/Can’t reach Branch|Couldn’t save your name|That didn’t work/);
    expect(screen.getByTestId('you-name-error')).not.toHaveTextContent(/ECONNREFUSED|EngineLink|setDisplayName/);
    session.dispose();
  });
});
