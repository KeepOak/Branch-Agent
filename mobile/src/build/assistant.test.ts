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
const voiceKt = path.join(main, 'java/expo/modules/assistant/BranchVoiceInteraction.kt');
const voiceXml = path.join(main, 'res/xml/branch_voice_interaction_service.xml');
const recognitionXml = path.join(main, 'res/xml/branch_recognition_service.xml');
const proguard = path.join(root, 'android/proguard-rules.pro');
const buildGradle = path.join(root, 'android/build.gradle');
const pluginPath = path.join(__dirname, '../../plugins/withAssistant.js');

type Plugin = string | [string, Record<string, unknown>];
type Service = { $: Record<string, string>; 'intent-filter'?: unknown[]; 'meta-data'?: Array<{ $: Record<string, string> }> };
type Manifest = { manifest: { application: Array<{ $: Record<string, string>; service?: Service[] }> } };

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

  it('declares a voice interaction service whose session opens the app like the assist intent', () => {
    for (const file of [voiceKt, voiceXml, recognitionXml, pluginPath, proguard]) expect(existsSync(file)).toBe(true);
    const kotlin = readFileSync(voiceKt, 'utf8');
    expect(kotlin).toContain('class BranchVoiceInteractionService : VoiceInteractionService()');
    expect(kotlin).toContain('class BranchVoiceInteractionSessionService : VoiceInteractionSessionService()');
    expect(kotlin).toContain('class BranchRecognitionService : RecognitionService()');
    expect(kotlin).toContain('AssistLaunch.offer()');
    expect(kotlin).toContain('AssistLaunch.appIntent(context)');
    expect(readFileSync(activity, 'utf8')).toContain('AssistLaunch.appIntent(this)');
    const xml = readFileSync(voiceXml, 'utf8');
    expect(xml).toContain('android:sessionService="expo.modules.assistant.BranchVoiceInteractionSessionService"');
    expect(xml).toContain('android:recognitionService="expo.modules.assistant.BranchRecognitionService"');
    expect(xml).toContain('android:supportsAssist="true"');
    expect(xml).toContain('android:supportsLaunchVoiceAssistFromKeyguard="false"');
    const recognition = readFileSync(recognitionXml, 'utf8');
    expect(recognition).toContain('recognition-service');
    expect(recognition).toContain('android:selectableAsDefault="false"');
    expect(readFileSync(buildGradle, 'utf8')).toContain("consumerProguardFiles 'proguard-rules.pro'");
    expect(readFileSync(proguard, 'utf8')).toContain('BranchVoiceInteractionService');
    expect(readFileSync(proguard, 'utf8')).toContain('BranchRecognitionService');
  });

  it('ships the three voice services in the library manifest behind the system bind permissions', () => {
    const xml = readFileSync(manifest, 'utf8');
    expect(xml).toContain('android:name=".BranchVoiceInteractionService"');
    expect(xml).toContain('android:name=".BranchVoiceInteractionSessionService"');
    expect(xml).toContain('android:name=".BranchRecognitionService"');
    expect(xml).toContain('android.permission.BIND_VOICE_INTERACTION');
    expect(xml).toContain('android.permission.BIND_RECOGNITION_SERVICE');
    expect(xml).toContain('android.voice_interaction');
    expect(xml).toContain('@xml/branch_voice_interaction_service');
    expect(xml).toContain('android.speech');
    expect(xml).toContain('@xml/branch_recognition_service');
    expect(xml).toContain('android.service.voice.VoiceInteractionService');
    expect(xml).toContain('android.speech.RecognitionService');
  });

  it('adds the services to the generated app manifest once, behind BIND_VOICE_INTERACTION and BIND_RECOGNITION_SERVICE', () => {
    const app = require('../../app.json') as { expo: { plugins: Plugin[] } };
    expect(app.expo.plugins).toContain('./plugins/withAssistant.js');
    const plugin = require(pluginPath) as {
      ensureVoiceInteractionServices: (m: Manifest) => Manifest;
      SERVICE_CLASS: string;
      SESSION_CLASS: string;
      RECOGNITION_CLASS: string;
      BIND_PERMISSION: string;
      BIND_RECOGNITION_PERMISSION: string;
    };
    const empty: Manifest = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const twice = plugin.ensureVoiceInteractionServices(plugin.ensureVoiceInteractionServices(empty));
    const services = twice.manifest.application[0].service ?? [];
    expect(services.map((s) => s.$['android:name'])).toEqual([plugin.SERVICE_CLASS, plugin.SESSION_CLASS, plugin.RECOGNITION_CLASS]);
    const [service, session, recognition] = services;
    expect(plugin.BIND_PERMISSION).toBe('android.permission.BIND_VOICE_INTERACTION');
    expect(plugin.BIND_RECOGNITION_PERMISSION).toBe('android.permission.BIND_RECOGNITION_SERVICE');
    expect(service.$['android:permission']).toBe(plugin.BIND_PERMISSION);
    expect(session.$['android:permission']).toBe(plugin.BIND_PERMISSION);
    expect(recognition.$['android:permission']).toBe(plugin.BIND_RECOGNITION_PERMISSION);
    expect(JSON.stringify(service['intent-filter'])).toContain('android.service.voice.VoiceInteractionService');
    expect(JSON.stringify(recognition['intent-filter'])).toContain('android.speech.RecognitionService');
    expect(service['meta-data']?.[0].$).toEqual({
      'android:name': 'android.voice_interaction',
      'android:resource': '@xml/branch_voice_interaction_service',
    });
    expect(recognition['meta-data']?.[0].$).toEqual({
      'android:name': 'android.speech',
      'android:resource': '@xml/branch_recognition_service',
    });

    // Upsert: an older RecognitionService entry without BIND_RECOGNITION_SERVICE is corrected.
    const stale: Manifest = {
      manifest: {
        application: [
          {
            $: { 'android:name': '.MainApplication' },
            service: [
              {
                $: {
                  'android:name': plugin.RECOGNITION_CLASS,
                  'android:exported': 'true',
                  'android:label': '@string/branch_assistant_label',
                },
                'intent-filter': [{ action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }] }],
              },
            ],
          },
        ],
      },
    };
    const fixed = plugin.ensureVoiceInteractionServices(stale);
    const fixedRecognition = (fixed.manifest.application[0].service ?? []).find(
      (s) => s.$['android:name'] === plugin.RECOGNITION_CLASS,
    );
    expect(fixedRecognition?.$['android:permission']).toBe(plugin.BIND_RECOGNITION_PERMISSION);
    expect(fixedRecognition?.['meta-data']?.[0].$['android:resource']).toBe('@xml/branch_recognition_service');
  });
});
