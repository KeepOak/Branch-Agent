import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import App from '../../App';
import { appIdentity } from '../build/appIdentity';
import { createFakeEngine } from '../connect/fakeEngine';
import { fixtureAgents, fixtureSessions } from '../testing/chatFixtures';
import { createFakeAppState, createFakeNotifier } from '../testing/fakeNotifier';
import { createFakeSession } from '../testing/fakeSession';
import { memoryStore } from '../storage/keyValueStore';
import { SHOW_LEVEL_KEY } from '../settings/showLevel';
import { CYCLE_LABEL, PHONE_PREFS_DEFAULT } from '../settings/phonePrefs';
import { DESKTOP_THEMES } from '../theme/desktopThemes';
import { THEME_LOOK_KEY, THEME_PREFERENCE_KEY } from '../theme/preference';
import { ThemeProvider } from '../theme/ThemeProvider';
import { themeFor } from '../theme/tokens';
import { permissionLabel, SettingsScreen, SETTINGS_GROUPS } from './SettingsScreen';
import {
  ASSISTANT_REASON,
  HELP_PAGES,
  KEEPOAK_SIGN_IN,
  KEEPOAK_SIGN_IN_REASON,
  RUN_ON_PHONE,
  RUN_ON_PHONE_REASON,
} from './settingsExtras';

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
    onConnectAnother: jest.fn(),
    onForget: jest.fn(),
    onSetupTalk: jest.fn(),
    onAskHelp: jest.fn(),
    onBack: jest.fn(),
  };
  await render(
    <ThemeProvider scheme="light">
      <SettingsScreen
        state={paired}
        permission="granted"
        identity={{ version: '0.1.0', build: '14' }}
        computerTitle="This computer · macOS"
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
  it('shows Branch Agent, the paired computer, and About', async () => {
    await renderSettings();
    expect(screen.getByRole('header')).toHaveTextContent('Settings');
    expect(screen.getByText('This computer · macOS')).toBeOnTheScreen();
    expect(screen.getByText('Connected to your computer')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-about')).toHaveTextContent(/0\.1\.0/);
    await fireEvent.press(screen.getByTestId('settings-about'));
    expect(screen.getByRole('header')).toHaveTextContent('About');
    expect(within(screen.getByTestId('app-card')).getByText('0.1.0')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).getByText('14')).toBeOnTheScreen();
    expect(screen.getByTestId('about-card')).toHaveTextContent(/Your Trunks and Branch Agent, in your pocket/);
    expect(within(screen.getByTestId('about-card')).getByText('0.1.0 (14)')).toBeOnTheScreen();
    expect(within(screen.getByTestId('about-card')).getByText('KeepOak')).toBeOnTheScreen();
    expect(within(screen.getByTestId('about-card')).getByText('2026.10.8')).toBeOnTheScreen();
  });

  it('shows the installed APK version, not the hardcoded 0.1.0 / Build 1 template', async () => {
    const identity = appIdentity({
      expoConfig: { version: '0.1.0', android: { versionCode: 1 }, ios: { buildNumber: '1' } },
      nativeAppVersion: '0.4.4-build-e5d86fab32b5',
      nativeBuildVersion: '12',
    });
    expect(identity).toEqual({ version: '0.4.4-build-e5d86fab32b5', build: '12' });
    expect(identity).not.toEqual({ version: '0.1.0', build: '1' });
    await renderSettings({ identity });
    expect(screen.getByTestId('settings-about')).toHaveTextContent(/0\.4\.4-build-e5d86fab32b5/);
    expect(screen.getByTestId('settings-about')).not.toHaveTextContent(/0\.1\.0/);
    await fireEvent.press(screen.getByTestId('settings-about'));
    expect(within(screen.getByTestId('app-card')).getByText('0.4.4-build-e5d86fab32b5')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).getByText('12')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).queryByText('0.1.0')).toBeNull();
    expect(within(screen.getByTestId('about-card')).getByText('0.4.4-build-e5d86fab32b5 (12)')).toBeOnTheScreen();
  });

  it('opens This phone from This Branch and offers system Settings on Notifications', async () => {
    const { mocks } = await renderSettings({ permission: 'denied' });
    await fireEvent.press(screen.getByTestId('this-branch-row'));
    await fireEvent.press(screen.getByTestId('this-phone'));
    expect(mocks.onThisPhone).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('settings-thisbranch-back'));
    await fireEvent.press(screen.getByTestId('settings-notif'));
    expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent('Off');
    await fireEvent.press(screen.getByTestId('notifications-system-settings'));
    expect(mocks.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('asks to turn notifications on when the phone has not decided yet', async () => {
    const asking = await renderSettings({ permission: 'undetermined' });
    await fireEvent.press(screen.getByTestId('settings-notif'));
    expect(screen.getByText('Not yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('settings-notifications-turn-on'));
    expect(asking.mocks.onTurnOnNotifications).toHaveBeenCalledTimes(1);
  });

  it('says notifications need the installed app, with no system Settings button', async () => {
    await renderSettings({ permission: 'unavailable' });
    await fireEvent.press(screen.getByTestId('settings-notif'));
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
    await fireEvent.press(screen.getByTestId('settings-about'));
    expect(within(screen.getByTestId('app-card')).getByText('0.1.0')).toBeOnTheScreen();
    expect(within(screen.getByTestId('app-card')).getByText('14')).toBeOnTheScreen();
    expect(screen.getByTestId('update-settings-card')).toBeOnTheScreen();
    expect(screen.getByTestId('apk-update-help')).toHaveTextContent(/checksum/);
    expect(screen.getByTestId('apk-update-help')).toHaveTextContent(/signing certificate/);
    expect(screen.getByTestId('apk-update-help')).toHaveTextContent(/install permission/);
    await fireEvent.press(screen.getByTestId('settings-about-back'));

    await fireEvent.press(screen.getByTestId('settings-notif'));
    expect(screen.getByTestId('settings-notifications-status')).toHaveTextContent('On');
    await fireEvent.press(screen.getByTestId('settings-notif-back'));

    await fireEvent.press(screen.getByTestId('this-branch-row'));
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
      await fireEvent.press(screen.getByTestId('settings-notif'));
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

  it('keeps Advanced after a change, and More still shows unfinished rows on the next open', async () => {
    const store = memoryStore();
    const first = await pairedApp({ themeStore: store });
    await fireEvent.press(screen.getByTestId('settings-button'));
    await fireEvent.press(screen.getByTestId('settings-level-advanced'));
    expect(store.dump()[SHOW_LEVEL_KEY]).toBe('advanced');
    expect(screen.getByTestId('settings-level-advanced')).toHaveProp('accessibilityState', { selected: true });
    await eventually(() => expect(screen.getByTestId('settings-mic')).toBeOnTheScreen());
    first.session.dispose();
    await first.unmount();

    const second = await pairedApp({ themeStore: store });
    await fireEvent.press(screen.getByTestId('more-button'));
    await eventually(() => expect(screen.getByTestId('more-canopy')).toBeOnTheScreen());
    expect(screen.getByTestId('more-canopy')).toHaveTextContent(/Canopy comes in a later update/);
    second.session.dispose();
  });
});

describe('r50 settings parity', () => {
  it('hides the Settings scrollbar', async () => {
    await renderSettings();
    expect(screen.getByTestId('settings-screen-scroll')).toHaveProp('showsVerticalScrollIndicator', false);
    expect(screen.getByTestId('settings-screen-scroll')).toHaveProp('showsHorizontalScrollIndicator', false);
  });

  it('uses the r50 phone groups This Branch, Your assistant, On this phone and Voice', async () => {
    await renderSettings();
    expect([...SETTINGS_GROUPS]).toEqual([
      'This Branch',
      'Your assistant',
      'Connections',
      'On this phone',
      'This phone, more',
      'Voice',
    ]);
    expect(screen.getByTestId('this-branch')).toHaveTextContent(/^This Branch/);
    expect(screen.getByTestId('assistant-card')).toHaveTextContent(/^Your assistant/);
    expect(screen.getByTestId('connections-card')).toHaveTextContent(/^Connections/);
    expect(screen.getByTestId('on-phone-card')).toHaveTextContent(/^On this phone/);
    expect(screen.getByTestId('phone-more-card')).toHaveTextContent(/^This phone, more/);
    expect(screen.getByTestId('voice-card')).toHaveTextContent(/^Voice/);
  });

  it('never writes later-update or coming-soon copy, and names Branch Agent', async () => {
    await renderSettings();
    expect(screen.queryByText(/comes in a later update/)).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.getByText(KEEPOAK_SIGN_IN)).toBeOnTheScreen();
    expect(screen.getByTestId('later-keepoak-reason')).toHaveTextContent(KEEPOAK_SIGN_IN_REASON);
    expect(screen.getByText('Lend this phone to Branch Agent')).toBeOnTheScreen();
    expect(screen.getByText('Forget this Branch Agent')).toBeOnTheScreen();
    expect(screen.getByText('Lock with fingerprint')).toBeOnTheScreen();
    expect(screen.getByText(RUN_ON_PHONE)).toBeOnTheScreen();
    expect(screen.getByTestId('settings-run-on-phone-reason')).toHaveTextContent(RUN_ON_PHONE_REASON);
    expect(screen.getByTestId('settings-chatapps')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-models')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-skills')).toBeOnTheScreen();
    expect(screen.queryByText(/^Branch$/)).toBeNull();
  });

  it('hides Advanced rows at Regular, including Microphone and Reset', async () => {
    await renderSettings();
    expect(screen.queryByTestId('settings-mic')).toBeNull();
    expect(screen.queryByTestId('settings-assistant')).toBeNull();
    expect(screen.queryByTestId('settings-talk-bg')).toBeNull();
    expect(screen.queryByTestId('settings-reset')).toBeNull();
    expect(screen.queryByText('Push to talk from Branch Agent')).toBeNull();
  });

  it('shows real Advanced rows, not later-update stubs', async () => {
    await renderSettings({ level: 1 });
    expect(screen.queryByText(/comes in a later update/)).toBeNull();
    expect(screen.getByTestId('later-lend')).toBeOnTheScreen();
    expect(screen.getByTestId('later-lend')).not.toHaveTextContent(/later update/);
    expect(screen.getByTestId('settings-mic')).toBeOnTheScreen();
    expect(screen.getByText(ASSISTANT_REASON)).toBeOnTheScreen();
    expect(screen.getByTestId('settings-talk-bg')).toBeOnTheScreen();
    expect(screen.getByText('Push to talk from Branch Agent')).toBeOnTheScreen();
    expect(screen.getByText('Live talk')).toBeOnTheScreen();
    expect(screen.getByText('Dictation')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-reset')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('this-branch-row'));
    expect(screen.getByTestId('settings-auto-conn')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-checks')).toBeOnTheScreen();
    expect(screen.getByTestId('settings-connection')).toBeOnTheScreen();
  });

  it('cycles On / When needed / Off on Regular phone rows', async () => {
    await renderSettings();
    expect(screen.getByTestId('settings-lock-value')).toHaveTextContent(CYCLE_LABEL[PHONE_PREFS_DEFAULT.lock]);
    await fireEvent.press(screen.getByTestId('settings-lock'));
    expect(screen.getByTestId('settings-lock-value')).toHaveTextContent('When needed');
    await fireEvent.press(screen.getByTestId('settings-lock'));
    expect(screen.getByTestId('settings-lock-value')).toHaveTextContent('On');
    expect(screen.getByTestId('settings-awake')).toHaveProp('accessibilityState', { checked: true });
    await fireEvent.press(screen.getByTestId('settings-awake'));
    expect(screen.getByTestId('settings-awake')).toHaveProp('accessibilityState', { checked: false });
  });

  it('plays Test sound and opens Lend this phone', async () => {
    const { mocks } = await renderSettings();
    await fireEvent.press(screen.getByTestId('settings-test-sound'));
    expect(screen.getByTestId('settings-test-sound-played')).toHaveTextContent('Played on this phone.');
    await fireEvent.press(screen.getByTestId('later-lend'));
    expect(screen.getByRole('header')).toHaveTextContent('Lend this phone');
    expect(screen.getByTestId('lend-cam')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('lend-toggle'));
    expect(screen.getByText('Lend this phone to Branch Agent')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('settings-lend-back'));
    await fireEvent.press(screen.getByTestId('settings-setup-talk'));
    expect(mocks.onSetupTalk).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('settings-connect-another'));
    expect(mocks.onConnectAnother).toHaveBeenCalledTimes(1);
  });

  it('forgets this Branch Agent after a confirm', async () => {
    const { mocks } = await renderSettings();
    await fireEvent.press(screen.getByTestId('settings-forget'));
    expect(screen.getByTestId('forget-ask')).toHaveTextContent(/Forget this Branch Agent/);
    await fireEvent.press(screen.getByTestId('forget-ask-yes'));
    expect(mocks.onForget).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId('language-English')).toBeOnTheScreen();
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
    const card = StyleSheet.flatten(screen.getByTestId('this-branch-surface').props.style);
    expect(card.backgroundColor).toBe(themeFor('light').color.glass);
    expect(card.borderRadius).toBe(themeFor('light').radius.md);
  });
});
