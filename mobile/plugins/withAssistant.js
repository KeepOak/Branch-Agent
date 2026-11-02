// Config plugin: register Branch Agent's voice interaction services on the generated Android app.
// Some Android builds only list apps with a VoiceInteractionService under Default apps › Digital assistant app.
// android/ is produced by prebuild and never committed, so this has to live here.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const BIND_VOICE_PERMISSION = 'android.permission.BIND_VOICE_INTERACTION';
const BIND_RECOGNITION_PERMISSION = 'android.permission.BIND_RECOGNITION_SERVICE';
const SERVICE_CLASS = 'expo.modules.assistant.BranchVoiceInteractionService';
const SESSION_CLASS = 'expo.modules.assistant.BranchVoiceInteractionSessionService';
const RECOGNITION_CLASS = 'expo.modules.assistant.BranchRecognitionService';
const SERVICE_INFO = '@xml/branch_voice_interaction_service';
const RECOGNITION_INFO = '@xml/branch_recognition_service';

const SERVICES = [
  {
    $: {
      'android:name': SERVICE_CLASS,
      'android:exported': 'true',
      'android:label': '@string/branch_assistant_label',
      'android:permission': BIND_VOICE_PERMISSION,
    },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.service.voice.VoiceInteractionService' } }] }],
    'meta-data': [{ $: { 'android:name': 'android.voice_interaction', 'android:resource': SERVICE_INFO } }],
  },
  {
    $: {
      'android:name': SESSION_CLASS,
      'android:exported': 'true',
      'android:permission': BIND_VOICE_PERMISSION,
    },
  },
  {
    $: {
      'android:name': RECOGNITION_CLASS,
      'android:exported': 'true',
      'android:label': '@string/branch_assistant_label',
      'android:permission': BIND_RECOGNITION_PERMISSION,
    },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }] }],
    'meta-data': [{ $: { 'android:name': 'android.speech', 'android:resource': RECOGNITION_INFO } }],
  },
];

function upsertService(app, service) {
  app.service = app.service || [];
  const name = service.$['android:name'];
  const copy = JSON.parse(JSON.stringify(service));
  const index = app.service.findIndex((existing) => existing.$?.['android:name'] === name);
  if (index === -1) {
    app.service.push(copy);
  } else {
    // Keep attrs current (e.g. BIND_RECOGNITION_SERVICE) when the service was added by an older plugin or the library manifest.
    app.service[index] = copy;
  }
}

function ensureVoiceInteractionServices(androidManifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  for (const service of SERVICES) {
    upsertService(app, service);
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
module.exports.BIND_PERMISSION = BIND_VOICE_PERMISSION;
module.exports.BIND_VOICE_PERMISSION = BIND_VOICE_PERMISSION;
module.exports.BIND_RECOGNITION_PERMISSION = BIND_RECOGNITION_PERMISSION;
