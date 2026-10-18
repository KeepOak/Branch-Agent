// Notification kinds the phone can post, mapped onto the r50 Settings › Notifications
// switches (design/spec-v23 phone `notif` page) and the engine's web-push categories
// (engine/src/infra/push-web-preferences.ts). Android channel ids stay stable: the
// approvals channel is the one expoNotifier already registered.
import { PHONE_PREFS_DEFAULT, type PhonePrefs } from '../settings/phonePrefs';

export const ANDROID_CHANNELS = [
  { id: 'approvals', name: 'Approvals', description: 'A Trunk needs your yes before it goes on.' },
  { id: 'replies', name: 'Replies', description: 'A Trunk finished a reply while you were away.' },
  { id: 'questions', name: 'Questions', description: 'A Trunk needs an answer before it can go on.' },
  { id: 'mentions', name: 'Mentions', description: 'Someone mentioned you in a conversation.' },
  { id: 'automations', name: 'Routines', description: 'A routine finished or could not finish.' },
  { id: 'updates', name: 'Updates', description: 'A Branch update is ready to install.' },
] as const;

export type AndroidChannelId = (typeof ANDROID_CHANNELS)[number]['id'];

/** What the phone posts, matching the engine's attention categories plus the local APK update. */
export type AlertKind = 'approval' | 'finished' | 'question' | 'mention' | 'automation' | 'update';

export const CHANNEL_FOR_KIND: Record<AlertKind, AndroidChannelId> = {
  approval: 'approvals',
  finished: 'replies',
  question: 'questions',
  mention: 'mentions',
  automation: 'automations',
  update: 'updates',
};

/**
 * Index into PhonePrefs.notifKinds (preview PH_SW / ph notif page). `null` means there is no
 * per-kind switch: the OS notification permission is enough.
 *
 * 0 A Trunk needs your yes
 * 1 A task finished
 * 2 Someone on your team needs you (mentions, questions, new Inbox items)
 */
const KIND_SWITCH: Record<AlertKind, number | null> = {
  approval: 0,
  finished: 1,
  question: 2,
  mention: 2,
  automation: 2,
  update: null,
};

export function kindEnabled(prefs: PhonePrefs, kind: AlertKind): boolean {
  const index = KIND_SWITCH[kind];
  if (index == null) return true;
  return prefs.notifKinds[index] !== false;
}

/** Whether this kind should post right now. Off never; otherwise only while Branch is not in front. */
export function shouldPostAlert(prefs: PhonePrefs | undefined, kind: AlertKind, appState: string): boolean {
  const current = prefs ?? PHONE_PREFS_DEFAULT;
  if (current.tellMe === 'off') return false;
  if (appState === 'active') return false;
  return kindEnabled(current, kind);
}
