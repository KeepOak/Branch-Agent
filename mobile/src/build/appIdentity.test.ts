import { appIdentity, identitySource, installedAppVersion, versionLine } from './appIdentity';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.4.4-build-e5d86fab32b5',
  nativeBuildVersion: '12',
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { version: '0.1.0', android: { versionCode: 1 }, ios: { buildNumber: '1' } },
    platform: { android: { versionCode: 1 }, ios: { buildNumber: '1' } },
    nativeAppVersion: null,
    nativeBuildVersion: null,
  },
}));

describe('app identity', () => {
  it('prefers the installed APK version over the 0.1.0 / Build 1 Expo template', () => {
    expect(
      appIdentity({
        expoConfig: { version: '0.1.0', android: { versionCode: 1 }, ios: { buildNumber: '1' } },
        nativeAppVersion: '0.4.4-build-e5d86fab32b5',
        nativeBuildVersion: '12',
      }),
    ).toEqual({
      version: '0.4.4-build-e5d86fab32b5',
      build: '12',
    });
    expect(appIdentity({ expoConfig: { version: '0.1.0' }, nativeAppVersion: '9.9.9' })).toEqual({
      version: '9.9.9',
      build: null,
    });
    expect(appIdentity({ nativeAppVersion: '2.4.0' }).version).toBe('2.4.0');
    expect(appIdentity({}).version).toBe('0.0.0');
  });

  it('reads expo-application at runtime so Settings matches the installed APK', () => {
    expect(identitySource()).toEqual({
      expoConfig: { version: '0.1.0', android: { versionCode: 1 }, ios: { buildNumber: '1' } },
      platform: { android: { versionCode: 1 }, ios: { buildNumber: '1' } },
      nativeAppVersion: '0.4.4-build-e5d86fab32b5',
      nativeBuildVersion: '12',
    });
    expect(appIdentity()).toEqual({
      version: '0.4.4-build-e5d86fab32b5',
      build: '12',
    });
    expect(appIdentity()).not.toEqual({ version: '0.1.0', build: '1' });
    expect(installedAppVersion()).toEqual({
      version: '0.4.4-build-e5d86fab32b5',
      versionCode: 12,
    });
    expect(installedAppVersion()).not.toEqual({ version: '0.1.0', versionCode: 1 });
  });

  it('reads the native build number, then iOS buildNumber, then Android versionCode', () => {
    expect(appIdentity({ expoConfig: { version: '0.1.0' }, nativeBuildVersion: '14' }).build).toBe('14');
    expect(appIdentity({ expoConfig: { version: '0.1.0', ios: { buildNumber: '7' } } }).build).toBe('7');
    expect(appIdentity({ expoConfig: { version: '0.1.0' }, platform: { ios: { buildNumber: '3' } } }).build).toBe('3');
    expect(appIdentity({ expoConfig: { version: '0.1.0', android: { versionCode: 12 } } }).build).toBe('12');
    expect(appIdentity({ expoConfig: { version: '0.1.0' }, platform: { android: { versionCode: 9 } } }).build).toBe('9');
    expect(appIdentity({ expoConfig: { version: '0.1.0' }, nativeBuildVersion: '  ' }).build).toBeNull();
  });

  it('writes the version with the build in parentheses when there is one', () => {
    expect(versionLine({ version: '0.1.0', build: '14' })).toBe('0.1.0 (14)');
    expect(versionLine({ version: '0.1.0', build: null })).toBe('0.1.0');
  });
});
