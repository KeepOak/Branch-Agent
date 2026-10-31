import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import App from '../../App';
import { createFakeSession } from '../testing/fakeSession';
import { paletteSliceFor } from '../theme/desktopThemes';
import { PairingTheme, ThemeProvider } from '../theme/ThemeProvider';
import { pairingTheme, themeFor } from '../theme/tokens';
import { CANT_REACH_BRANCH } from '../ui/plainError';
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

describe('pairing stays itself when there is no Android update', () => {
  it('does not show an Update banner on iOS tests of the real app', async () => {
    const { session } = createFakeSession();
    await render(<App scheme="light" session={session} />);
    await eventually(() => expect(screen.getByTestId('camera-permission')).toBeOnTheScreen());
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});

describe('update error card', () => {
  it('never shows a raw exception, and paints the card black and white', async () => {
    const raw = 'fetch failed: java.net.UnknownHostException: Unable to resolve host "api.github.com"';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await render(
        <ThemeProvider scheme="light">
          <UpdateBanner state={{ status: 'error', message: raw }} onUpdate={() => undefined} onAllowInstalls={() => undefined} />
        </ThemeProvider>,
      );
      expect(screen.queryByText(/UnknownHostException/)).toBeNull();
      expect(screen.queryByText(/java\.net/)).toBeNull();
      expect(screen.queryByText(/fetch failed/i)).toBeNull();
      expect(screen.getByText(CANT_REACH_BRANCH)).toBeOnTheScreen();
      const style = StyleSheet.flatten(screen.getByTestId('update-banner').props.style);
      const light = themeFor('light', paletteSliceFor('grove', 'light')).color;
      expect(style.backgroundColor).toBe(light.fill);
      expect(style.backgroundColor).not.toBe(light.badTint);
      expect(style.borderColor).toBe(light.line);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the error card black and white under the pairing theme', async () => {
    const raw = 'java.net.UnknownHostException: Unable to resolve host "api.github.com"';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await render(
        <ThemeProvider scheme="dark">
          <PairingTheme>
            <UpdateBanner state={{ status: 'error', message: raw }} onUpdate={() => undefined} onAllowInstalls={() => undefined} />
          </PairingTheme>
        </ThemeProvider>,
      );
      expect(screen.queryByText(/UnknownHostException/)).toBeNull();
      expect(screen.getByText(CANT_REACH_BRANCH)).toBeOnTheScreen();
      const style = StyleSheet.flatten(screen.getByTestId('update-banner').props.style);
      const dark = pairingTheme(themeFor('dark', paletteSliceFor('grove', 'dark'))).color;
      expect(style.backgroundColor).toBe(dark.fill);
      expect(style.backgroundColor).not.toBe(dark.badTint);
    } finally {
      warn.mockRestore();
    }
  });
});
