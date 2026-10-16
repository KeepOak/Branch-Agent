// The local Android build (README.md, scripts/build-android.mjs) generates android/ from app.json with
// `expo prebuild`, so everything a built app needs has to be in app.json and package.json, not in android/.
import { existsSync, readFileSync } from 'node:fs';
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

  it('builds with one command and no EAS account in the repo', () => {
    expect(pkg.scripts['build:android' as keyof typeof pkg.scripts]).toBe('node scripts/build-android.mjs');
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('eas'))).toEqual([]);
  });

  it('declares a versionCode and REQUEST_INSTALL_PACKAGES for sideloaded APK updates', () => {
    expect(app.expo.android.versionCode).toBe(1);
    expect(app.expo.android.permissions).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(plugins).toContain('./plugins/withApkInstaller.js');
  });

  it('wires expo-updates without committing a project ID, and ties runtimeVersion to the native version', () => {
    expect(Object.keys(pkg.dependencies)).toContain('expo-updates');
    expect(plugins).toContain('expo-updates');
    const config = require('../../app.config.js') as { expo: { updates: { enabled: boolean }; runtimeVersion: string; extra?: { eas?: { projectId: string } } } };
    expect(config.expo.updates.enabled).toBe(false);
    expect(config.expo.runtimeVersion).toBe(`${app.expo.version}.${app.expo.android.versionCode}`);
    expect(config.expo.extra?.eas).toBeUndefined();
  });

  it('passes CI signing through gradle env and never logs passwords', () => {
    const src = readFileSync(path.join(__dirname, '../../scripts/build-android.mjs'), 'utf8');
    expect(src).toContain("from './android-release.mjs'");
    expect(src).toContain('gradleAssembleArgs()');
    expect(src).toContain('gradleSigningEnv()');
    expect(src).toContain('writeAppJsonReleaseMeta');
    expect(src).toContain('printableArgs');
    expect(src).toContain('=***');
    expect(src).not.toMatch(/ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD/);
    expect(src).not.toMatch(/-Pandroid\.injected\.signing\.(store|key)\.password/);
  });
});
