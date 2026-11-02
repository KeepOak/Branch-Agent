/** Android Settings catalogue from the r50 phone preview (phSettings + pass-18 PG18 overlay). */

export type SettingsLevel = 0 | 1 | 2;
export type SettingsGroup =
  | 'This Branch'
  | 'Your assistant'
  | 'Connections'
  | 'On this phone'
  | 'This phone, more'
  | 'Voice';

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  'This Branch',
  'Your assistant',
  'Connections',
  'On this phone',
  'This phone, more',
  'Voice',
];

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

export function showsAt(level: SettingsLevel, min: SettingsLevel): boolean {
  return level >= min;
}

/** Pairing restore that has no backend yet. Shown on Regular as a disabled row, never as a working sign-in. */
export const KEEPOAK_SIGN_IN = 'Sign in with KeepOak';
export const KEEPOAK_SIGN_IN_REASON = 'keepoak.com has no sign-in Branch Agent can use yet.';

/** Controls that cannot be built honestly yet. Same disabled-row pattern as KeepOak sign-in. */
export const LOCK_REASON = 'This phone cannot lock Branch Agent with a fingerprint yet.';
export const PUSH_REASON = 'Alerts while the app is closed need a store account Branch Agent does not have yet.';
export const WAKE_REASON = 'This phone cannot listen for a wake word yet.';

export function laterUpdate(label: string): string {
  return `${label} comes in a later update.`;
}

/** Desktop look defaults: no pet and no cheer until the person turns them on. */
export const PET_DEFAULT = 'none';
export const CHEER_DEFAULT = false;

export const HELP_PAGES: { id: string; title: string; paragraphs: string[] }[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    paragraphs: [
      'Your Trunks run on your own computer. This phone reaches them through Branch Agent on that computer.',
      'Open Chats to talk to a Trunk, or Talk to speak to one. Home shows what needs you and what is working.',
      'Anything a Trunk wants to do that needs a yes shows in Inbox and on your lock screen.',
    ],
  },
  {
    id: 'connecting',
    title: 'Connecting your phone',
    paragraphs: [
      'On the computer, open Get the apps and choose Pair a phone. It shows a square code and an 8-character code.',
      'On this phone, scan the code or type it. Both screens show the same confirmation code before pairing finishes.',
      'Away from home, use a secure address for the computer.',
    ],
  },
  {
    id: 'gateway',
    title: 'Your computer’s Gateway',
    paragraphs: [
      'The Gateway is the part of Branch Agent that keeps running on the computer so this phone can reach your Trunks.',
      'It reaches only the computer itself until you widen it on that computer.',
    ],
  },
];

export const LANGUAGE_OPTIONS: { value: string; enabled: boolean }[] = [
  { value: 'Same as this phone', enabled: true },
  { value: 'English', enabled: true },
];

export const APK_UPDATE_HELP =
  'Android updates check the file’s checksum and signing certificate, and need install permission.';

export const ASSISTANT_REASON = 'Android picks the assistant in its own settings.';

export const RUN_ON_PHONE = 'Run Branch Agent on this phone';
export const RUN_ON_PHONE_REASON =
  'This phone is the remote. Branch Agent’s engine runs on the computer.';

export const CHAT_APPS_HELP =
  'Telegram, WhatsApp, Discord and Slack are connected on the computer. Open Branch Agent there: Settings › Channels.';
export const MODELS_HELP =
  'Models run on your computer. Open Branch Agent there: Settings › Models.';
export const SKILLS_HELP =
  'Skills are installed on your computer. Open Branch Agent there: Settings › Skills.';

export const WAKE_WORDS_DEFAULT = 'Hey Branch Agent';
