import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type ApkInstallerNative = {
  canInstallPackages: () => boolean;
  openInstallPermissionSettings: () => void;
  sha256File: (path: string) => Promise<string>;
  installedSigningCerts: () => Promise<string[]>;
  apkSigningCerts: (path: string) => Promise<string[]>;
  installApk: (path: string) => Promise<void>;
};

/** PackageManager + FileProvider live in the local Expo module. Missing native code is a no-op, not a crash. */
export function loadApkInstaller(): ApkInstallerNative | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<ApkInstallerNative>('ApkInstaller');
  } catch {
    return null;
  }
}

export function filePath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}
