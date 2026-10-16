import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import App from '../../App';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { memoryStore } from '../storage/keyValueStore';
import { DESKTOP_THEMES } from '../theme/desktopThemes';
import { THEME_LOOK_KEY, THEME_PREFERENCE_KEY } from '../theme/preference';
import { ThemeProvider } from '../theme/ThemeProvider';
import { themeFor } from '../theme/tokens';
import { permissionLabel, SettingsScreen, LATER_ROWS, SETTINGS_GROUPS } from './SettingsScreen';
import { CHEER_DEFAULT, HELP_PAGES, PET_DEFAULT, laterRowsAt, laterUpdate } from './settingsExtras';

const eventually = (check: () => void) => waitFor(check, { timeout: 4000 });
jest.setTimeout(20_000);

const paired = {
  step: 'paired' as const,
  url: 'ws://paired.example:18765',
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
  await act(() => session.begin({ url: 'ws://paired.example:18765', bootstrapToken: 'boot-1' }));
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
    expect(screen.getByText('This Branch')).toBeOnTheScreen();
    expect(screen.getByText('Connected to your computer')).toBeOnTheScreen();
    expect(screen.getByText('paired.example:18765')).toBeOnTheScreen();
    expect(screen.getByText('2026.10.8')).toBeOnTheScreen();
    expect(screen.getByTestId('this-phone')).toHaveTextContent(/This phone/);
    expect(screen.getByTestId('about-card')).toHaveTextContent(/Your Trunks and Branch Agent, in your pocket/);
    expect(within(screen.getByTestId('about-card')).getByText('0.1.0 (14)')).toBeOnTheScreen();
    expect(within(screen.getByTestId('about-card')).getByText('KeepOak')).toBeOnTheScreen();
  });

  it('opens This phone (Your computer) and offers system Settings for notifications', async () => {
    const { mocks } = await renderSettings({ permission: 'denied' });
    expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent('Off');
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
    expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent('On');
    expect(screen.getByTestId('update-settings-card')).toBeOnTheScreen();
    expect(screen.getByTestId('apk-update-help')).toHaveTextContent(/checksum/);
    expect(screen.getByTestId('apk-update-help')).toHaveTextContent(/signing certificate/);
    expect(screen.getByTestId('apk-update-help')).toHaveTextContent(/install permission/);

    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(screen.getByTestId('paired-screen')).toBeOnTheScreen();
    expect(screen.getByText('Your computer')).toBeOnTheScreen();
    expect(screen.getByTestId('update-settings-card')).toBeOnTheScreen();
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
      await eventually(() => expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent('Off'));
      await fireEvent.press(screen.getByTestId('notifications-system-settings'));
      expect(open).toHaveBeenCalled();
      session.dispose();
    } finally {
      open.mockRestore();
    }
  });

  it('keeps Match this phone, Light or Dark on this phone and uses it on the next open', async () => {
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

describe('r50 settings parity', () => {
  it('hides the Settings scrollbar', async () => {
    await renderSettings();
    expect(screen.getByTestId('settings-screen-scroll')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('settings-screen-scroll')).toHaveProp('showsHorizontalScrollIndicator', false);
  });

  it('uses the desktop Regular groups plus Appearance', async () => {
    await renderSettings();
    expect([...SETTINGS_GROUPS]).toEqual(['General', 'Computer', 'Usage', 'Updates', 'Appearance']);
    expect(screen.getByTestId('general-card')).toHaveTextContent(/^General/);
    expect(screen.getByTestId('computer-card')).toHaveTextContent(/^Computer/);
    expect(screen.getByTestId('usage-card')).toHaveTextContent(/^Usage/);
    expect(screen.getByTestId('updates-card')).toHaveTextContent(/^Updates/);
    expect(screen.getByTestId('appearance-card')).toHaveTextContent(/^Appearance/);
  });

  it('hides unfinished rows at Regular, and never draws them as Off', async () => {
    await renderSettings();
    expect(laterRowsAt(0)).toEqual([]);
    for (const row of LATER_ROWS) {
      expect(screen.queryByTestId(row.testID)).toBeNull();
    }
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.queryByText(/comes in a later update/)).toBeNull();
  });

  it('shows later-update copy at Advanced, including Lend this phone to Branch', async () => {
    await renderSettings({ level: 1 });
    const advanced = laterRowsAt(1);
    expect(advanced.length).toBeGreaterThan(0);
    expect(advanced.some((row) => row.label === 'Lend this phone to Branch')).toBe(true);
    expect(screen.getByTestId('later-keepoak-reason')).toHaveTextContent('Sign in with KeepOak comes in a later update.');
    for (const row of advanced) {
      expect(screen.getByTestId(row.testID)).toBeOnTheScreen();
      expect(screen.getByTestId(`${row.testID}-reason`)).toHaveTextContent(laterUpdate(row.label));
      expect(screen.getByTestId(row.testID)).not.toHaveTextContent(/^Off$/);
    }
    expect(screen.queryByTestId('later-on-phone-engine')).toBeNull();
  });

  it('shows Technical rows only at Technical', async () => {
    await renderSettings({ level: 2 });
    expect(screen.getByTestId('later-on-phone-engine-reason')).toHaveTextContent(
      laterUpdate('Run Branch on this phone'),
    );
  });

  it('keeps pets and cheer off by default, and only names them at Advanced', async () => {
    expect(PET_DEFAULT).toBe('none');
    expect(CHEER_DEFAULT).toBe(false);
    await renderSettings();
    expect(screen.queryByTestId('later-pet')).toBeNull();
    expect(screen.queryByTestId('later-cheer')).toBeNull();
    await fireEvent.press(screen.getByTestId('settings-level-advanced'));
    expect(screen.getByTestId('later-pet-reason')).toHaveTextContent(laterUpdate('Pet'));
    expect(screen.getByTestId('later-cheer-reason')).toHaveTextContent(laterUpdate('Celebrate when a task finishes'));
  });

  it('offers the same desktop themes, with Branch Slate selected', async () => {
    await renderSettings();
    expect(DESKTOP_THEMES.map((theme) => theme.name)).toEqual(
      expect.arrayContaining(['Branch Slate', 'Paper', 'Knot', 'Forest', 'Dracula']),
    );
    expect(screen.getByTestId('settings-themes')).toHaveTextContent(/Branch Slate/);
    await fireEvent.press(screen.getByTestId('settings-themes'));
    expect(screen.getByRole('header')).toHaveTextContent('Theme');
    expect(screen.getByTestId('desktop-theme-grove')).toHaveProp('accessibilityState', { selected: true });
    expect(screen.getByTestId('desktop-theme-paper')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('desktop-theme-paper'));
    expect(screen.getByTestId('desktop-theme-paper')).toHaveProp('accessibilityState', { selected: true });
    await fireEvent.press(screen.getByTestId('settings-themes-back'));
    expect(screen.getByTestId('settings-themes')).toHaveTextContent(/Paper/);
  });

  it('keeps a chosen desktop theme on the next open', async () => {
    const store = memoryStore();
    const first = await pairedApp({ themeStore: store });
    await fireEvent.press(screen.getByTestId('settings-button'));
    await fireEvent.press(screen.getByTestId('settings-themes'));
    await fireEvent.press(screen.getByTestId('desktop-theme-beacon'));
    expect(store.dump()[THEME_LOOK_KEY]).toBe('beacon');
    first.session.dispose();
    await first.unmount();

    const second = await pairedApp({ themeStore: store });
    await fireEvent.press(screen.getByTestId('settings-button'));
    await eventually(() => expect(screen.getByTestId('settings-themes')).toHaveTextContent(/Beacon/));
    second.session.dispose();
  });

  it('opens Help and Language, with Same as this phone selected', async () => {
    await renderSettings();
    await fireEvent.press(screen.getByTestId('settings-language'));
    expect(screen.getByRole('header')).toHaveTextContent('Language');
    expect(screen.getByTestId('language-Same as this phone')).toHaveProp('accessibilityState', {
      selected: true,
      disabled: false,
    });
    expect(screen.queryByTestId('language-Français')).toBeNull();
    await fireEvent.press(screen.getByTestId('settings-language-back'));
    expect(screen.getByRole('header')).toHaveTextContent('Settings');

    await fireEvent.press(screen.getByTestId('settings-help'));
    expect(screen.getByRole('header')).toHaveTextContent('Help');
    await fireEvent.press(screen.getByTestId(`help-${HELP_PAGES[0].id}`));
    expect(screen.getByRole('header')).toHaveTextContent(HELP_PAGES[0].title);
    expect(screen.getByText(HELP_PAGES[0].paragraphs[0])).toBeOnTheScreen();
  });

  it('draws the theme picker and level control in black and white', async () => {
    await renderSettings();
    const style = screen.getByTestId('theme-system').props.style;
    const selected = StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style);
    expect(selected.backgroundColor).toBe(themeFor('light').color.ink);
    const level = screen.getByTestId('settings-level-regular').props.style;
    const levelOn = StyleSheet.flatten(typeof level === 'function' ? level({ pressed: false }) : level);
    expect(levelOn.backgroundColor).toBe(themeFor('light').color.ink);
  });

  it('uses desktop glass and radii on Settings groups', async () => {
    await renderSettings();
    const card = StyleSheet.flatten(screen.getByTestId('general-card-surface').props.style);
    expect(card.backgroundColor).toBe(themeFor('light').color.glass);
    expect(card.borderRadius).toBe(themeFor('light').radius.md);
  });
});
