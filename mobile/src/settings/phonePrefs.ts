// Phone Settings prefs from the r50 Android preview (phSettings + PG18).
// Defaults match design/spec-v23: lock Off, notifications On, share When needed,
// Talk On, push Off, screen awake On, wake word Off, speaker On, auto-connect On.

import type { KeyValueStore } from '../storage/keyValueStore';

export const PHONE_PREFS_KEY = 'branch.phonePrefs';

export type CyclePos = 'off' | 'when-needed' | 'on';

export const CYCLE_ORDER: readonly CyclePos[] = ['off', 'when-needed', 'on'];

export const CYCLE_LABEL: Record<CyclePos, string> = {
  off: 'Off',
  'when-needed': 'When needed',
  on: 'On',
};

export const TEXT_SIZES = ['90%', '100%', '110%', '125%', '140%'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const MIC_OPTIONS = ['Phone’s default', 'This phone’s microphone'] as const;
export type MicOption = (typeof MIC_OPTIONS)[number];

export const NOTIF_KINDS = [
  'A Trunk needs your yes',
  'A task finished',
  'Someone on your team needs you',
  'Usage is nearly out',
  'Daily summary at 6 pm',
] as const;

export const NOTIF_KIND_DEFAULTS: readonly boolean[] = [true, true, true, false, false];

export const LEND_ABILITIES = [
  { id: 'cam', label: 'Camera', detail: 'Take a photo when a Trunk asks' },
  { id: 'loc', label: 'Location', detail: 'Where you are, when it matters' },
  { id: 'photos', label: 'Photos', detail: 'Pick from your library' },
  { id: 'notif', label: 'Notifications', detail: 'Read the ones you choose' },
] as const;

export type LendId = (typeof LEND_ABILITIES)[number]['id'];

export type PhonePrefs = {
  lock: CyclePos;
  tellMe: CyclePos;
  share: CyclePos;
  talk: CyclePos;
  push: CyclePos;
  awake: boolean;
  haptics: boolean;
  wake: boolean;
  talkBg: boolean;
  speaker: boolean;
  autoConn: boolean;
  textSize: TextSize;
  mic: MicOption;
  notifKinds: boolean[];
  lendOn: boolean;
  lend: Record<LendId, boolean>;
};

export const PHONE_PREFS_DEFAULT: PhonePrefs = {
  lock: 'off',
  tellMe: 'on',
  share: 'when-needed',
  talk: 'on',
  push: 'off',
  awake: true,
  haptics: true,
  wake: false,
  talkBg: false,
  speaker: true,
  autoConn: true,
  textSize: '100%',
  mic: 'Phone’s default',
  notifKinds: [...NOTIF_KIND_DEFAULTS],
  lendOn: true,
  lend: { cam: true, loc: true, photos: false, notif: true },
};

export function nextCycle(value: CyclePos): CyclePos {
  const i = CYCLE_ORDER.indexOf(value);
  return CYCLE_ORDER[(i + 1) % CYCLE_ORDER.length] ?? 'off';
}

function asCycle(value: unknown, fallback: CyclePos): CyclePos {
  return value === 'off' || value === 'when-needed' || value === 'on' ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Read a stored prefs blob, filling any missing keys from the preview defaults. */
export function parsePhonePrefs(raw: string | null | undefined): PhonePrefs {
  if (!raw) return { ...PHONE_PREFS_DEFAULT, notifKinds: [...NOTIF_KIND_DEFAULTS], lend: { ...PHONE_PREFS_DEFAULT.lend } };
  try {
    const parsed = JSON.parse(raw) as Partial<PhonePrefs>;
    const kinds = Array.isArray(parsed.notifKinds)
      ? NOTIF_KIND_DEFAULTS.map((fallback, i) => asBool(parsed.notifKinds?.[i], fallback))
      : [...NOTIF_KIND_DEFAULTS];
    const lend = { ...PHONE_PREFS_DEFAULT.lend };
    if (parsed.lend && typeof parsed.lend === 'object') {
      for (const row of LEND_ABILITIES) {
        lend[row.id] = asBool(parsed.lend[row.id], lend[row.id]);
      }
    }
    const size = TEXT_SIZES.includes(parsed.textSize as TextSize) ? (parsed.textSize as TextSize) : PHONE_PREFS_DEFAULT.textSize;
    const mic = MIC_OPTIONS.includes(parsed.mic as MicOption) ? (parsed.mic as MicOption) : PHONE_PREFS_DEFAULT.mic;
    return {
      lock: asCycle(parsed.lock, PHONE_PREFS_DEFAULT.lock),
      tellMe: asCycle(parsed.tellMe, PHONE_PREFS_DEFAULT.tellMe),
      share: asCycle(parsed.share, PHONE_PREFS_DEFAULT.share),
      talk: asCycle(parsed.talk, PHONE_PREFS_DEFAULT.talk),
      push: asCycle(parsed.push, PHONE_PREFS_DEFAULT.push),
      awake: asBool(parsed.awake, PHONE_PREFS_DEFAULT.awake),
      haptics: asBool(parsed.haptics, PHONE_PREFS_DEFAULT.haptics),
      wake: asBool(parsed.wake, PHONE_PREFS_DEFAULT.wake),
      talkBg: asBool(parsed.talkBg, PHONE_PREFS_DEFAULT.talkBg),
      speaker: asBool(parsed.speaker, PHONE_PREFS_DEFAULT.speaker),
      autoConn: asBool(parsed.autoConn, PHONE_PREFS_DEFAULT.autoConn),
      textSize: size,
      mic,
      notifKinds: kinds,
      lendOn: asBool(parsed.lendOn, PHONE_PREFS_DEFAULT.lendOn),
      lend,
    };
  } catch {
    return { ...PHONE_PREFS_DEFAULT, notifKinds: [...NOTIF_KIND_DEFAULTS], lend: { ...PHONE_PREFS_DEFAULT.lend } };
  }
}

export function clonePhonePrefs(prefs: PhonePrefs): PhonePrefs {
  return { ...prefs, notifKinds: [...prefs.notifKinds], lend: { ...prefs.lend } };
}

let livePrefs = clonePhonePrefs(PHONE_PREFS_DEFAULT);
const liveListeners = new Set<() => void>();

function emitLive(): void {
  for (const listener of [...liveListeners]) listener();
}

/** The prefs the rest of the app reads. Settings writes here so toggles take effect at once. */
export function getLivePhonePrefs(): PhonePrefs {
  return livePrefs;
}

export function setLivePhonePrefs(prefs: PhonePrefs): void {
  livePrefs = clonePhonePrefs(prefs);
  emitLive();
}

export function subscribeLivePhonePrefs(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => {
    liveListeners.delete(listener);
  };
}

export function resetLivePhonePrefs(): void {
  livePrefs = clonePhonePrefs(PHONE_PREFS_DEFAULT);
  liveListeners.clear();
}

export async function readPhonePrefs(store: KeyValueStore): Promise<PhonePrefs> {
  const prefs = parsePhonePrefs(await store.get(PHONE_PREFS_KEY));
  setLivePhonePrefs(prefs);
  return prefs;
}

export async function writePhonePrefs(store: KeyValueStore, prefs: PhonePrefs): Promise<void> {
  setLivePhonePrefs(prefs);
  await store.set(PHONE_PREFS_KEY, JSON.stringify(prefs));
}

export function lendSummary(prefs: PhonePrefs): string {
  if (!prefs.lendOn) return 'Camera and location, when a Trunk asks';
  const on = LEND_ABILITIES.filter((row) => prefs.lend[row.id]).map((row) => row.label);
  if (on.length === 0) return 'Lent · nothing switched on';
  return `${on.slice(0, 3).join(', ')}, when a Trunk asks`;
}

export function notifKindsValue(prefs: PhonePrefs): string {
  const n = prefs.notifKinds.filter(Boolean).length;
  return `${n} kind${n === 1 ? '' : 's'}`;
}
