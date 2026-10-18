import { PHONE_PREFS_DEFAULT } from '../settings/phonePrefs';
import { ANDROID_CHANNELS, kindEnabled, shouldPostAlert } from './kinds';

describe('notification kinds', () => {
  it('keeps the existing approvals Android channel id and name', () => {
    expect(ANDROID_CHANNELS[0]).toEqual({
      id: 'approvals',
      name: 'Approvals',
      description: 'A Trunk needs your yes before it goes on.',
    });
    expect(ANDROID_CHANNELS.map((c) => c.id)).toEqual(['approvals', 'replies', 'questions', 'mentions', 'automations', 'updates']);
  });

  it('follows the Settings › Notifications kind switches', () => {
    const offFinished = { ...PHONE_PREFS_DEFAULT, notifKinds: [true, false, true, false, false] };
    expect(kindEnabled(PHONE_PREFS_DEFAULT, 'approval')).toBe(true);
    expect(kindEnabled(PHONE_PREFS_DEFAULT, 'finished')).toBe(true);
    expect(kindEnabled(PHONE_PREFS_DEFAULT, 'mention')).toBe(true);
    expect(kindEnabled(offFinished, 'finished')).toBe(false);
    expect(kindEnabled(offFinished, 'approval')).toBe(true);
    expect(kindEnabled(PHONE_PREFS_DEFAULT, 'update')).toBe(true);
  });

  it('stays quiet while the app is open, and when Tell me is off', () => {
    expect(shouldPostAlert(PHONE_PREFS_DEFAULT, 'finished', 'background')).toBe(true);
    expect(shouldPostAlert(PHONE_PREFS_DEFAULT, 'finished', 'active')).toBe(false);
    expect(shouldPostAlert({ ...PHONE_PREFS_DEFAULT, tellMe: 'off' }, 'finished', 'background')).toBe(false);
    expect(shouldPostAlert({ ...PHONE_PREFS_DEFAULT, tellMe: 'when-needed' }, 'mention', 'background')).toBe(true);
  });
});
