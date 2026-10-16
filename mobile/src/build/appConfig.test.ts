// Expo prebuild reads app.json for the native shell. The iOS bundle id has to match the Android
// package, and the camera / notification permission strings have to be present so a store build
// can ask for QR pairing and approval alerts. No signing, team ids or credentials belong here.
import app from '../../app.json';

type Plugin = string | [string, Record<string, unknown>];
const plugins = app.expo.plugins as Plugin[];
const pluginOptions = (name: string) => plugins.find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === name)?.[1];

const CAMERA_REASON = 'Branch uses the camera to read the pairing code on your computer and to take a picture to send in a chat.';
const NOTIFICATION_REASON = 'Branch sends notifications when something on your computer needs your approval.';

describe('the Expo app config', () => {
  it('uses the same iOS bundle id as the Android package', () => {
    expect(app.expo.ios.bundleIdentifier).toBe('com.keepoak.branch');
    expect(app.expo.ios.bundleIdentifier).toBe(app.expo.android.package);
  });

  it('has iOS permission strings for the camera (QR pairing) and notifications (approvals)', () => {
    expect(app.expo.ios.infoPlist.NSCameraUsageDescription).toBe(CAMERA_REASON);
    expect(app.expo.ios.infoPlist.NSUserNotificationsUsageDescription).toBe(NOTIFICATION_REASON);
    expect(pluginOptions('expo-camera')?.cameraPermission).toBe(CAMERA_REASON);
  });

  it('declares Android camera and notification permissions', () => {
    expect(app.expo.android.permissions).toEqual(expect.arrayContaining([
      'android.permission.CAMERA',
      'android.permission.POST_NOTIFICATIONS',
    ]));
  });
});
