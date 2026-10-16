// The version the stores show, and the native build number when the OS has one.
// Pairing already sends expoConfig.version as the client version; Settings reads the same source.
import Constants from 'expo-constants';

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

/** App version and build number from Expo's config and the native binary. */
export function appIdentity(source: AppIdentitySource = Constants): AppIdentity {
  const version = source.expoConfig?.version ?? source.nativeAppVersion ?? '0.0.0';
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
