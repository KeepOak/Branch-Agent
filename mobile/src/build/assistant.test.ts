/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '../../modules/assistant');
const main = path.join(root, 'android/src/main');
const activity = path.join(main, 'java/expo/modules/assistant/AssistActivity.kt');
const moduleKt = path.join(main, 'java/expo/modules/assistant/AssistantModule.kt');
const manifest = path.join(main, 'AndroidManifest.xml');

describe('the Android assistant entry point', () => {
  it('is a local Expo module for Android only', () => {
    const config = JSON.parse(readFileSync(path.join(root, 'expo-module.config.json'), 'utf8')) as {
      platforms: string[];
      android: { modules: string[] };
    };
    expect(config.platforms).toEqual(['android']);
    expect(config.android.modules).toEqual(['expo.modules.assistant.AssistantModule']);
    for (const file of [activity, moduleKt, manifest]) expect(existsSync(file)).toBe(true);
    expect(readFileSync(moduleKt, 'utf8')).toContain('Name("Assistant")');
  });

  it('handles the ASSIST intent with an invisible activity that opens the app', () => {
    const xml = readFileSync(manifest, 'utf8');
    expect(xml).toContain('android:name=".AssistActivity"');
    expect(xml).toContain('android.intent.action.ASSIST');
    expect(xml).toContain('android.intent.category.DEFAULT');
    expect(xml).toContain('android:noHistory="true"');
    const kotlin = readFileSync(activity, 'utf8');
    expect(kotlin).toContain('AssistLaunch.offer()');
    expect(kotlin).toContain('getLaunchIntentForPackage');
    expect(kotlin).toContain('finish()');
  });
});
