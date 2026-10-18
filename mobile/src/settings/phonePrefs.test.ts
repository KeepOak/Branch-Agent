import { memoryStore } from '../storage/keyValueStore';
import {
  CYCLE_LABEL,
  LEND_ABILITIES,
  NOTIF_KIND_DEFAULTS,
  PHONE_PREFS_DEFAULT,
  lendSummary,
  nextCycle,
  notifKindsValue,
  parsePhonePrefs,
  readPhonePrefs,
  writePhonePrefs,
} from './phonePrefs';

describe('phone prefs', () => {
  it('starts from the r50 Android defaults', () => {
    expect(PHONE_PREFS_DEFAULT.lock).toBe('off');
    expect(PHONE_PREFS_DEFAULT.tellMe).toBe('on');
    expect(PHONE_PREFS_DEFAULT.share).toBe('when-needed');
    expect(PHONE_PREFS_DEFAULT.talk).toBe('on');
    expect(PHONE_PREFS_DEFAULT.push).toBe('off');
    expect(PHONE_PREFS_DEFAULT.awake).toBe(true);
    expect(PHONE_PREFS_DEFAULT.haptics).toBe(true);
    expect(PHONE_PREFS_DEFAULT.wake).toBe(false);
    expect(PHONE_PREFS_DEFAULT.speaker).toBe(true);
    expect(PHONE_PREFS_DEFAULT.autoConn).toBe(true);
    expect(PHONE_PREFS_DEFAULT.textSize).toBe('100%');
    expect(PHONE_PREFS_DEFAULT.notifKinds).toEqual([...NOTIF_KIND_DEFAULTS]);
    expect(LEND_ABILITIES.map((row) => row.id)).toEqual(['cam', 'loc', 'photos', 'notif']);
  });

  it('cycles Off, When needed, On', () => {
    expect(nextCycle('off')).toBe('when-needed');
    expect(nextCycle('when-needed')).toBe('on');
    expect(nextCycle('on')).toBe('off');
    expect(CYCLE_LABEL.on).toBe('On');
    expect(CYCLE_LABEL['when-needed']).toBe('When needed');
  });

  it('fills missing keys and ignores a broken blob', () => {
    expect(parsePhonePrefs('{"lock":"on"}').lock).toBe('on');
    expect(parsePhonePrefs('{"lock":"on"}').speaker).toBe(true);
    expect(parsePhonePrefs('not-json').lock).toBe('off');
    expect(parsePhonePrefs(null).textSize).toBe('100%');
  });

  it('round-trips through the store', async () => {
    const store = memoryStore();
    const next = { ...PHONE_PREFS_DEFAULT, wake: true, lock: 'on' as const, notifKinds: [...NOTIF_KIND_DEFAULTS], lend: { ...PHONE_PREFS_DEFAULT.lend } };
    await writePhonePrefs(store, next);
    expect(await readPhonePrefs(store)).toEqual(next);
  });

  it('names lent abilities the way the preview’s row does', () => {
    expect(lendSummary(PHONE_PREFS_DEFAULT)).toBe('Camera, Location, Notifications, when a Trunk asks');
    expect(lendSummary({ ...PHONE_PREFS_DEFAULT, lendOn: false })).toBe('Camera and location, when a Trunk asks');
    expect(notifKindsValue(PHONE_PREFS_DEFAULT)).toBe('3 kinds');
  });
});
