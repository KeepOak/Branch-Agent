import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { memoryStore } from '../storage/keyValueStore';
import { THEME_PREFERENCE_KEY } from '../theme/preference';
import { ThemeProvider } from '../theme/ThemeProvider';
import { themeFor } from '../theme/tokens';
import { permissionLabel, SettingsScreen } from './SettingsScreen';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const paired = {
  step: 'paired' as const,
  url: 'ws://computer.local:19031',
  online: true,
  serverVersion: '2026.10.8',
};

async function renderSettings(extra: Partial<Parameters<typeof SettingsScreen>[0]> = {}) {
  const mocks = {
    onThisPhone: jest.fn(),
    onOpenSettings: jest.fn(),
    onTurnOnNotifications: jest.fn(),
    onBack: jest.fn(),
  };
  await render(
    <ThemeProvider scheme="light">
      <SettingsScreen
        state={paired}
        permission="granted"
        identity={{ version: '0.1.0', build: '14' }}
        {...mocks}
        {...extra}
      />
    </ThemeProvider>,
  );
  return { mocks };
}

async function pairedApp(extra: Parameters<typeof App>[0] = {}) {
  const engine = createFakeEngine({ sessions: fixtureSessions, agents: fixtureAgents });
  const { session } = createFakeSession(engine);
  const fake = createFakeNotifier('granted');
  const view = await render(
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
  return { session, engine, fake, unmount: view.unmount };
}

describe('permission labels', () => {
  it('says On, Off, Not yet, or that the installed app is needed', () => {
    expect(permissionLabel('granted')).toBe('On');
    expect(permissionLabel('denied')).toBe('Off');
    expect(permissionLabel('undetermined')).toBe('Not yet');
    expect(permissionLabel('unavailable')).toBe('Need the installed app');
    expect(permissionLabel(null)).toBe('Checking…');
  });
});

describe('settings screen', () => {
  it('shows the app version and build, the paired computer, and About', async () => {
    await renderSettings();
    expect(screen.getByRole('header')).toHaveTextContent('Settings');
    expect(within(screen.getByTestId('app-card')).getByText('0.1.0')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).getByText('14')).toBeOnTheScreen();
    expect(screen.getByText('Connected to your computer')).toBeOnTheScreen();
    expect(screen.getByText('computer.local:19031')).toBeOnTheScreen();
    expect(screen.getByText('2026.10.8')).toBeOnTheScreen();
    expect(screen.getByTestId('this-phone')).toHaveTextContent(/This phone/);
    expect(screen.getByTestId('about-card')).toHaveTextContent(/Your Trunks and Branch Agent, in your pocket/);
    expect(within(screen.getByTestId('about-card')).getByText('0.1.0 (14)')).toBeOnTheScreen();
    expect(within(screen.getByTestId('about-card')).getByText('KeepOak')).toBeOnTheScreen();
  });

  it('opens This phone (Your computer) and offers system Settings for notifications', async () => {
    const { mocks } = await renderSettings({ permission: 'denied' });
    expect(screen.getByText('Off')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(mocks.onThisPhone).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('notifications-system-settings'));
    expect(mocks.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('asks to turn notifications on when the phone has not decided yet', async () => {
    const asking = await renderSettings({ permission: 'undetermined' });
    expect(screen.getByText('Not yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('settings-notifications-turn-on'));
    expect(asking.mocks.onTurnOnNotifications).toHaveBeenCalledTimes(1);
  });

  it('says notifications need the installed app, with no system Settings button', async () => {
    await renderSettings({ permission: 'unavailable' });
    expect(screen.getByTestId('settings-notifications-unavailable')).toBeOnTheScreen();
    expect(screen.queryByTestId('notifications-system-settings')).toBeNull();
  });
});

describe('settings in the app', () => {
  it('is reachable from Chats, opens This phone, and comes back', async () => {
    const { session } = await pairedApp();
    expect(screen.getByTestId('settings-button')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).getByText('0.1.0')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).getByText('14')).toBeOnTheScreen();
    expect(screen.getByText('On')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(screen.getByTestId('paired-screen')).toBeOnTheScreen();
    expect(screen.getByText('Your computer')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('back-to-settings'));
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('settings-back'));
    expect(screen.getByTestId('chats-screen')).toBeOnTheScreen();
    session.dispose();
  });

  it('opens the system settings from the notifications row', async () => {
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    try {
      const fake = createFakeNotifier('denied');
      const { session } = await pairedApp({ notifier: fake.notifier });
      await fireEvent.press(screen.getByTestId('settings-button'));
      await eventually(() => expect(screen.getByText('Off')).toBeOnTheScreen());
      await fireEvent.press(screen.getByTestId('notifications-system-settings'));
      expect(open).toHaveBeenCalled();
      session.dispose();
    } finally {
      open.mockRestore();
    }
  });

  it('keeps System, Light or Dark on this phone and uses it on the next open', async () => {
    const store = memoryStore();
    const first = await pairedApp({ themeStore: store });
    await fireEvent.press(screen.getByTestId('settings-button'));
    await fireEvent.press(screen.getByTestId('theme-dark'));
    expect(store.dump()[THEME_PREFERENCE_KEY]).toBe('dark');
    expect(StyleSheet.flatten(screen.getByTestId('settings-screen').props.style).backgroundColor).toBe(
      themeFor('dark').color.grouped,
    );
    first.session.dispose();
    await first.unmount();

    const second = await pairedApp({ themeStore: store });
    await fireEvent.press(screen.getByTestId('settings-button'));
    await eventually(() =>
      expect(StyleSheet.flatten(screen.getByTestId('settings-screen').props.style).backgroundColor).toBe(
        themeFor('dark').color.grouped,
      ),
    );
    expect(screen.getByTestId('theme-dark')).toHaveProp('accessibilityState', { selected: true });
    await fireEvent.press(screen.getByTestId('theme-system'));
    expect(store.dump()[THEME_PREFERENCE_KEY]).toBeUndefined();
    second.session.dispose();
  });
});
