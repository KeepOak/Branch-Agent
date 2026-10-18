// Local phone data Reset must actually wipe: saved agents, the device key, offline chats,
// waiting (unsent) messages, Settings prefs and this phone's look. Forget only unpairs.

import { DEVICE_IDENTITY_KEY } from '../connect/deviceIdentity';
import { PAIRING_RECORD_KEY } from '../pairing/pairingSession';
import { TOUCH_MODE_KEY } from '../stage/touch-mode';
import type { KeyValueStore } from '../storage/keyValueStore';
import { SHOW_LEVEL_KEY } from './showLevel';
import { THEME_LOOK_KEY, THEME_PREFERENCE_KEY } from '../theme/preference';
import { PERSISTENT_KEYS } from '../updates/persist';
import type { AgentRow } from '../agents/agentList';
import type { ChatRow } from '../chats/chatList';
import { shouldAcceptShare, shareTextOf, type IncomingShare, type ShareNeed } from './phoneEffects';
import { PHONE_PREFS_KEY, resetLivePhonePrefs, type PhonePrefs } from './phonePrefs';
import type { OwnSend } from '../chat/conversation';

export const SAVED_AGENTS_KEY = 'branch.saved.agents';
export const OFFLINE_CHATS_KEY = 'branch.saved.chats';
export const WAITING_MESSAGES_KEY = 'branch.saved.waiting';

export const PHONE_DATA_KEYS = [
  DEVICE_IDENTITY_KEY,
  PAIRING_RECORD_KEY,
  PHONE_PREFS_KEY,
  SHOW_LEVEL_KEY,
  'branch.level',
  THEME_PREFERENCE_KEY,
  THEME_LOOK_KEY,
  TOUCH_MODE_KEY,
  SAVED_AGENTS_KEY,
  OFFLINE_CHATS_KEY,
  WAITING_MESSAGES_KEY,
] as const;

export type WaitingMessage = Pick<OwnSend, 'id' | 'text' | 'at' | 'state'> & {
  sessionKey: string;
  error?: string;
};

type DumpingStore = KeyValueStore & { dump?: () => Record<string, string> };

export async function writeSavedAgents(store: KeyValueStore, rows: readonly AgentRow[]): Promise<void> {
  await store.set(SAVED_AGENTS_KEY, JSON.stringify(rows));
}

export async function writeOfflineChats(store: KeyValueStore, rows: readonly ChatRow[]): Promise<void> {
  await store.set(OFFLINE_CHATS_KEY, JSON.stringify(rows));
}

export async function readWaitingMessages(store: KeyValueStore): Promise<WaitingMessage[]> {
  const raw = await store.get(WAITING_MESSAGES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as WaitingMessage[]) : [];
  } catch {
    return [];
  }
}

export async function writeWaitingMessages(store: KeyValueStore, sessionKey: string, sends: readonly OwnSend[]): Promise<void> {
  const waiting = sends
    .filter((send) => send.state === 'sending' || send.state === 'failed')
    .map((send) => ({
      sessionKey,
      id: send.id,
      text: send.text,
      at: send.at,
      state: send.state,
      ...(send.error ? { error: send.error } : {}),
    }));
  const others = (await readWaitingMessages(store)).filter((row) => row.sessionKey !== sessionKey);
  const next = [...others, ...waiting];
  if (next.length === 0) await store.remove(WAITING_MESSAGES_KEY);
  else await store.set(WAITING_MESSAGES_KEY, JSON.stringify(next));
}

export async function addWaitingMessage(store: KeyValueStore, message: WaitingMessage): Promise<void> {
  const next = [...(await readWaitingMessages(store)).filter((row) => row.id !== message.id), message];
  await store.set(WAITING_MESSAGES_KEY, JSON.stringify(next));
}

export async function clearPhoneData(store: DumpingStore): Promise<void> {
  const keys = new Set<string>(PHONE_DATA_KEYS);
  if (typeof store.dump === 'function') {
    for (const key of Object.keys(store.dump())) {
      if (key.startsWith(PERSISTENT_KEYS.deviceTokenPrefix)) keys.add(key);
    }
  }
  for (const key of keys) await store.remove(key);
  resetLivePhonePrefs();
}

export type ResettableSession = {
  unpair(): Promise<void>;
  reset?(): Promise<void>;
};

/**
 * Reset this app: unpair, drop the device key, wipe saved agents, offline chats and waiting
 * messages, and restore Settings to the preview defaults. Forget stays unpair-only.
 */
export async function resetThisPhone(session: ResettableSession, store?: KeyValueStore): Promise<void> {
  if (session.reset) await session.reset();
  else await session.unpair();
  if (store) await clearPhoneData(store);
  resetLivePhonePrefs();
}

/** Accept a share from another app into waiting messages, when the Settings row allows it. */
export async function takeShareToBranchAgent(
  share: IncomingShare,
  opts: { store: KeyValueStore; prefs: PhonePrefs; need: ShareNeed; sessionKey: string; now?: number },
): Promise<boolean> {
  const text = shareTextOf(share);
  if (!text) return false;
  if (!shouldAcceptShare(opts.prefs.share, opts.need)) return false;
  const at = opts.now ?? Date.now();
  await addWaitingMessage(opts.store, {
    sessionKey: opts.sessionKey,
    id: `share-${at}`,
    text,
    at,
    state: 'sending',
  });
  return true;
}
