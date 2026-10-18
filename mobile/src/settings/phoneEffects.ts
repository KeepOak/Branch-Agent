// What the r50 phone Settings toggles actually do outside the Settings screen.
// Keep-awake, haptics, task alerts and share-to-Branch-Agent are real. Fingerprint lock,
// alerts while closed and the wake word stay disabled in Settings with a reason.

import { NativeModules, Vibration } from 'react-native';
import type { CyclePos, PhonePrefs } from './phonePrefs';
import { getLivePhonePrefs } from './phonePrefs';

export const KEEP_AWAKE_TAG = 'branch-agent';
export const HAPTIC_MS = 12;

export type KeepAwakeDriver = {
  activate: (tag: string) => void | Promise<void>;
  deactivate: (tag: string) => void | Promise<void>;
};

const nativeKeepAwake: KeepAwakeDriver = {
  activate: (tag) => {
    const native = NativeModules.ExpoKeepAwake as { activate?: (next: string) => void } | undefined;
    native?.activate?.(tag);
  },
  deactivate: (tag) => {
    const native = NativeModules.ExpoKeepAwake as { deactivate?: (next: string) => void } | undefined;
    native?.deactivate?.(tag);
  },
};

let keepAwakeDriver: KeepAwakeDriver = nativeKeepAwake;
let keepAwakeOn = false;

export function setKeepAwakeDriver(driver: KeepAwakeDriver): void {
  keepAwakeDriver = driver;
}

export function resetKeepAwakeDriver(): void {
  keepAwakeDriver = nativeKeepAwake;
  keepAwakeOn = false;
}

/** True while the Keep the screen awake row is on and a Trunk is working. */
export function shouldKeepScreenAwake(awake: boolean, working: boolean): boolean {
  return awake && working;
}

export function applyKeepAwake(on: boolean): void {
  if (on === keepAwakeOn) return;
  keepAwakeOn = on;
  if (on) void keepAwakeDriver.activate(KEEP_AWAKE_TAG);
  else void keepAwakeDriver.deactivate(KEEP_AWAKE_TAG);
}

export function screenAwakeActive(): boolean {
  return keepAwakeOn;
}

/** A light buzz on send, allow or switch, when Vibrate on taps is on. */
export function tapHaptic(prefs: PhonePrefs = getLivePhonePrefs()): void {
  if (!prefs.haptics) return;
  Vibration.vibrate(HAPTIC_MS);
}

/**
 * Tell me when a task needs me:
 * Off never posts. When needed only while the app is away. On posts even while Branch Agent is open.
 */
export function shouldPostTaskAlert(tellMe: CyclePos, away: boolean): boolean {
  if (tellMe === 'off') return false;
  if (tellMe === 'when-needed') return away;
  return true;
}

export type ShareNeed = { pendingCount: number; chatOpen: boolean };

/** Send to Branch Agent from other apps: Off drops the share; On always takes it; When needed only if a Trunk is waiting or a chat is open. */
export function shouldAcceptShare(share: CyclePos, need: ShareNeed): boolean {
  if (share === 'off') return false;
  if (share === 'on') return true;
  return need.pendingCount > 0 || need.chatOpen;
}

export type IncomingShare = { text?: string; uri?: string };

export function shareTextOf(share: IncomingShare): string {
  return (share.text ?? share.uri ?? '').trim();
}

/** branch://share?text=… or any URL with a text / body query, as a share from another app. */
export function parseShareUrl(url: string): IncomingShare | null {
  try {
    const parsed = new URL(url);
    const text = parsed.searchParams.get('text') ?? parsed.searchParams.get('body');
    if (text && text.trim()) return { text: text.trim() };
  } catch {
    return null;
  }
  return null;
}
