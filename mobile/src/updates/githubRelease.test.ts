/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findNewerApk, offerFromRelease, type GithubRelease } from './githubRelease';

const mobileRoot = path.join(__dirname, '../..');
const helper = path.join(mobileRoot, 'scripts/android-release.mjs');
const workflow = readFileSync(path.join(mobileRoot, '../.github/workflows/mobile-android-release.yml'), 'utf8');
const secrets = {
  ANDROID_KEYSTORE_B64: 'cGti',
  ANDROID_KEYSTORE_PASSWORD: 'store-secret',
  ANDROID_KEY_PASSWORD: 'key-secret',
  ANDROID_KEY_ALIAS: 'branch',
};

const apk = (name: string, extra: string[] = [], tag?: string): GithubRelease => ({
  draft: false,
  prerelease: false,
  tag_name: tag ?? `v${name.replace('branch-android-', '').replace('.apk', '')}`,
  assets: [
    { name, browser_download_url: `https://example.test/${name}`, size: 10 },
    ...extra.map((item) => ({ name: item, browser_download_url: `https://example.test/${item}`, size: 64 })),
  ],
});

function planFromCli(env: NodeJS.Dict<string>) {
  return JSON.parse(execFileSync(process.execPath, [helper, '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }));
}

describe('GitHub APK releases', () => {
  it('needs a published APK and a .sha256 sidecar', () => {
    expect(offerFromRelease(apk('branch-android-0.2.0.apk'))).toBeNull();
    expect(offerFromRelease({ ...apk('branch-android-0.2.0.apk', ['branch-android-0.2.0.apk.sha256']), draft: true })).toBeNull();
    expect(offerFromRelease(apk('branch-android-0.2.0.apk', ['branch-android-0.2.0.apk.sha256']))?.version).toBe('0.2.0');
    expect(offerFromRelease(apk('branch-android-0.2.0-unsigned.apk', ['branch-android-0.2.0-unsigned.apk.sha256']))).toBeNull();
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

  it('reads versionCode from the run-number sidecar while the APK stays branch-android-<version>.apk', () => {
    const release = apk('branch-android-0.4.4.apk', [
      'branch-android-0.4.4.apk.sha256',
      'branch-android-0.4.4.apk.versioncode.13',
    ]);
    expect(offerFromRelease(release)?.remote).toEqual({ name: '0.4.4', versionCode: 13 });
    expect(findNewerApk([release], { version: '0.4.4', versionCode: 12 })?.remote.versionCode).toBe(13);
    expect(findNewerApk([release], { version: '0.4.4', versionCode: 13 })).toBeNull();
  });

  it('reads versionCode from a +runNumber APK name, tag, or .sha256 name when no sidecar is attached', () => {
    expect(offerFromRelease(apk('branch-android-0.4.4+13.apk', ['branch-android-0.4.4+13.apk.sha256']))?.remote).toEqual({
      name: '0.4.4',
      versionCode: 13,
    });
    expect(offerFromRelease(apk(
      'branch-android-0.4.4.apk',
      ['branch-android-0.4.4.apk.sha256'],
      'v0.4.4+13',
    ))?.remote.versionCode).toBe(13);
    expect(offerFromRelease({
      ...apk('branch-android-0.4.4.apk', ['branch-android-0.4.4+13.apk.sha256']),
      name: 'Branch Agent 0.4.4',
    })?.remote.versionCode).toBe(13);
  });
});

describe('published Android APK assets', () => {
  it('parses versionCode from the asset names the release workflow actually uploads', () => {
    const plan = planFromCli({
      ...secrets,
      RELEASE_TAG: 'v0.4.4-build-abc',
      GITHUB_RUN_NUMBER: '13',
    });
    expect(plan).toMatchObject({
      signed: true,
      attachRelease: true,
      version: '0.4.4-build-abc',
      versionCode: 13,
      apkName: 'branch-android-0.4.4-build-abc.apk',
      sha256Name: 'branch-android-0.4.4-build-abc.apk.sha256',
      versioncodeName: 'branch-android-0.4.4-build-abc.apk.versioncode.13',
    });
    expect(workflow).toContain('gh release upload');
    expect(workflow).toMatch(/gh release upload[\s\S]*APK_NAME[\s\S]*SHA256_NAME[\s\S]*VERSIONCODE_NAME/);
    expect(workflow).toContain('versioncode_name');
    expect(workflow).toContain('ANDROID_VERSION_CODE');
    expect(workflow).toMatch(/SIGNED" == "true"[\s\S]*--sha256/);
    expect(workflow).toMatch(/Verify APK signature[\s\S]*VERSIONCODE_PATH[\s\S]*gh release upload/);
    expect(workflow).not.toMatch(/-unsigned\.apk[\s\S]*gh release upload/);
    expect(workflow).toMatch(/attach_release == 'true'[\s\S]*VERSIONCODE_PATH[\s\S]*gh release upload/);

    const release: GithubRelease = {
      draft: false,
      prerelease: false,
      tag_name: plan.releaseTag,
      assets: [plan.apkName, plan.sha256Name, plan.versioncodeName].map((name: string) => ({
        name,
        browser_download_url: `https://example.test/${name}`,
        size: 64,
      })),
    };
    expect(offerFromRelease(release)?.version).toBe(plan.version);
    expect(offerFromRelease(release)?.remote).toEqual({ name: '0.4.4-build-abc', versionCode: 13 });
    expect(findNewerApk([release], { version: '0.4.4-build-abc', versionCode: 12 })?.remote.versionCode).toBe(13);
    expect(findNewerApk([release], { version: '0.4.4-build-abc', versionCode: 13 })).toBeNull();
  });
});
