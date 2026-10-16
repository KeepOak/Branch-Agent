/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function callModule(source: string) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
  }));
}

function readProjectNdkVersion(): string | null {
  const app = JSON.parse(readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')) as {
    expo?: { plugins?: Array<string | [string, { android?: { ndkVersion?: string } }]> };
  };
  for (const plugin of app.expo?.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-build-properties') {
      const version = plugin[1]?.android?.ndkVersion;
      if (typeof version === 'string' && version.trim()) return version.trim();
    }
  }
  const files = [
    path.join(mobileRoot, 'node_modules/react-native/gradle/libs.versions.toml'),
    path.join(mobileRoot, 'node_modules/react-native/ReactAndroid/gradle/libs.versions.toml'),
    path.join(mobileRoot, 'node_modules/react-native/ReactAndroid/gradle.properties'),
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const toml = /^\s*ndkVersion\s*=\s*"([^"]+)"/m.exec(text);
    if (toml) return toml[1];
    const props = /^\s*ndkVersion\s*=\s*(\S+)/m.exec(text);
    if (props) return props[1].replace(/"/g, '');
  }
  return null;
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
    expect(call('LAST_SHIPPED_VERSION_CODE')).toBe(5);
    expect(call('versionCode', { tag: 'v12', runNumber: 3 })).toBe(6);
    expect(call('versionCode', { tag: 'v0.4.4', runNumber: 5 })).toBe(6);
    expect(call('versionCode', { tag: 'v0.4.4', runNumber: 99 })).toBe(99);
    expect(call('versionCode', { tag: 'v0.4.4-build-d0c144af53a8', runNumber: 77 })).toBe(77);
    expect(call('versionCode', { runNumber: 6 })).toBeGreaterThan(5);
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
    expect(signed.versioncodeName).toBe('branch-android-0.4.4-build-abc.apk.versioncode.6');
    expect(signed.versionCode).toBe(6);
    expect(signed.versionCode).toBeGreaterThan(call('LAST_SHIPPED_VERSION_CODE'));
    expect(unsigned.sha256Name).toBe('');
    expect(unsigned.versioncodeName).toBe('');
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
      versioncodeName: 'branch-android-0.4.4-build-abc.apk.versioncode.9',
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
        env: { ...process.env, ANDROID_VERSION_CODE: '' },
      }));
      expect(sidecar).toEqual({
        path: `${apkPath}.sha256`,
        name: `${apkName}.sha256`,
        hex: expected,
      });
      expect(readFileSync(sidecar.path, 'utf8')).toBe(`${expected}  ${apkName}\n`);
      expect(sidecar.hex).toMatch(/^[a-f0-9]{64}$/);
      const withCode = JSON.parse(execFileSync(process.execPath, [helper, '--sha256', apkPath, '--json'], {
        cwd: mobileRoot,
        encoding: 'utf8',
        env: { ...process.env, ANDROID_VERSION_CODE: '13' },
      }));
      expect(withCode.versioncode_name).toBe(`${apkName}.versioncode.13`);
      expect(readFileSync(withCode.versioncode_path, 'utf8')).toBe('13\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the mobile Android release workflow', () => {
  it('builds on a published release, a manual run, or a main push, and never touches the merge gate', () => {
    expect(workflow).toMatch(/release:\s*\n\s*types:\s*\[[^\]]*published/);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*?inputs:[\s\S]*?\btag:/);
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(workflow).toContain('npm run build:android');
    expect(workflow).not.toMatch(/merge-gate/);
    expect(workflow).not.toMatch(/^\s+pull_request:/m);
    expect(workflow).not.toMatch(/pull_request_target/);
  });

  it('installs the project NDK with sdkmanager before Gradle and caches that version', () => {
    const ndkInstall = workflow.indexOf('- name: Install the Android NDK');
    const gradleBuild = workflow.indexOf('npm run build:android');
    expect(ndkInstall).toBeGreaterThan(-1);
    expect(gradleBuild).toBeGreaterThan(ndkInstall);
    expect(workflow.indexOf('- name: Read the Android NDK version')).toBeGreaterThan(-1);
    expect(workflow.indexOf('- name: Read the Android NDK version')).toBeLessThan(ndkInstall);
    expect(workflow.indexOf('- name: Cache the Android NDK')).toBeGreaterThan(-1);
    expect(workflow.indexOf('- name: Cache the Android NDK')).toBeLessThan(ndkInstall);
    expect(workflow.indexOf('- name: Cache the Android NDK')).toBeLessThan(gradleBuild);
    expect(workflow).toMatch(/actions\/cache@[0-9a-f]{40}/);
    expect(workflow).toMatch(/key: android-ndk-\$\{\{\s*runner\.os\s*\}\}-\$\{\{\s*steps\.ndk\.outputs\.version\s*\}\}/);
    expect(workflow).toContain('libs.versions.toml');
    expect(workflow).toContain('expo-build-properties');
    expect(workflow).toContain('ndkVersion');
    expect(workflow).toMatch(/sdkmanager --sdk_root="\$\{ANDROID_SDK_ROOT\}" --install "ndk;\$\{NDK_VERSION\}"/);
    expect(workflow).toMatch(/attempt=1/);
    expect(workflow).toMatch(/attempt" -ge 3/);
    expect(workflow).toMatch(/delay=\$\(\(delay \* 2\)\)/);
    expect(workflow).toMatch(/sleep "\$\{delay\}"/);
    const sdkPackages = workflow.slice(
      workflow.indexOf('- name: Install Android SDK packages'),
      workflow.indexOf('- name: Install the phone app'),
    );
    expect(sdkPackages).not.toMatch(/ndk;/);
    const projectNdk = readProjectNdkVersion();
    if (projectNdk) {
      expect(projectNdk).toMatch(/^\d+\.\d+\.\d+$/);
      const fallback = /const fallback = '(\d+\.\d+\.\d+)'/.exec(workflow)?.[1];
      expect(fallback).toBe(projectNdk);
    }
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
    expect(workflow).toMatch(/gh release upload[\s\S]*--clobber/);
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

  it('attaches branch-android-<version>.apk.versioncode.<runNumber> with a signed APK', () => {
    expect(call('versionCodeFileName', 'branch-android-0.4.4-build-abc.apk', 13)).toBe(
      'branch-android-0.4.4-build-abc.apk.versioncode.13',
    );
    expect(workflow).toContain('VERSIONCODE_NAME');
    expect(workflow).toContain('ANDROID_VERSION_CODE');
    expect(workflow).toMatch(/Stage the APK[\s\S]*ANDROID_VERSION_CODE[\s\S]*SIGNED" == "true"[\s\S]*--sha256/);
    expect(workflow).toMatch(/Verify APK signature[\s\S]*VERSIONCODE_PATH[\s\S]*gh release upload/);
    expect(workflow).toMatch(/apksigner verify --print-certs[\s\S]*actions\/upload-artifact/);
    expect(workflow).toMatch(/attach_release == 'true'[\s\S]*VERSIONCODE_PATH[\s\S]*gh release upload/);
    expect(workflow).toContain('${APK_NAME}.versioncode.');
    expect(workflow).not.toMatch(/-unsigned\.apk[\s\S]*gh release upload/);
  });

  it('verifies the APK certificate fingerprint matches the expected release key SHA-256', () => {
    expect(workflow).toContain('ANDROID_RELEASE_CERT_SHA256');
    expect(workflow).toContain('vars.ANDROID_RELEASE_CERT_SHA256');
    expect(workflow).toContain('EXPECTED_CERT_SHA256');
    expect(workflow).toContain('Signer #1 certificate SHA-256 digest');
    expect(workflow).toContain('Certificate fingerprint mismatch');
    expect(workflow).toContain('--normalize-cert-sha256');
    expect(workflow).toMatch(/actual_normalized="\$\(node mobile\/scripts\/android-release\.mjs --normalize-cert-sha256 "\$actual_sha256"\)"/);
    expect(workflow).toMatch(/expected_normalized="\$\(node mobile\/scripts\/android-release\.mjs --normalize-cert-sha256 "\$EXPECTED_CERT_SHA256"\)"/);
    expect(workflow).toMatch(/Verify APK signature[\s\S]*apksigner verify --print-certs/);
    expect(workflow).toMatch(/Verify APK signature[\s\S]*Upload the APK as a workflow artifact/);
  });

  it('matches a colon-free expected fingerprint to a colon-separated digest, and the reverse', () => {
    const colonFree = 'c0ffee00aabbccddeeff00112233445566778899aabbccddeeff001122334455';
    const colonSeparated = 'C0:FF:EE:00:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55';
    const spaced = ` ${colonSeparated} \n`;
    const other = 'ff'.repeat(32);
    const viaCli = (value: string) => execFileSync(process.execPath, [helper, '--normalize-cert-sha256', value], {
      cwd: mobileRoot,
      encoding: 'utf8',
    }).trim();

    expect(call('normalizeCertSha256', colonFree)).toBe(call('normalizeCertSha256', colonSeparated));
    expect(call('normalizeCertSha256', colonSeparated)).toBe(call('normalizeCertSha256', colonFree));
    expect(call('normalizeCertSha256', colonFree)).toBe(colonFree);
    expect(call('normalizeCertSha256', colonSeparated)).toBe(colonFree);
    expect(call('normalizeCertSha256', spaced)).toBe(colonFree);
    expect(viaCli(colonFree)).toBe(viaCli(colonSeparated));
    expect(viaCli(colonSeparated)).toBe(viaCli(colonFree));
    expect(viaCli(spaced)).toBe(colonFree);
    expect(call('normalizeCertSha256', colonFree)).not.toBe(call('normalizeCertSha256', other));
  });

  it('fails the verification step if the APK is unsigned or the fingerprint check fails', () => {
    expect(workflow).toContain('APK signature verification failed or APK is unsigned');
    expect(workflow).toContain('Could not extract SHA-256 certificate fingerprint');
    expect(workflow).toMatch(/if \[\[ -z "\$\{EXPECTED_CERT_SHA256\}" \]\]; then/);
    expect(workflow).toMatch(/if \[\[ -z "\$\{actual_sha256\}" \]\]; then/);
    expect(workflow).toMatch(/if \[\[ "\$\{actual_normalized\}" != "\$\{expected_normalized\}" \]\]; then/);
  });

  it('uses one shared concurrency key for push, release, and workflow_dispatch', () => {
    const keys = callModule(`import { releaseConcurrencyGroup } from ${JSON.stringify(helper)};
      console.log(JSON.stringify({
        push: releaseConcurrencyGroup({ eventName: 'push', tag: '' }),
        release: releaseConcurrencyGroup({ eventName: 'release', tag: 'v0.4.4-build-9a15209115dc' }),
        dispatch: releaseConcurrencyGroup({ eventName: 'workflow_dispatch', tag: 'v0.4.4-build-9a15209115dc' }),
      }));`);
    expect(keys.push).toBe(keys.release);
    expect(keys.dispatch).toBe(keys.release);
    expect(keys.push).toBe('mobile-android-release');
    expect(workflow).toMatch(/concurrency:\s*\n(?:\s*#[^\n]*\n)*\s*group: mobile-android-release\s*\n\s*cancel-in-progress: false/);
    expect(workflow).not.toMatch(/group: mobile-android-release-\$/);
    expect(workflow).not.toMatch(/concurrency:[\s\S]*?group:[^\n]*(github\.sha|github\.run_id|inputs\.tag|tag_name)/);
  });

  it('matches the desktop vX.Y.Z-build-<12-hex sha> tag for the pushed commit', () => {
    const sha = '9a15209115dcf73df922980ae50f762c4fa8d986';
    const tag = 'v0.4.4-build-9a15209115dc';
    expect(call('commitBuildId', sha)).toBe('9a15209115dc');
    expect(call('isBuildReleaseTag', tag)).toBe(true);
    expect(call('isBuildReleaseTagForCommit', tag, sha)).toBe(true);
    expect(call('isBuildReleaseTagForCommit', 'v0.4.4', sha)).toBe(false);
    expect(call('isBuildReleaseTagForCommit', 'v0.4.4-build-9a15209115', sha)).toBe(false);
    expect(call('isBuildReleaseTagForCommit', tag, 'aaaaaaaaaaaa0000000000000000000000000000')).toBe(false);
    expect(call('pickReleaseTagForCommit', [
      { tag_name: 'v0.4.3-build-aaaaaaaaaaaa' },
      { tag_name: 'v0.4.4' },
      { tag_name: tag },
    ], sha)).toBe(tag);
    const preferred = callModule(`import { resolveReleaseTag } from ${JSON.stringify(helper)};
      const found = await resolveReleaseTag({
        eventName: 'push',
        commitSha: ${JSON.stringify(sha)},
        sourceVersion: '0.4.4',
        listReleases: async () => [
          { tag_name: 'v0.4.4-build-991a4851ae42' },
          { tag_name: ${JSON.stringify(tag)} },
        ],
        createRelease: async () => { throw new Error('must not create when the commit tag exists'); },
      });
      console.log(JSON.stringify(found));`);
    expect(preferred).toEqual({ tag, shouldAttach: true });
    expect(workflow).toContain('--resolve-tag');
    expect(workflow).toContain('needs.resolve-tag.outputs.should_attach');
  });

  it('on push attaches to the latest build tag when this commit has none, and creates one if none exist', () => {
    const sha = '14e1361bed24b65ac135e87de8edd99f1cb840d4';
    const latest = 'v0.4.4-build-991a4851ae42';
    const created = 'v0.4.4-build-14e1361bed24';
    const dispatchTag = 'v0.4.4-build-9a15209115dc';
    const result = callModule(`import {
      resolveReleaseTag, buildReleaseTag, pickLatestBuildReleaseTag, desktopSourceVersionFromRepo,
      createGithubRelease, releaseAlreadyExists, staleVersionCodeAssetNames, versionCodeFileName,
      LAST_SHIPPED_VERSION_CODE, missingPushReleaseVersionError,
    } from ${JSON.stringify(helper)};
      const createdCalls = [];
      const latestPath = await resolveReleaseTag({
        eventName: 'push',
        commitSha: ${JSON.stringify(sha)},
        sourceVersion: '0.4.4',
        listReleases: async () => [
          { tag_name: 'v0.4.4' },
          { tag_name: ${JSON.stringify(latest)} },
          { tag_name: 'v0.4.3-build-aaaaaaaaaaaa' },
        ],
        createRelease: async (args) => { createdCalls.push(args); },
      });
      const createdPath = await resolveReleaseTag({
        eventName: 'push',
        commitSha: ${JSON.stringify(sha)},
        sourceVersion: '0.4.4',
        listReleases: async () => [],
        createRelease: async (args) => { createdCalls.push(args); },
      });
      const retried = [];
      const waits = [];
      const afterRetry = await resolveReleaseTag({
        eventName: 'push',
        commitSha: ${JSON.stringify(sha)},
        sourceVersion: '0.4.4',
        wait: { intervalMs: 15, maxAttempts: 3 },
        listReleases: async () => {
          retried.push(retried.length + 1);
          if (retried.length < 2) throw new Error('rate limited');
          return [{ tag_name: ${JSON.stringify(latest)} }];
        },
        sleep: async (ms) => { waits.push(ms); },
        createRelease: async (args) => { createdCalls.push(args); },
      });
      let missingVersion = null;
      try {
        await resolveReleaseTag({
          eventName: 'push',
          commitSha: ${JSON.stringify(sha)},
          sourceVersion: '',
          listReleases: async () => [],
          sleep: async () => {},
        });
      } catch (error) {
        missingVersion = String(error.message);
      }
      const ghCalls = [];
      createGithubRelease({
        tag: ${JSON.stringify(created)},
        commitSha: ${JSON.stringify(sha)},
        repository: 'KeepOak/Branch-Agent',
        run: (file, args) => { ghCalls.push([file, args]); return ''; },
      });
      createGithubRelease({
        tag: ${JSON.stringify(created)},
        commitSha: ${JSON.stringify(sha)},
        repository: 'KeepOak/Branch-Agent',
        run: () => { const err = new Error('HTTP 422: already exists'); err.stderr = 'already exists'; throw err; },
      });
      const apkName = 'branch-android-0.4.4-build-991a4851ae42.apk';
      const keep = versionCodeFileName(apkName, 8);
      const release = await resolveReleaseTag({ eventName: 'release', releaseTag: ${JSON.stringify(dispatchTag)} });
      const dispatch = await resolveReleaseTag({ eventName: 'workflow_dispatch', releaseTag: ${JSON.stringify(dispatchTag)} });
      const artifactOnly = await resolveReleaseTag({ eventName: 'workflow_dispatch', releaseTag: '' });
      console.log(JSON.stringify({
        latestPath, createdPath, afterRetry, createdCalls, retried, waits, missingVersion,
        expectedMissing: missingPushReleaseVersionError(${JSON.stringify(sha)}),
        constructed: buildReleaseTag('0.4.4', ${JSON.stringify(sha)}),
        latestPick: pickLatestBuildReleaseTag([{ tag_name: ${JSON.stringify(latest)} }]),
        desktopVersion: desktopSourceVersionFromRepo(),
        ghCalls, already: releaseAlreadyExists({ stderr: 'already exists' }),
        stale: staleVersionCodeAssetNames([
          apkName, keep, versionCodeFileName(apkName, 5), 'SHA256SUMS',
        ], apkName, keep),
        release, dispatch, artifactOnly,
        lastShipped: LAST_SHIPPED_VERSION_CODE,
      }));`);
    expect(result.latestPath).toEqual({ tag: latest, shouldAttach: true });
    expect(result.createdPath).toEqual({ tag: created, shouldAttach: true });
    expect(result.afterRetry).toEqual({ tag: latest, shouldAttach: true });
    expect(result.createdCalls).toEqual([{ tag: created, commitSha: sha }]);
    expect(result.retried).toEqual([1, 2]);
    expect(result.waits).toEqual([15]);
    expect(result.constructed).toBe(created);
    expect(result.latestPick).toBe(latest);
    expect(result.desktopVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.missingVersion).toBe(result.expectedMissing);
    expect(result.ghCalls[0][0]).toBe('gh');
    expect(result.ghCalls[0][1]).toEqual(expect.arrayContaining([
      'release', 'create', created, '--latest=false', '--target', sha,
    ]));
    expect(result.already).toBe(true);
    expect(result.stale).toEqual(['branch-android-0.4.4-build-991a4851ae42.apk.versioncode.5']);
    expect(result.release).toEqual({ tag: dispatchTag, shouldAttach: true });
    expect(result.dispatch).toEqual({ tag: dispatchTag, shouldAttach: true });
    expect(result.artifactOnly).toEqual({ tag: '', shouldAttach: false });
    expect(result.lastShipped).toBe(5);
    expect(workflow).toMatch(/resolve-tag:[\s\S]*timeout-minutes: 12/);
    expect(workflow).toMatch(/resolve-tag:\n(?:.*\n)*?\s+permissions:\n\s+contents: write/);
    expect(workflow).toContain('--stale-versioncode-assets');
    expect(workflow).toContain('gh release delete-asset');
    expect(workflow).toContain('--clobber');
    expect(workflow).not.toMatch(/resolve-tag:[\s\S]*?contents: read/);
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
