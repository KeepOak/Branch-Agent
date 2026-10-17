import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import App from '../../App';
import { createFakeSession } from '../testing/fakeSession';
import { ThemeProvider } from '../theme/ThemeProvider';
import type { ApkOffer } from './githubRelease';
import { SettingsUpdateCard, UpdateBanner } from './UpdateBanner';
import type { UpdateFlowDeps } from './updateFlow';
import { useApkUpdate } from './useApkUpdate';

const HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const offer: ApkOffer = {
  version: '0.2.0',
  remote: { name: '0.2.0' },
  tag: 'v0.2.0',
  apk: { name: 'branch-android-0.2.0.apk', browser_download_url: 'https://example.test/app.apk', size: 20 },
  sha256: { name: 'branch-android-0.2.0.apk.sha256', browser_download_url: 'https://example.test/app.apk.sha256', size: 80 },
};

function fakeDeps(canInstall = true): UpdateFlowDeps {
  return {
    local: { version: '0.1.0', versionCode: 1 },
    cacheDir: '/cache/',
    fetchReleases: async () => [
      { draft: false, prerelease: false, tag_name: 'v0.2.0', assets: [offer.apk, offer.sha256] },
    ],
    download: async (_url, _dest, onProgress) => onProgress(1),
    readText: async () => `${HEX}  branch-android-0.2.0.apk\n`,
    sha256File: async () => HEX,
    installedSigningCerts: async () => ['aa'],
    apkSigningCerts: async () => ['aa'],
    canInstallPackages: () => canInstall,
    openInstallPermissionSettings: () => undefined,
    installApk: async () => undefined,
  };
}

function Host({ deps }: { deps: UpdateFlowDeps }) {
  const update = useApkUpdate(deps);
  return (
    <ThemeProvider scheme="light">
      <UpdateBanner state={update.state} onUpdate={update.startUpdate} onAllowInstalls={() => update.allowInstalls()} />
      <SettingsUpdateCard
        version="0.1.0"
        versionCode={1}
        state={update.state}
        onCheck={update.check}
        onUpdate={update.startUpdate}
        onAllowInstalls={() => update.allowInstalls()}
      />
    </ThemeProvider>
  );
}

const eventually = (check: () => void) => waitFor(check, { timeout: 3000 });

describe('update banner and Settings', () => {
  it('shows an Update banner and a Settings check when a newer APK is on GitHub', async () => {
    await render(<Host deps={fakeDeps()} />);
    await eventually(() => expect(screen.getByTestId('update-banner')).toBeOnTheScreen());
    expect(screen.getByText('Update available')).toBeOnTheScreen();
    expect(screen.getAllByTestId('update-button').length).toBeGreaterThan(0);
    expect(screen.getByTestId('update-settings-card')).toBeOnTheScreen();
    expect(screen.getByTestId('update-check')).toBeOnTheScreen();
    expect(screen.getByTestId('update-installed-version')).toHaveTextContent('0.1.0 (1)');
  });

  it('explains the unknown-apps permission from the banner', async () => {
    await render(<Host deps={fakeDeps(false)} />);
    await eventually(() => expect(screen.getAllByTestId('update-button').length).toBeGreaterThan(0));
    await fireEvent.press(screen.getAllByTestId('update-button')[0]);
    await eventually(() => expect(screen.getAllByTestId('update-allow-installs').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Allow it for Branch/).length).toBeGreaterThan(0);
  });
});

describe('welcome stays itself when there is no Android update', () => {
  it('does not show an Update banner on iOS tests of the real app', async () => {
    const { session } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('welcome-screen')).toBeOnTheScreen());
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});
