// The local Android build (README.md, scripts/build-android.mjs) generates android/ from app.json with
// `expo prebuild`, so everything a built app needs has to be in app.json and package.json, not in android/.
import { existsSync } from 'node:fs';
import path from 'node:path';
import app from '../../app.json';
import pkg from '../../package.json';

type Plugin = string | [string, Record<string, unknown>];
const plugins = app.expo.plugins as Plugin[];
const pluginOptions = (name: string) => plugins.find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === name)?.[1];
const assetExists = (file: unknown) => typeof file === 'string' && existsSync(path.join(__dirname, '../..', file));

describe('the installable Android build', () => {
  it('has its own Android package, so prebuild doesn’t fall back to com.anonymous', () => {
    expect(app.expo.android.package).toBe('com.keepoak.branch');
  });

  it('has a splash logo, because prebuild links a splashscreen_logo drawable and fails without one', () => {
    expect(pluginOptions('expo-splash-screen')?.image).toBeDefined();
    expect(assetExists(pluginOptions('expo-splash-screen')?.image)).toBe(true);
  });

  it('has an app icon and an Android adaptive icon that exist on disk', () => {
    expect(assetExists(app.expo.icon)).toBe(true);
    expect(assetExists(app.expo.android.adaptiveIcon.foregroundImage)).toBe(true);
  });

  it('can still reach the computer over plain ws:// on the home network, as Expo Go can', () => {
    expect(pluginOptions('expo-build-properties')).toEqual({ android: { usesCleartextTraffic: true } });
  });

  it('follows the phone’s light or dark setting, which a built app does only with expo-system-ui', () => {
    expect(app.expo.userInterfaceStyle).toBe('automatic');
    expect(Object.keys(pkg.dependencies)).toContain('expo-system-ui');
  });

  it('builds with one command and no EAS', () => {
    expect(pkg.scripts['build:android' as keyof typeof pkg.scripts]).toBe('node scripts/build-android.mjs');
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('eas'))).toEqual([]);
  });
});
