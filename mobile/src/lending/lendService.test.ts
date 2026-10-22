import { PHONE_PREFS_DEFAULT, clonePhonePrefs, type PhonePrefs } from '../settings/phonePrefs';
import { lendNotice, lentAbilities, stopLending } from './lendService';

function prefs(patch: Partial<PhonePrefs> = {}): PhonePrefs {
  return { ...clonePhonePrefs(PHONE_PREFS_DEFAULT), ...patch };
}

describe('lending notification', () => {
  it('lists the switched-on abilities in Settings order, and none while lending is off', () => {
    expect(lentAbilities(prefs())).toEqual(['Camera', 'Location', 'Notifications']);
    expect(lentAbilities(prefs({ lendOn: false }))).toEqual([]);
  });

  it('shows only while paired and lending at least one ability', () => {
    expect(lendNotice({ paired: false, online: true, prefs: prefs() })).toBeNull();
    expect(lendNotice({ paired: true, online: true, prefs: prefs({ lendOn: false }) })).toBeNull();
    const nothing = prefs({ lend: { cam: false, loc: false, photos: false, notif: false } });
    expect(lendNotice({ paired: true, online: true, prefs: nothing })).toBeNull();
  });

  it('says what is lent while connected, and that it is reconnecting while not', () => {
    expect(lendNotice({ paired: true, online: true, prefs: prefs() })).toEqual({
      title: 'This phone is lent to Branch Agent',
      text: 'Camera, Location, Notifications, when a Trunk asks',
      stopLabel: 'Stop lending',
    });
    expect(lendNotice({ paired: true, online: false, prefs: prefs() })?.text).toBe('Reconnecting to your computer…');
  });

  it('stops lending without forgetting which abilities were chosen', () => {
    const before = prefs({ lend: { cam: true, loc: false, photos: true, notif: false } });
    const after = stopLending(before);
    expect(after.lendOn).toBe(false);
    expect(after.lend).toEqual(before.lend);
    expect(after.lend).not.toBe(before.lend);
  });
});
