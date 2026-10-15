/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const mobileRoot = path.join(__dirname, '../..');
const helper = path.join(mobileRoot, 'scripts/android-release.mjs');
const workflow = readFileSync(path.join(mobileRoot, '../.github/workflows/mobile-android-release.yml'), 'utf8');
const secrets = {
  ANDROID_KEYSTORE_B64: 'cGti',
  ANDROID_KEYSTORE_PASSWORD: 'store-secret',
  ANDROID_KEY_PASSWORD: 'key-secret',
  ANDROID_KEY_ALIAS: 'branch',
};

function call(name: string, ...args: unknown[]) {
  const source = args.length === 0
    ? `import * as m from ${JSON.stringify(helper)}; console.log(JSON.stringify(m[${JSON.stringify(name)}]));`
    : `import * as m from ${JSON.stringify(helper)}; console.log(JSON.stringify(m[${JSON.stringify(name)}](...${JSON.stringify(args)})));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
}

function planFromCli(env: NodeJS.Dict<string>) {
  return JSON.parse(execFileSync(process.execPath, [helper, '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function callResult(name: string, ...args: unknown[]) {
  const source = `import * as m from ${JSON.stringify(helper)};
    try { console.log(JSON.stringify({ ok: true, value: m[${JSON.stringify(name)}](...${JSON.stringify(args)}) })); }
    catch (error) { console.log(JSON.stringify({ ok: false, message: String(error.message) })); }`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
}

function planCliResult(env: NodeJS.Dict<string>) {
  try {
    const stdout = execFileSync(process.execPath, [helper, '--json'], {
      cwd: mobileRoot,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; status?: number };
    return { ok: false, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? ''), status: err.status };
  }
}

describe('Android release version and signing plan', () => {
  it('uses the workflow run number as versionCode so each release is newer than the last', () => {
    expect(call('versionCode', { tag: 'v12', runNumber: 3 })).toBe(3);
    expect(call('versionCode', { tag: 'v0.4.4', runNumber: 99 })).toBe(99);
    expect(call('versionCode', { tag: 'v0.4.4-build-d0c144af53a8', runNumber: 77 })).toBe(77);
    expect(call('versionCode', { runNumber: 10 })).toBeGreaterThan(call('versionCode', { runNumber: 9 }));
    expect(call('releaseVersion', { tag: 'v0.4.4-build-d0c144af53a8', runNumber: 77 })).toBe('0.4.4-build-d0c144af53a8');
    expect(call('releaseVersion', { runNumber: 8, fallbackVersion: '0.1.0' })).toBe('0.1.0');
  });

  it('names the APK branch-android-<version>.apk and labels an unsigned build', () => {
    expect(call('apkFileName', '0.4.4-build-abc', { signed: true })).toBe('branch-android-0.4.4-build-abc.apk');
    expect(call('apkFileName', '0.4.4', { signed: false })).toBe('branch-android-0.4.4-unsigned.apk');
  });

  it('attaches to a GitHub release only when every signing secret is present and a tag exists', () => {
    const names: string[] = call('SIGNING_SECRET_NAMES');
    expect(call('missingSigningSecrets', { ANDROID_KEYSTORE_B64: 'x' })).toEqual(
      names.filter((name) => name !== 'ANDROID_KEYSTORE_B64'),
    );
    expect(call('shouldAttachToRelease', { signed: true, releaseTag: 'v0.4.4-build-abc' })).toBe(true);
    expect(call('shouldAttachToRelease', { signed: false, releaseTag: 'v0.4.4-build-abc' })).toBe(false);
    expect(call('shouldAttachToRelease', { signed: true, releaseTag: '' })).toBe(false);
    const unsigned = call('releasePlan', { tag: 'v0.4.4-build-abc', runNumber: 4, env: {} });
    expect(unsigned.attachRelease).toBe(false);
    expect(unsigned.signed).toBe(false);
    expect(unsigned.apkName).toBe('branch-android-0.4.4-build-abc-unsigned.apk');
    expect(call('missingSigningError', unsigned.missing)).toMatch(/must fail and never fall back to debug signing/);
    const signed = call('releasePlan', { tag: 'v0.4.4-build-abc', runNumber: 4, env: secrets });
    expect(signed.attachRelease).toBe(true);
    expect(signed.apkName).toBe('branch-android-0.4.4-build-abc.apk');
    expect(signed.sha256Name).toBe('branch-android-0.4.4-build-abc.apk.sha256');
    expect(signed.versionCode).toBe(4);
    expect(unsigned.sha256Name).toBe('');
  });

  it('passes PKCS12 signing to gradle only when the keystore path and secrets are set', () => {
    expect(call('gradleAssembleArgs', {})).toEqual(['assembleRelease']);
    expect(call('gradleSigningEnv', {})).toEqual({});
    const env = {
      ...secrets,
      ANDROID_KEYSTORE_PATH: '/tmp/android-release.p12',
      ANDROID_VERSION_CODE: '4',
      ANDROID_VERSION_NAME: '0.4.4',
    };
    const args: string[] = call('gradleAssembleArgs', env);
    expect(args[0]).toBe('assembleRelease');
    expect(args).toContain('-Pandroid.injected.version.code=4');
    expect(args).toContain('-Pandroid.injected.signing.store.type=PKCS12');
    expect(args).toContain('-Pandroid.injected.signing.store.file=/tmp/android-release.p12');
    const signingEnv = call('gradleSigningEnv', env);
    expect(signingEnv[call('GRADLE_SIGNING_STORE_PASSWORD_ENV')]).toBe('store-secret');
    expect(signingEnv[call('GRADLE_SIGNING_KEY_PASSWORD_ENV')]).toBe('key-secret');
    expect(signingEnv[call('GRADLE_SIGNING_KEY_ALIAS_ENV')]).toBe('branch');
  });

  it('injects PKCS12 signing from the decoded keystore path even when ANDROID_KEYSTORE_B64 is absent', () => {
    const env = {
      ANDROID_KEYSTORE_PATH: '/tmp/android-release.p12',
      ANDROID_KEYSTORE_PASSWORD: secrets.ANDROID_KEYSTORE_PASSWORD,
      ANDROID_KEY_PASSWORD: secrets.ANDROID_KEY_PASSWORD,
      ANDROID_KEY_ALIAS: secrets.ANDROID_KEY_ALIAS,
      ANDROID_VERSION_CODE: '4',
      ANDROID_VERSION_NAME: '0.4.4',
    };
    const args: string[] = call('gradleAssembleArgs', env);
    expect(args).toContain('-Pandroid.injected.signing.store.file=/tmp/android-release.p12');
    expect(args).toContain('-Pandroid.injected.signing.store.type=PKCS12');
    expect(call('gradleSigningEnv', env)[call('GRADLE_SIGNING_STORE_PASSWORD_ENV')]).toBe('store-secret');
    expect(call('signingReady', env)).toBe(false);
    expect(call('gradleSigningReady', env)).toBe(true);
  });

  it('fails assemble when release signing is required and the decoded keystore is missing', () => {
    const required = { REQUIRE_ANDROID_RELEASE_SIGNING: '1', ANDROID_VERSION_CODE: '4' };
    const failed = callResult('gradleAssembleArgs', required);
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(/must fail and never fall back to debug signing/);
    expect(failed.message).toContain('ANDROID_KEYSTORE_PATH');
    expect(callResult('gradleSigningEnv', required).ok).toBe(false);
  });

  it('rejects a debug signer certificate and accepts any other signer text', () => {
    expect(call('ANDROID_DEBUG_SIGNER')).toBe('CN=Android Debug');
    expect(call('isDebugSigner', 'Signer: CN=Android Debug, OU=Android, O=Android')).toBe(true);
    expect(call('isDebugSigner', 'Signer: CN=KeepOak, OU=Branch')).toBe(false);
    expect(callResult('assertNotDebugSigner', 'CN=Android Debug').ok).toBe(false);
    expect(callResult('assertNotDebugSigner', 'CN=KeepOak').ok).toBe(true);
  });

  it('never puts a signing password or key alias on any gradle command line', () => {
    const env = {
      ...secrets,
      ANDROID_KEYSTORE_PATH: '/tmp/android-release.p12',
      ANDROID_VERSION_CODE: '4',
      ANDROID_VERSION_NAME: '0.4.4',
    };
    const args: string[] = call('gradleAssembleArgs', env);
    const joined = args.join('\0');
    expect(joined).not.toContain('store-secret');
    expect(joined).not.toContain('key-secret');
    expect(args.some((arg) => /signing\.(store|key)\.password=/.test(arg))).toBe(false);
    expect(args.some((arg) => /signing\.key\.alias=/.test(arg))).toBe(false);
    expect(call('gradleSigningArgs', {
      keystorePath: env.ANDROID_KEYSTORE_PATH,
      storePassword: env.ANDROID_KEYSTORE_PASSWORD,
      keyAlias: env.ANDROID_KEY_ALIAS,
      keyPassword: env.ANDROID_KEY_PASSWORD,
    }).join('\0')).not.toMatch(/password=|alias=/);
  });

  it('writes versionCode onto a copy of app.json and leaves the original shape intact', () => {
    const stamped = call('applyAppJsonReleaseMeta', {
      expo: { version: '0.1.0', android: { package: 'com.keepoak.branch' } },
    }, { versionName: '0.4.4-build-abc', versionCode: 12 });
    expect(stamped.expo.version).toBe('0.4.4-build-abc');
    expect(stamped.expo.android).toEqual({ package: 'com.keepoak.branch', versionCode: 12 });
  });

  it('prints the same plan from the CLI that the workflow writes to GITHUB_OUTPUT', () => {
    const signed = planFromCli({ ...secrets, RELEASE_TAG: 'v0.4.4-build-abc', GITHUB_RUN_NUMBER: '9' });
    expect(signed).toMatchObject({
      signed: true,
      attachRelease: true,
      version: '0.4.4-build-abc',
      versionCode: 9,
      apkName: 'branch-android-0.4.4-build-abc.apk',
      sha256Name: 'branch-android-0.4.4-build-abc.apk.sha256',
    });
    const unsigned = planCliResult({
      RELEASE_TAG: 'v0.4.4-build-abc',
      GITHUB_RUN_NUMBER: '9',
      ANDROID_KEYSTORE_B64: '',
      ANDROID_KEYSTORE_PASSWORD: '',
      ANDROID_KEY_PASSWORD: '',
      ANDROID_KEY_ALIAS: '',
    });
    expect(unsigned.ok).toBe(false);
    expect(unsigned.stderr).toMatch(/must fail and never fall back to debug signing/);
    expect(unsigned.stdout).toBe('');
  });

  it('writes branch-android-<version>.apk.sha256 containing the APK hex SHA-256', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'android-sha256-'));
    try {
      const apkName = 'branch-android-0.4.4-build-abc.apk';
      const apkPath = path.join(dir, apkName);
      writeFileSync(apkPath, 'branch-apk-bytes');
      const expected = createHash('sha256').update('branch-apk-bytes').digest('hex');
      expect(call('sha256FileName', apkName)).toBe(`${apkName}.sha256`);
      const sidecar = JSON.parse(execFileSync(process.execPath, [helper, '--sha256', apkPath, '--json'], {
        cwd: mobileRoot,
        encoding: 'utf8',
      }));
      expect(sidecar).toEqual({
        path: `${apkPath}.sha256`,
        name: `${apkName}.sha256`,
        hex: expected,
      });
      expect(readFileSync(sidecar.path, 'utf8')).toBe(`${expected}  ${apkName}\n`);
      expect(sidecar.hex).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the mobile Android release workflow', () => {
  it('builds on a published release or a manual run, and never touches the merge gate', () => {
    expect(workflow).toMatch(/release:\s*\n\s*types:\s*\[[^\]]*published/);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?\btag:/);
    expect(workflow).toContain('npm run build:android');
    expect(workflow).not.toMatch(/merge-gate/);
  });

  it('decodes the PKCS12 keystore and fails when the secret is missing or empty', () => {
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_B64');
    expect(workflow).toContain('secrets.ANDROID_KEYSTORE_PASSWORD');
    expect(workflow).toContain('secrets.ANDROID_KEY_PASSWORD');
    expect(workflow).toContain('secrets.ANDROID_KEY_ALIAS');
    expect(workflow).toContain('RUNNER_TEMP');
    expect(workflow).toContain('base64 -d');
    expect(workflow).toContain('Release keystore secret is missing or empty');
    expect(workflow).not.toMatch(/if: steps\.plan\.outputs\.signed == 'true'/);
    expect(workflow).not.toMatch(/ANDROID_KEYSTORE_PASSWORD: ['"][^$'"]+/);
  });

  it('passes every signing secret into the Gradle build and never uploads a debug-signed APK', () => {
    expect(workflow).toMatch(
      /Build the Android APK[\s\S]*ANDROID_KEYSTORE_B64: \$\{\{\s*secrets\.ANDROID_KEYSTORE_B64\s*\}\}[\s\S]*npm run build:android/,
    );
    expect(workflow).toContain('REQUIRE_ANDROID_RELEASE_SIGNING');
    expect(workflow).toContain('ANDROID_KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_B64 }}');
    expect(workflow).toMatch(/apksigner verify --print-certs[\s\S]*actions\/upload-artifact/);
    expect(workflow).not.toMatch(/actions\/upload-artifact[\s\S]*apksigner verify --print-certs/);
    expect(workflow).toContain('CN=Android Debug');
    expect(workflow).not.toContain('Unsigned Android APK');
  });

  it('uploads the APK as an artifact after the signer check, and attaches only a signed APK to the GitHub release', () => {
    expect(workflow).toMatch(/actions\/upload-artifact@[0-9a-f]{40}/);
    expect(workflow).toContain('scripts/android-release.mjs');
    expect(workflow).toContain('apk_name');
    expect(workflow).toMatch(/if: steps\.plan\.outputs\.attach_release == 'true'/);
    expect(workflow).toMatch(/attach_release == 'true'[\s\S]*gh release upload/);
    expect(workflow).not.toMatch(/gh release upload[\s\S]*attach_release == 'false'/);
    expect(workflow).toContain('timeout-minutes:');
    expect(workflow).toContain('persist-credentials: false');
  });

  it('writes a hex SHA-256 sidecar and attaches it with the signed APK', () => {
    expect(workflow).toContain('--sha256');
    expect(workflow).toContain('SHA256_NAME');
    expect(workflow).toContain('${APK_NAME}.sha256');
    expect(workflow).toMatch(/--sha256[\s\S]*Verify APK signature/);
    expect(workflow).toMatch(/attach_release == 'true'[\s\S]*SHA256_PATH[\s\S]*gh release upload/);
    expect(workflow).not.toMatch(/--sha256[\s\S]*attach_release == 'false'/);
  });

  it('verifies the APK certificate fingerprint matches the expected release key SHA-256', () => {
    expect(workflow).toContain('ANDROID_RELEASE_CERT_SHA256');
    expect(workflow).toMatch(/85:B3:4C:E5:18:D8:74:9C:E0:06:4B:75:68:DE:75:0C:27:94:CB:17:0D:BB:E1:ED:4C:A0:62:29:E4:EB:46:C9/);
    expect(workflow).toContain('EXPECTED_CERT_SHA256');
    expect(workflow).toContain('Signer #1 certificate SHA-256 digest');
    expect(workflow).toContain('Certificate fingerprint mismatch');
    expect(workflow).toMatch(/Verify APK signature[\s\S]*apksigner verify --print-certs/);
    expect(workflow).toMatch(/Verify APK signature[\s\S]*Upload the APK as a workflow artifact/);
  });

  it('fails the verification step if the APK is unsigned or the fingerprint check fails', () => {
    expect(workflow).toContain('APK signature verification failed or APK is unsigned');
    expect(workflow).toContain('Could not extract SHA-256 certificate fingerprint');
    expect(workflow).toMatch(/if \[\[ -z "\$\{EXPECTED_CERT_SHA256\}" \]\]; then/);
    expect(workflow).toMatch(/if \[\[ -z "\$\{actual_sha256\}" \]\]; then/);
    expect(workflow).toMatch(/if \[\[ "\$\{actual_normalized\}" != "\$\{expected_normalized\}" \]\]; then/);
  });
});

describe('app.json restore stays local', () => {
  it('does not persist a keystore path when stamping version metadata', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'android-release-'));
    try {
      const file = path.join(dir, 'app.json');
      writeFileSync(file, `${JSON.stringify({ expo: { version: '0.1.0', android: { package: 'com.keepoak.branch' } } }, null, 2)}\n`);
      const stamped = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
        `import { applyAppJsonReleaseMeta } from ${JSON.stringify(helper)};
         import { readFileSync } from 'node:fs';
         console.log(JSON.stringify(applyAppJsonReleaseMeta(JSON.parse(readFileSync(${JSON.stringify(file)}, 'utf8')), { versionName: '1.2.3', versionCode: 10203 })));`,
      ], { encoding: 'utf8' }));
      expect(JSON.stringify(stamped)).not.toMatch(/keystore|password|\.p12|\.jks/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
