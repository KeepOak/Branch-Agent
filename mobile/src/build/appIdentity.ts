// Settings, pairing and APK updates read the installed binary first (PackageManager /
// Info.plist via expo-application). The Expo config is only a fallback: release builds
// inject versionName/versionCode through gradle, while the JS bundle can still hold the
// app.json template (0.1.0 / Build 1).
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { installedVersion } from '../updates/versionCompare';

export type AppIdentitySource = {
  expoConfig?: {
    version?: string;
    ios?: { buildNumber?: string };
    android?: { versionCode?: number };
  } | null;
  platform?: {
    ios?: { buildNumber?: string | null };
    android?: { versionCode?: number | null };
  };
  nativeAppVersion?: string | null;
  nativeBuildVersion?: string | null;
};

export type AppIdentity = {
  version: string;
  build: string | null;
};

function nonempty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function code(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

/** Installed APK / IPA first, then Expo Constants. */
export function identitySource(): AppIdentitySource {
  const constants = Constants as AppIdentitySource;
  return {
    expoConfig: Constants.expoConfig,
    platform: Constants.platform,
    nativeAppVersion: nonempty(Application.nativeApplicationVersion) ?? nonempty(constants.nativeAppVersion),
    nativeBuildVersion: nonempty(Application.nativeBuildVersion) ?? nonempty(constants.nativeBuildVersion),
  };
}

/** App version and build number from the installed binary, then Expo's config. */
export function appIdentity(source: AppIdentitySource = identitySource()): AppIdentity {
  const version = nonempty(source.nativeAppVersion) ?? nonempty(source.expoConfig?.version) ?? '0.0.0';
  const build =
    nonempty(source.nativeBuildVersion) ??
    nonempty(source.expoConfig?.ios?.buildNumber) ??
    nonempty(source.platform?.ios?.buildNumber) ??
    code(source.expoConfig?.android?.versionCode) ??
    code(source.platform?.android?.versionCode);
  return { version, build };
}

export function versionLine(identity: AppIdentity): string {
  return identity.build ? `${identity.version} (${identity.build})` : identity.version;
}

/** Same versionName / versionCode Settings and the APK updater show. */
export function installedAppVersion(source: AppIdentitySource = identitySource()): { version: string; versionCode: number } {
  return installedVersion({
    nativeVersion: source.nativeAppVersion,
    nativeBuild: source.nativeBuildVersion,
    expoVersion: source.expoConfig?.version,
    expoVersionCode: source.expoConfig?.android?.versionCode ?? source.platform?.android?.versionCode,
  });
}
