import { NativeModule, requireNativeModule } from 'expo';

export type ApkInstallerModuleEvents = Record<string, never>;

declare class ApkInstallerModule extends NativeModule<ApkInstallerModuleEvents> {
  canInstallPackages(): boolean;
  openInstallPermissionSettings(): void;
  sha256File(path: string): Promise<string>;
  installedSigningCerts(): Promise<string[]>;
  apkSigningCerts(path: string): Promise<string[]>;
  installApk(path: string): Promise<void>;
}

export default requireNativeModule<ApkInstallerModule>('ApkInstaller');
