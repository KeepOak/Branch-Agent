import { DEVICE_IDENTITY_KEY } from '../connect/deviceIdentity';
import { PAIRING_RECORD_KEY } from '../pairing/pairingSession';
import { memoryStore } from '../storage/keyValueStore';
import { SHOW_LEVEL_KEY } from './showLevel';
import { THEME_PREFERENCE_KEY } from '../theme/preference';
import {
  OFFLINE_CHATS_KEY,
  SAVED_AGENTS_KEY,
  WAITING_MESSAGES_KEY,
  clearPhoneData,
  resetThisPhone,
  writeOfflineChats,
  writeSavedAgents,
  writeWaitingMessages,
} from './phoneLocal';
import { PHONE_PREFS_DEFAULT, resetLivePhonePrefs, writePhonePrefs } from './phonePrefs';

beforeEach(() => {
  resetLivePhonePrefs();
});

describe('reset this phone', () => {
  it('clears saved agents, keys, offline chats, waiting messages and settings', async () => {
    const store = memoryStore({
      [DEVICE_IDENTITY_KEY]: '{"version":1}',
      [PAIRING_RECORD_KEY]: '{"version":1,"url":"ws://computer.local:19031"}',
      'branch.device-token.v1.abc': '{"token":"t"}',
    });
    await writeSavedAgents(store, [{ id: 'oak', name: 'Oak', avatar: 'O', status: 'idle' }]);
    await writeOfflineChats(store, [
      {
        key: 'agent:oak:main',
        title: 'Oak',
        avatar: 'O',
        preview: 'Hello',
        updatedAt: 1,
        working: false,
        unread: false,
        pinned: false,
        needsYou: false,
        room: false,
        archived: false,
        snoozedUntil: null,
        automation: false,
      },
    ]);
    await writeWaitingMessages(store, 'agent:oak:main', [
      { id: 's1', text: 'still sending', at: 1, state: 'sending' },
    ]);
    await writePhonePrefs(store, { ...PHONE_PREFS_DEFAULT, awake: false, haptics: false });
    await store.set(SHOW_LEVEL_KEY, 'advanced');
    await store.set(THEME_PREFERENCE_KEY, 'dark');

    let unpaired = 0;
    await resetThisPhone(
      {
        unpair: async () => {
          unpaired += 1;
          await store.remove(PAIRING_RECORD_KEY);
        },
      },
      store,
    );

    expect(unpaired).toBe(1);
    expect(store.dump()).toEqual({});
  });

  it('Forget-style unpair is not what Reset does: clearPhoneData is what empties the keys', async () => {
    const store = memoryStore({
      [DEVICE_IDENTITY_KEY]: '{"version":1}',
      [SAVED_AGENTS_KEY]: '[{"id":"oak"}]',
      [OFFLINE_CHATS_KEY]: '[{"key":"agent:oak:main"}]',
      [WAITING_MESSAGES_KEY]: '[{"id":"s1"}]',
    });
    await clearPhoneData(store);
    expect(store.dump()[DEVICE_IDENTITY_KEY]).toBeUndefined();
    expect(store.dump()[SAVED_AGENTS_KEY]).toBeUndefined();
    expect(store.dump()[OFFLINE_CHATS_KEY]).toBeUndefined();
    expect(store.dump()[WAITING_MESSAGES_KEY]).toBeUndefined();
  });
});
