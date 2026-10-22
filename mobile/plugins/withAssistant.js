// Config plugin: register Branch Agent's voice interaction services on the generated Android app.
// Some Android builds only list apps with a VoiceInteractionService under Default apps › Digital assistant app.
// android/ is produced by prebuild and never committed, so this has to live here.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const BIND_PERMISSION = 'android.permission.BIND_VOICE_INTERACTION';
const SERVICE_CLASS = 'expo.modules.assistant.BranchVoiceInteractionService';
const SESSION_CLASS = 'expo.modules.assistant.BranchVoiceInteractionSessionService';
const RECOGNITION_CLASS = 'expo.modules.assistant.BranchRecognitionService';
const SERVICE_INFO = '@xml/branch_voice_interaction_service';

const SERVICES = [
  {
    $: { 'android:name': SERVICE_CLASS, 'android:exported': 'true', 'android:label': '@string/branch_assistant_label', 'android:permission': BIND_PERMISSION },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.voice.VoiceInteractionService' } }] }],
    'meta-data': [{ $: { 'android:name': 'android.voice_interaction', 'android:resource': SERVICE_INFO } }],
  },
  {
    $: { 'android:name': SESSION_CLASS, 'android:exported': 'true', 'android:permission': BIND_PERMISSION },
  },
  {
    $: { 'android:name': RECOGNITION_CLASS, 'android:exported': 'true', 'android:label': '@string/branch_assistant_label' },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }] }],
  },
];

function ensureVoiceInteractionServices(androidManifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  app.service = app.service || [];
  for (const service of SERVICES) {
    const name = service.$['android:name'];
    if (!app.service.some((existing) => existing.$?.['android:name'] === name)) {
      app.service.push(JSON.parse(JSON.stringify(service)));
    }
  }
  return androidManifest;
}

function withAssistant(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = ensureVoiceInteractionServices(mod.modResults);
    return mod;
  });
}

module.exports = withAssistant;
module.exports.ensureVoiceInteractionServices = ensureVoiceInteractionServices;
module.exports.SERVICE_CLASS = SERVICE_CLASS;
module.exports.SESSION_CLASS = SESSION_CLASS;
module.exports.RECOGNITION_CLASS = RECOGNITION_CLASS;
module.exports.BIND_PERMISSION = BIND_PERMISSION;
