import { compareVersions, isNewerApk, parseRemoteVersion, versionParts } from './versionCompare';

describe('version compare', () => {
  it('splits dotted versions and ignores a build suffix', () => {
    expect(versionParts('0.2.0')).toEqual([0, 2, 0]);
    expect(versionParts('0.2.0-build-abc')).toEqual([0, 2, 0]);
    expect(versionParts('12')).toEqual([12]);
  });

  it('orders dotted versions, so a newer GitHub APK is the one that should install', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('1.0', '0.9.9')).toBe(1);
  });

  it('reads versionCode from an all-digits or name+code filename', () => {
    expect(parseRemoteVersion('12')).toEqual({ name: '12', versionCode: 12 });
    expect(parseRemoteVersion('0.2.0+3')).toEqual({ name: '0.2.0', versionCode: 3 });
    expect(parseRemoteVersion('0.2.0')).toEqual({ name: '0.2.0' });
  });

  it('prefers versionCode when the filename has one, else the dotted name', () => {
    const local = { version: '0.1.0', versionCode: 1 };
    expect(isNewerApk({ name: '0.2.0' }, local)).toBe(true);
    expect(isNewerApk({ name: '0.1.0' }, local)).toBe(false);
    expect(isNewerApk({ name: '0.1.0', versionCode: 2 }, local)).toBe(true);
    expect(isNewerApk({ name: '0.9.0', versionCode: 1 }, local)).toBe(false);
    expect(isNewerApk({ name: '12', versionCode: 12 }, local)).toBe(true);
  });
});
