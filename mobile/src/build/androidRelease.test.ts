/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SIGNING_SECRET_NAMES,
  apkFileName,
  applyAppJsonReleaseMeta,
  gradleAssembleArgs,
  missingSigningSecrets,
  releasePlan,
  releaseVersion,
  shouldAttachToRelease,
  unsignedWarning,
  versionCode,
} from '../../scripts/android-release.mjs';

const mobileRoot = path.join(__dirname, '../..');
const workflow = readFileSync(path.join(mobileRoot, '../.github/workflows/mobile-android-release.yml'), 'utf8');
const secrets = {
  ANDROID_KEYSTORE_B64: 'cGti',
  ANDROID_KEYSTORE_PASSWORD: 'store-secret',
  ANDROID_KEY_PASSWORD: 'key-secret',
  ANDROID_KEY_ALIAS: 'branch',
};

function planFromCli(env: NodeJS.Dict<string>) {
  return JSON.parse(execFileSync(process.execPath, ['scripts/android-release.mjs', '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }));
}

describe('Android release version and signing plan', () => {
  it('takes versionCode from a numeric or exact semver tag, otherwise the run number', () => {
    expect(versionCode({ tag: 'v12', runNumber: 3 })).toBe(12);
    expect(versionCode({ tag: 'v0.4.4', runNumber: 99 })).toBe(404);
    expect(versionCode({ tag: 'v0.4.4-build-d0c144af53a8', runNumber: 77 })).toBe(77);
    expect(releaseVersion({ tag: 'v0.4.4-build-d0c144af53a8', runNumber: 77 })).toBe('0.4.4-build-d0c144af53a8');
    expect(releaseVersion({ runNumber: 8, fallbackVersion: '0.1.0' })).toBe('0.1.0');
  });

  it('names the APK branch-android-<version>.apk and labels an unsigned build', () => {
    expect(apkFileName('0.4.4-build-abc', { signed: true })).toBe('branch-android-0.4.4-build-abc.apk');
    expect(apkFileName('0.4.4', { signed: false })).toBe('branch-android-0.4.4-unsigned.apk');
  });

  it('attaches to a GitHub release only when every signing secret is present and a tag exists', () => {
    expect(missingSigningSecrets({ ANDROID_KEYSTORE_B64: 'x' })).toEqual(
      SIGNING_SECRET_NAMES.filter((name) => name !== 'ANDROID_KEYSTORE_B64'),
    );
    expect(shouldAttachToRelease({ signed: true, releaseTag: 'v0.4.4-build-abc' })).toBe(true);
    expect(shouldAttachToRelease({ signed: false, releaseTag: 'v0.4.4-build-abc' })).toBe(false);
    expect(shouldAttachToRelease({ signed: true, releaseTag: '' })).toBe(false);
    const unsigned = releasePlan({ tag: 'v0.4.4-build-abc', runNumber: 4, env: {} });
    expect(unsigned.attachRelease).toBe(false);
    expect(unsigned.signed).toBe(false);
    expect(unsigned.apkName).toBe('branch-android-0.4.4-build-abc-unsigned.apk');
    expect(unsignedWarning(unsigned.missing)).toMatch(/will not be attached to the GitHub release/);
    const signed = releasePlan({ tag: 'v0.4.4-build-abc', runNumber: 4, env: secrets });
    expect(signed.attachRelease).toBe(true);
    expect(signed.apkName).toBe('branch-android-0.4.4-build-abc.apk');
    expect(signed.versionCode).toBe(4);
  });

  it('passes PKCS12 signing to gradle only when the keystore path and secrets are set', () => {
    expect(gradleAssembleArgs({})).toEqual(['assembleRelease']);
    const args = gradleAssembleArgs({
      ...secrets,
      ANDROID_KEYSTORE_PATH: '/tmp/android-release.p12',
      ANDROID_VERSION_CODE: '4',
      ANDROID_VERSION_NAME: '0.4.4',
    });
    expect(args[0]).toBe('assembleRelease');
    expect(args).toContain('-Pandroid.injected.version.code=4');
    expect(args).toContain('-Pandroid.injected.signing.store.type=PKCS12');
    expect(args).toContain('-Pandroid.injected.signing.store.file=/tmp/android-release.p12');
    expect(args.some((arg) => arg.includes('store-secret'))).toBe(true);
  });

  it('writes versionCode onto a copy of app.json and leaves the original shape intact', () => {
    const next = applyAppJsonReleaseMeta({ expo: { version: '0.1.0', android: { package: 'com.keepoak.branch' } } }, {
      versionName: '0.4.4-build-abc',
      versionCode: 12,
    });
    expect(next.expo.version).toBe('0.4.4-build-abc');
    expect(next.expo.android).toEqual({ package: 'com.keepoak.branch', versionCode: 12 });
  });

  it('prints the same plan from the CLI that the workflow writes to GITHUB_OUTPUT', () => {
    const signed = planFromCli({ ...secrets, RELEASE_TAG: 'v0.4.4-build-abc', GITHUB_RUN_NUMBER: '9' });
    expect(signed).toMatchObject({
      signed: true,
      attachRelease: true,
      version: '0.4.4-build-abc',
      versionCode: 9,
      apkName: 'branch-android-0.4.4-build-abc.apk',
    });
    const unsigned = planFromCli({ RELEASE_TAG: 'v0.4.4-build-abc', GITHUB_RUN_NUMBER: '9', ANDROID_KEYSTORE_B64: '' });
    expect(unsigned.attachRelease).toBe(false);
    expect(unsigned.apkName).toContain('-unsigned.apk');
  });
});

describe('the mobile Android release workflow', () => {
  it('builds on a published release or a manual run, and never touches the merge gate', () => {
    expect(workflow).toMatch(/release:\s*\n\s*types:\s*\[[^\]]*published/);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('npm run build:android');
    expect(workflow).not.toMatch(/merge-gate/);
  });

  it('decodes the PKCS12 keystore to the runner temp dir and skips a missing secret without failing', () => {
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_B64');
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_PASSWORD');
    expect(workflow).toContain('secrets.ANDROID_KEY_PASSWORD');
    expect(workflow).toContain('secrets.ANDROID_KEY_ALIAS');
    expect(workflow).toContain('runner.temp');
    expect(workflow).toContain('base64 -d');
    expect(workflow).toMatch(/if: steps\.plan\.outputs\.signed == 'true'/);
    expect(workflow).not.toMatch(/ANDROID_KEYSTORE_PASSWORD: ['"][^$'"]+/);
  });

  it('uploads every APK as an artifact, and attaches only a signed APK to the GitHub release', () => {
    expect(workflow).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
    expect(workflow).toContain('branch-android-');
    expect(workflow).toMatch(/if: steps\.plan\.outputs\.attach_release == 'true'/);
    expect(workflow).toMatch(/attach_release == 'true'[\s\S]*gh release upload/);
    expect(workflow).not.toMatch(/gh release upload[\s\S]*attach_release == 'false'/);
    expect(workflow).toContain('timeout-minutes:');
    expect(workflow).toContain('persist-credentials: false');
  });
});

describe('app.json restore stays local', () => {
  it('does not persist a keystore path when stamping version metadata', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'android-release-'));
    try {
      const file = path.join(dir, 'app.json');
      writeFileSync(file, `${JSON.stringify({ expo: { version: '0.1.0', android: { package: 'com.keepoak.branch' } } }, null, 2)}\n`);
      const stamped = applyAppJsonReleaseMeta(JSON.parse(readFileSync(file, 'utf8')), { versionName: '1.2.3', versionCode: 10203 });
      expect(JSON.stringify(stamped)).not.toMatch(/keystore|password|\.p12|\.jks/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
