import { Vibration } from 'react-native';
import { memoryStore } from '../storage/keyValueStore';
import {
  KEEP_AWAKE_TAG,
  applyKeepAwake,
  parseShareUrl,
  resetKeepAwakeDriver,
  screenAwakeActive,
  setKeepAwakeDriver,
  shouldAcceptShare,
  shouldKeepScreenAwake,
  shouldPostTaskAlert,
  tapHaptic,
} from './phoneEffects';
import { PHONE_PREFS_DEFAULT, resetLivePhonePrefs, setLivePhonePrefs } from './phonePrefs';
import { WAITING_MESSAGES_KEY, readWaitingMessages, takeShareToBranchAgent } from './phoneLocal';

beforeEach(() => {
  resetLivePhonePrefs();
  resetKeepAwakeDriver();
});

describe('keep the screen awake', () => {
  it('holds the screen only while the row is on and a Trunk is working', () => {
    expect(shouldKeepScreenAwake(true, true)).toBe(true);
    expect(shouldKeepScreenAwake(true, false)).toBe(false);
    expect(shouldKeepScreenAwake(false, true)).toBe(false);
    expect(shouldKeepScreenAwake(false, false)).toBe(false);
  });

  it('activates the keep-awake driver when it should, and deactivates when it should not', () => {
    const calls: string[] = [];
    setKeepAwakeDriver({
      activate: (tag) => {
        calls.push(`on:${tag}`);
      },
      deactivate: (tag) => {
        calls.push(`off:${tag}`);
      },
    });
    applyKeepAwake(true);
    expect(screenAwakeActive()).toBe(true);
    expect(calls).toEqual([`on:${KEEP_AWAKE_TAG}`]);
    applyKeepAwake(true);
    expect(calls).toHaveLength(1);
    applyKeepAwake(false);
    expect(screenAwakeActive()).toBe(false);
    expect(calls).toEqual([`on:${KEEP_AWAKE_TAG}`, `off:${KEEP_AWAKE_TAG}`]);
  });
});

describe('vibrate on taps', () => {
  it('buzzes when haptics are on, and stays still when they are off', () => {
      const vibrate = jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
    try {
      setLivePhonePrefs({ ...PHONE_PREFS_DEFAULT, haptics: true });
      tapHaptic();
      expect(vibrate).toHaveBeenCalledWith(12);
      vibrate.mockClear();
      setLivePhonePrefs({ ...PHONE_PREFS_DEFAULT, haptics: false });
      tapHaptic();
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      vibrate.mockRestore();
    }
  });
});

describe('tell me when a task needs me', () => {
  it('posts never when Off, only while away when needed, and even while open when On', () => {
    expect(shouldPostTaskAlert('off', true)).toBe(false);
    expect(shouldPostTaskAlert('off', false)).toBe(false);
    expect(shouldPostTaskAlert('when-needed', true)).toBe(true);
    expect(shouldPostTaskAlert('when-needed', false)).toBe(false);
    expect(shouldPostTaskAlert('on', true)).toBe(true);
    expect(shouldPostTaskAlert('on', false)).toBe(true);
  });
});

describe('send to Branch Agent from other apps', () => {
  it('drops a share when Off, takes it when On, and when needed only if a Trunk is waiting or a chat is open', () => {
    expect(shouldAcceptShare('off', { pendingCount: 2, chatOpen: true })).toBe(false);
    expect(shouldAcceptShare('on', { pendingCount: 0, chatOpen: false })).toBe(true);
    expect(shouldAcceptShare('when-needed', { pendingCount: 0, chatOpen: false })).toBe(false);
    expect(shouldAcceptShare('when-needed', { pendingCount: 1, chatOpen: false })).toBe(true);
    expect(shouldAcceptShare('when-needed', { pendingCount: 0, chatOpen: true })).toBe(true);
  });

  it('queues accepted shares as waiting messages and ignores dropped ones', async () => {
    const store = memoryStore();
    const prefsOn = { ...PHONE_PREFS_DEFAULT, share: 'on' as const };
    const prefsOff = { ...PHONE_PREFS_DEFAULT, share: 'off' as const };
    expect(
      await takeShareToBranchAgent(
        { text: 'Look at this note' },
        { store, prefs: prefsOn, need: { pendingCount: 0, chatOpen: false }, sessionKey: 'agent:main:main', now: 42 },
      ),
    ).toBe(true);
    expect(await readWaitingMessages(store)).toEqual([
      { sessionKey: 'agent:main:main', id: 'share-42', text: 'Look at this note', at: 42, state: 'sending' },
    ]);
    expect(
      await takeShareToBranchAgent(
        { text: 'Ignore me' },
        { store, prefs: prefsOff, need: { pendingCount: 0, chatOpen: false }, sessionKey: 'agent:main:main', now: 43 },
      ),
    ).toBe(false);
    expect(JSON.parse(store.dump()[WAITING_MESSAGES_KEY] ?? '[]')).toHaveLength(1);
    expect(parseShareUrl('branch://share?text=From%20another%20app')).toEqual({ text: 'From another app' });
    expect(parseShareUrl('https://example.com')).toBeNull();
  });
});
