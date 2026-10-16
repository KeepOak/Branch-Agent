/** Android Settings catalogue: desktop Regular groups plus Appearance, later-update rows, Help. */

export type SettingsLevel = 0 | 1 | 2;
export type SettingsGroup = 'General' | 'Computer' | 'Usage' | 'Updates' | 'Appearance';

export const SETTINGS_GROUPS: readonly SettingsGroup[] = ['General', 'Computer', 'Usage', 'Updates', 'Appearance'];

/** Copied from the desktop Settings frame (Regular / Advanced / Technical). */
export const SETTINGS_LEVELS: { v: SettingsLevel; label: string; line: string }[] = [
  { v: 0, label: 'Regular', line: 'The essentials, in plain words.' },
  { v: 1, label: 'Advanced', line: 'Every feature and the fine controls.' },
  { v: 2, label: 'Technical', line: 'File paths, raw keys, launch variables, config and logs.' },
];

export const SETTINGS_LEVEL_KEY = 'branch.level';

export function parseSettingsLevel(value: string | null | undefined): SettingsLevel {
  if (value === 'advanced' || value === '1') return 1;
  if (value === 'technical' || value === '2') return 2;
  return 0;
}

export function settingsLevelWord(level: SettingsLevel): string {
  return SETTINGS_LEVELS[level]?.label ?? 'Regular';
}

export function laterUpdate(label: string): string {
  return `${label} comes in a later update.`;
}

/** Pairing restore that has no backend yet. Shown only at Advanced and above; never as a working sign-in. */
export const KEEPOAK_SIGN_IN = 'Sign in with KeepOak';

export type LaterRow = {
  testID: string;
  label: string;
  group: SettingsGroup;
  minLevel: 1 | 2;
};

/** Unfinished rows. Regular never shows them; Advanced and Technical show the later-update line. */
export const LATER_ROWS: LaterRow[] = [
  { testID: 'later-setup-talk', label: 'Set up and fix by talking', group: 'General', minLevel: 1 },
  { testID: 'later-talk', label: 'Talk button', group: 'General', minLevel: 1 },
  { testID: 'later-wake', label: 'Listen for the wake word', group: 'General', minLevel: 1 },
  { testID: 'later-talk-bg', label: 'Keep talking in the background', group: 'General', minLevel: 1 },
  { testID: 'later-speaker', label: 'Use speakerphone', group: 'General', minLevel: 1 },
  { testID: 'later-test-sound', label: 'Test sound', group: 'General', minLevel: 1 },
  { testID: 'later-haptics', label: 'Vibrate on taps', group: 'General', minLevel: 1 },
  { testID: 'later-lock', label: 'Lock with fingerprint', group: 'General', minLevel: 1 },
  { testID: 'later-share', label: 'Send to Branch from other apps', group: 'General', minLevel: 1 },
  { testID: 'later-push', label: 'Alerts while the app is closed', group: 'General', minLevel: 1 },
  { testID: 'later-awake', label: 'Keep the screen awake', group: 'General', minLevel: 1 },
  { testID: 'later-assistant', label: 'Use as the phone’s assistant', group: 'General', minLevel: 1 },

  { testID: 'later-lend', label: 'Lend this phone to Branch', group: 'Computer', minLevel: 1 },
  { testID: 'later-connect-another', label: 'Connect another Branch', group: 'Computer', minLevel: 1 },
  { testID: 'later-on-phone-engine', label: 'Run Branch on this phone', group: 'Computer', minLevel: 2 },

  { testID: 'later-keepoak', label: KEEPOAK_SIGN_IN, group: 'Usage', minLevel: 1 },
  { testID: 'later-accounts', label: 'Accounts', group: 'Usage', minLevel: 1 },
  { testID: 'later-models', label: 'Models on this computer', group: 'Usage', minLevel: 1 },
  { testID: 'later-chat-apps', label: 'Chat apps', group: 'Usage', minLevel: 1 },
  { testID: 'later-skills', label: 'Skills', group: 'Usage', minLevel: 1 },
  { testID: 'later-signins', label: 'Sign-ins & keys', group: 'Usage', minLevel: 1 },
  { testID: 'later-privacy', label: 'Privacy & data', group: 'Usage', minLevel: 1 },

  { testID: 'later-history', label: 'History', group: 'Updates', minLevel: 1 },
  { testID: 'later-learning', label: 'Learning', group: 'Updates', minLevel: 1 },
  { testID: 'later-features', label: 'Features', group: 'Updates', minLevel: 1 },

  { testID: 'later-pet', label: 'Pet', group: 'Appearance', minLevel: 1 },
  { testID: 'later-cheer', label: 'Celebrate when a task finishes', group: 'Appearance', minLevel: 1 },
  { testID: 'later-text-size', label: 'Text size', group: 'Appearance', minLevel: 1 },
  { testID: 'later-other-languages', label: 'Other languages', group: 'Appearance', minLevel: 1 },
  { testID: 'later-make-theme', label: 'Make your own theme', group: 'Appearance', minLevel: 1 },
];

export function laterRowsAt(level: SettingsLevel, group?: SettingsGroup): LaterRow[] {
  return LATER_ROWS.filter((row) => row.minLevel <= level && (group === undefined || row.group === group));
}

/** Desktop look defaults: no pet and no cheer until the person turns them on. */
export const PET_DEFAULT = 'none';
export const CHEER_DEFAULT = false;

export const HELP_PAGES: { id: string; title: string; paragraphs: string[] }[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    paragraphs: [
      'Your Trunks run on your own computer. This phone reaches them through Branch on that computer.',
      'Open Chats to talk to a Trunk. Anything that needs a yes shows in Approvals and can reach the lock screen when notifications are on.',
      'Pairing, chats and settings stay on this phone.',
    ],
  },
  {
    id: 'connecting',
    title: 'Connecting your phone',
    paragraphs: [
      'On the computer, open Get the apps and choose Pair a phone. It shows a square code.',
      'On this phone, scan the code or type it. Both screens show the same confirmation before pairing finishes.',
      'Away from home, use a secure address for the computer.',
    ],
  },
  {
    id: 'gateway',
    title: 'Your computer’s Gateway',
    paragraphs: [
      'The Gateway is the part of Branch that keeps running on the computer so this phone can reach your Trunks.',
      'It reaches only the computer itself until you widen it on that computer.',
    ],
  },
];

export const LANGUAGE_OPTIONS: { value: string; enabled: boolean }[] = [
  { value: 'Same as this phone', enabled: true },
];
export const APK_UPDATE_HELP =
  'Android updates check the file’s checksum and signing certificate, and need install permission.';
