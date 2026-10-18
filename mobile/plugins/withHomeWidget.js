// Config plugin: register the Ask Branch AppWidgetProvider on the generated Android
// app. android/ is produced by prebuild and never committed, so this has to live here.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const PROVIDER_CLASS = 'expo.modules.homewidget.HomeWidgetProvider';
const UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE';
const PROVIDER_INFO = '@xml/branch_home_widget_info';

function ensureHomeWidgetReceiver(androidManifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  app.receiver = app.receiver || [];
  const already = app.receiver.some((receiver) => receiver.$?.['android:name'] === PROVIDER_CLASS);
  if (!already) {
    app.receiver.push({
      $: {
        'android:name': PROVIDER_CLASS,
        'android:exported': 'true',
        'android:label': 'Ask Branch',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': UPDATE_ACTION } }],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': PROVIDER_INFO,
          },
        },
      ],
    });
  }
  return androidManifest;
}

function withHomeWidget(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = ensureHomeWidgetReceiver(mod.modResults);
    return mod;
  });
}

module.exports = withHomeWidget;
module.exports.ensureHomeWidgetReceiver = ensureHomeWidgetReceiver;
module.exports.PROVIDER_CLASS = PROVIDER_CLASS;
