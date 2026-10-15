import { findNewerApk, offerFromRelease, type GithubRelease } from './githubRelease';

const apk = (name: string, extra: string[] = []): GithubRelease => ({
  draft: false,
  prerelease: false,
  tag_name: `v${name.replace('branch-android-', '').replace('.apk', '')}`,
  assets: [
    { name, browser_download_url: `https://example.test/${name}`, size: 10 },
    ...extra.map((item) => ({ name: item, browser_download_url: `https://example.test/${item}`, size: 64 })),
  ],
});

describe('GitHub APK releases', () => {
  it('needs a published APK and a .sha256 sidecar', () => {
    expect(offerFromRelease(apk('branch-android-0.2.0.apk'))).toBeNull();
    expect(offerFromRelease({ ...apk('branch-android-0.2.0.apk', ['branch-android-0.2.0.apk.sha256']), draft: true })).toBeNull();
    expect(offerFromRelease(apk('branch-android-0.2.0.apk', ['branch-android-0.2.0.apk.sha256']))?.version).toBe('0.2.0');
  });

  it('picks the newest APK that is newer than this install', () => {
    const releases = [
      apk('branch-android-0.1.0.apk', ['branch-android-0.1.0.apk.sha256']),
      apk('branch-android-0.3.0.apk', ['branch-android-0.3.0.apk.sha256']),
      apk('branch-android-0.2.0.apk', ['branch-android-0.2.0.apk.sha256']),
    ];
    expect(findNewerApk(releases, { version: '0.1.0', versionCode: 1 })?.version).toBe('0.3.0');
    expect(findNewerApk(releases, { version: '0.3.0', versionCode: 3 })).toBeNull();
  });
});
