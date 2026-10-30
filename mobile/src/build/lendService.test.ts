/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '../../modules/lend-service');
const main = path.join(root, 'android/src/main');
const service = path.join(main, 'java/expo/modules/lendservice/LendForegroundService.kt');
const moduleKt = path.join(main, 'java/expo/modules/lendservice/LendServiceModule.kt');
const manifest = path.join(main, 'AndroidManifest.xml');

describe('the Android lending foreground service', () => {
  it('is a local Expo module for Android only', () => {
    const config = JSON.parse(readFileSync(path.join(root, 'expo-module.config.json'), 'utf8')) as {
      platforms: string[];
      android: { modules: string[] };
    };
    expect(config.platforms).toEqual(['android']);
    expect(config.android.modules).toEqual(['expo.modules.lendservice.LendServiceModule']);
    for (const file of [service, moduleKt, manifest, path.join(main, 'res/drawable/branch_lend_notif.xml')]) {
      expect(existsSync(file)).toBe(true);
    }
    expect(readFileSync(moduleKt, 'utf8')).toContain('Name("LendService")');
  });

  it('declares a not-exported special-use foreground service with its permissions', () => {
    const xml = readFileSync(manifest, 'utf8');
    expect(xml).toContain('android.permission.FOREGROUND_SERVICE"');
    expect(xml).toContain('android.permission.FOREGROUND_SERVICE_SPECIAL_USE');
    expect(xml).toContain('android:name=".LendForegroundService"');
    expect(xml).toContain('android:exported="false"');
    expect(xml).toContain('android:foregroundServiceType="specialUse"');
    expect(xml).toContain('android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE');
  });

  it('shows an ongoing notification with Stop, and does not restart lending by itself', () => {
    const kotlin = readFileSync(service, 'utf8');
    expect(kotlin).toContain('setOngoing(true)');
    expect(kotlin).toContain('ACTION_STOP');
    expect(kotlin).toContain('FOREGROUND_SERVICE_TYPE_SPECIAL_USE');
    expect(kotlin).toContain('START_NOT_STICKY');
    expect(kotlin).not.toMatch(/\bSTART_STICKY\b/);
  });
});
