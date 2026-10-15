import { CERT_MISMATCH_MESSAGE, CHECKSUM_MISMATCH_MESSAGE } from './verify';
import { createUpdateFlow, type UpdateFlowDeps } from './updateFlow';
import type { ApkOffer } from './githubRelease';

const HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const OTHER = '0'.repeat(64);

const offer: ApkOffer = {
  version: '0.2.0',
  remote: { name: '0.2.0' },
  tag: 'v0.2.0',
  apk: { name: 'branch-android-0.2.0.apk', browser_download_url: 'https://example.test/app.apk', size: 20 },
  sha256: { name: 'branch-android-0.2.0.apk.sha256', browser_download_url: 'https://example.test/app.apk.sha256', size: 80 },
};

function deps(overrides: Partial<UpdateFlowDeps> & { canInstall?: boolean } = {}): UpdateFlowDeps & { installApk: jest.Mock; openInstallPermissionSettings: jest.Mock } {
  let canInstall = overrides.canInstall ?? true;
  const installApk = jest.fn(async () => undefined);
  const openInstallPermissionSettings = jest.fn(() => undefined);
  return {
    local: { version: '0.1.0', versionCode: 1 },
    cacheDir: '/cache/',
    fetchReleases: async () => [
      {
        draft: false,
        prerelease: false,
        tag_name: 'v0.2.0',
        assets: [offer.apk, offer.sha256],
      },
    ],
    download: async (_url, _dest, onProgress) => {
      onProgress(0.4);
      onProgress(1);
    },
    readText: async () => `${HEX}  branch-android-0.2.0.apk\n`,
    sha256File: async () => HEX,
    installedSigningCerts: async () => ['aa'],
    apkSigningCerts: async () => ['aa'],
    canInstallPackages: () => canInstall,
    setCanInstall: (value: boolean) => {
      canInstall = value;
    },
    openInstallPermissionSettings,
    installApk,
    ...overrides,
    ...(overrides.canInstall == null ? {} : { canInstallPackages: () => canInstall }),
  } as UpdateFlowDeps & { installApk: jest.Mock; openInstallPermissionSettings: jest.Mock; setCanInstall: (value: boolean) => void };
}

const wait = (flow: ReturnType<typeof createUpdateFlow>, status: string) =>
  new Promise<void>((resolve, reject) => {
    const stop = flow.subscribe((state) => {
      if (state.status === status) {
        stop();
        resolve();
      }
    });
    setTimeout(() => {
      stop();
      reject(new Error(`timed out waiting for ${status}, last ${flow.getState().status}`));
    }, 1000);
  });

describe('update flow', () => {
  it('finds a newer APK and installs it after checksum and cert checks', async () => {
    const wired = deps();
    const flow = createUpdateFlow(wired);
    await flow.check();
    expect(flow.getState()).toMatchObject({ status: 'available', offer: { version: '0.2.0' } });
    const done = wait(flow, 'installing');
    await flow.startUpdate();
    await done;
    expect(wired.installApk).toHaveBeenCalledWith('/cache/apk-updates/branch-android-update.apk');
  });

  it('refuses to install when the checksum does not match', async () => {
    const wired = deps({ sha256File: async () => OTHER });
    const flow = createUpdateFlow(wired);
    await flow.check();
    await flow.startUpdate();
    expect(flow.getState()).toEqual({ status: 'error', message: CHECKSUM_MISMATCH_MESSAGE, offer });
    expect(wired.installApk).not.toHaveBeenCalled();
  });

  it('refuses to install when the signing certificate does not match', async () => {
    const wired = deps({ apkSigningCerts: async () => ['bb'] });
    const flow = createUpdateFlow(wired);
    await flow.check();
    await flow.startUpdate();
    expect(flow.getState()).toEqual({ status: 'error', message: CERT_MISMATCH_MESSAGE, offer });
    expect(wired.installApk).not.toHaveBeenCalled();
  });

  it('explains the install-unknown-apps permission, opens Settings, and resumes when the user comes back', async () => {
    let allowed = false;
    const installApk = jest.fn(async () => undefined);
    const open = jest.fn();
    const wired = deps({
      canInstallPackages: () => allowed,
      openInstallPermissionSettings: open,
      installApk,
    });
    const flow = createUpdateFlow(wired);
    await flow.check();
    await flow.startUpdate();
    expect(flow.getState().status).toBe('needsPermission');
    expect(installApk).not.toHaveBeenCalled();

    flow.allowInstalls();
    expect(open).toHaveBeenCalledTimes(1);

    await flow.onAppActive();
    expect(flow.getState().status).toBe('needsPermission');
    expect(installApk).not.toHaveBeenCalled();

    allowed = true;
    const done = wait(flow, 'installing');
    await flow.onAppActive();
    await done;
    expect(installApk).toHaveBeenCalledTimes(1);
  });
});
