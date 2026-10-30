// Dynamic Expo config on top of app.json. EAS Update URL and project ID come from the environment
// only, never from the repo. Unset, updates stay disabled so a sideloaded APK is a safe no-op.
const app = require('./app.json');

const version = app.expo.version;
const versionCode = app.expo.android?.versionCode ?? 1;
const updateUrl = process.env.EXPO_UPDATE_URL || '';
const projectId = process.env.EAS_PROJECT_ID || '';

module.exports = {
  expo: {
    ...app.expo,
    // Native version, so a JS-only OTA never applies across a version or versionCode bump.
    runtimeVersion: `${version}.${versionCode}`,
    updates: updateUrl
      ? {
          url: updateUrl,
          enabled: true,
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
        }
      : { enabled: false },
    extra: {
      ...(app.expo.extra ?? {}),
      ...(projectId ? { eas: { projectId } } : {}),
    },
  },
};
