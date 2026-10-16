import { appIdentity, versionLine } from './appIdentity';

describe('app identity', () => {
  it('prefers the Expo config version pairing already sends, then the native app version', () => {
    expect(appIdentity({ expoConfig: { version: '0.1.0' }, nativeAppVersion: '9.9.9' })).toEqual({
      version: '0.1.0',
      build: null,
    });
    expect(appIdentity({ nativeAppVersion: '2.4.0' }).version).toBe('2.4.0');
    expect(appIdentity({}).version).toBe('0.0.0');
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
