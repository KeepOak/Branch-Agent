/** Preview extras on Settings. They stay Off until a later PR wires them. */

export type SettingsExtra = {
  testID: string;
  title: string;
  detail: string;
  reason: string;
};

export const THIS_BRANCH_EXTRAS: SettingsExtra[] = [
  {
    testID: 'extra-connect-another',
    title: 'Connect another Branch',
    detail: 'Pair a second computer from this phone.',
    reason: 'This phone is already paired. Unpair from This phone first.',
  },
];

export const ASSISTANT_EXTRAS: SettingsExtra[] = [
  {
    testID: 'extra-accounts',
    title: 'Accounts',
    detail: 'Model sign-ins used on the computer.',
    reason: 'Add accounts on the computer, under Settings, Accounts.',
  },
  {
    testID: 'extra-setup-talk',
    title: 'Set up and fix by talking',
    detail: 'Talk it through with a Trunk.',
    reason: 'Talk is not wired from Settings yet. Open a chat from Chats.',
  },
];

export const ON_PHONE_EXTRAS: SettingsExtra[] = [
  {
    testID: 'extra-lock',
    title: 'Lock with fingerprint',
    detail: 'Ask before showing Branch.',
    reason: 'The phone’s lock is not wired in this app yet.',
  },
  {
    testID: 'extra-share',
    title: 'Send to Branch from other apps',
    detail: 'Puts Branch in the share sheet.',
    reason: 'The share sheet is not wired in this app yet.',
  },
  {
    testID: 'extra-push',
    title: 'Alerts while the app is closed',
    detail: 'Needs a store account first.',
    reason: 'Closed-app push is not wired. Approvals still reach you while Branch is open.',
  },
  {
    testID: 'extra-awake',
    title: 'Keep the screen awake',
    detail: 'Keeps the screen on while a Trunk is working.',
    reason: 'Keeping the screen awake is not wired in this app yet.',
  },
  {
    testID: 'extra-assistant',
    title: 'Use as the phone’s assistant',
    detail: 'Hold the home button, or say “Hey Google, ask Branch …”.',
    reason: 'Android picks the assistant in its own settings.',
  },
  {
    testID: 'extra-lend',
    title: 'Lend this phone to Branch',
    detail: 'Camera and location, when a Trunk asks.',
    reason: 'Lending this phone is not wired in this app yet.',
  },
];

export const VOICE_EXTRAS: SettingsExtra[] = [
  {
    testID: 'extra-talk',
    title: 'Talk button',
    detail: 'Shows the button that turns what you say into a message.',
    reason: 'Talk is not wired in this app yet.',
  },
  {
    testID: 'extra-wake',
    title: 'Listen for the wake word',
    detail: 'Heard on this phone, only while Branch is open.',
    reason: 'The wake word is not wired in this app yet.',
  },
  {
    testID: 'extra-talk-bg',
    title: 'Keep talking in the background',
    detail: 'The microphone stays on while you use other apps.',
    reason: 'Background talk is not wired in this app yet.',
  },
  {
    testID: 'extra-speaker',
    title: 'Use speakerphone',
    detail: 'Plays the Trunk’s voice from the loudspeaker.',
    reason: 'Speakerphone is not wired in this app yet.',
  },
  {
    testID: 'extra-test-sound',
    title: 'Test sound',
    detail: 'Check that Branch speaks clearly on this phone.',
    reason: 'Playing sound is not wired in this app yet.',
  },
];

export const SETTINGS_EXTRAS: SettingsExtra[] = [
  ...THIS_BRANCH_EXTRAS,
  ...ASSISTANT_EXTRAS,
  ...ON_PHONE_EXTRAS,
  ...VOICE_EXTRAS,
];

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
  { value: 'English', enabled: false },
  { value: 'Français', enabled: false },
  { value: 'Español', enabled: false },
  { value: 'Deutsch', enabled: false },
  { value: 'Yorùbá', enabled: false },
];

export const LANGUAGE_DISABLED_REASON = 'This app only has its English words.';
export const TEXT_SIZE_DEFAULT = '100%';
export const TEXT_SIZE_REASON = 'Only this phone’s text size is used.';
