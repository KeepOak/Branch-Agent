// Config plugin: register the Ask Branch AppWidgetProvider on the generated Android
// app. android/ is produced by prebuild and never committed, so this has to live here.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const PROVIDER_CLASS = 'expo.modules.homewidget.HomeWidgetProvider';
const UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE';
const PROVIDER_INFO = '@xml/branch_home_widget_info';
const TALK_WIDGET_CLASS = 'expo.modules.homewidget.TalkWidgetProvider';
const TALK_WIDGET_INFO = '@xml/branch_talk_widget_info';
const TALK_TILE_CLASS = 'expo.modules.homewidget.TalkTileService';
const QS_TILE_ACTION = 'android.service.quicksettings.action.QS_TILE';

// One home-screen widget receiver, added once.
function ensureWidgetReceiver(androidManifest, className, label, info) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  app.receiver = app.receiver || [];
  if (!app.receiver.some((receiver) => receiver.$?.['android:name'] === className)) {
    app.receiver.push({
      $: { 'android:name': className, 'android:exported': 'true', 'android:label': label },
      'intent-filter': [{ action: [{ $: { 'android:name': UPDATE_ACTION } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': info } }],
    });
  }
  return androidManifest;
}

function ensureHomeWidgetReceiver(androidManifest) {
  return ensureWidgetReceiver(androidManifest, PROVIDER_CLASS, '@string/branch_home_widget_label', PROVIDER_INFO);
}

// The small Talk to Branch widget, next to Ask Branch. It shares the tile's label.
function ensureTalkWidgetReceiver(androidManifest) {
  return ensureWidgetReceiver(androidManifest, TALK_WIDGET_CLASS, '@string/branch_talk_tile_label', TALK_WIDGET_INFO);
}

// The Talk to Branch Quick Settings tile, added once, next to the widget.
function ensureTalkTileService(androidManifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  app.service = app.service || [];
  if (!app.service.some((service) => service.$?.['android:name'] === TALK_TILE_CLASS)) {
    app.service.push({
      $: {
        'android:name': TALK_TILE_CLASS,
        'android:exported': 'true',
        'android:icon': '@drawable/branch_talk_tile',
        'android:label': '@string/branch_talk_tile_label',
        'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
      },
      'intent-filter': [{ action: [{ $: { 'android:name': QS_TILE_ACTION } }] }],
    });
  }
  return androidManifest;
}

function withHomeWidget(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = ensureTalkTileService(ensureTalkWidgetReceiver(ensureHomeWidgetReceiver(mod.modResults)));
    return mod;
  });
}

module.exports = withHomeWidget;
module.exports.ensureHomeWidgetReceiver = ensureHomeWidgetReceiver;
module.exports.PROVIDER_CLASS = PROVIDER_CLASS;
module.exports.ensureTalkTileService = ensureTalkTileService;
module.exports.TALK_TILE_CLASS = TALK_TILE_CLASS;
module.exports.ensureTalkWidgetReceiver = ensureTalkWidgetReceiver;
module.exports.TALK_WIDGET_CLASS = TALK_WIDGET_CLASS;
