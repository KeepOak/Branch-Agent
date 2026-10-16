/**
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const mobileRoot = path.join(__dirname, '../..');
const pluginPath = path.join(mobileRoot, 'plugins/withReleaseSigning.js');
const buildScript = path.join(mobileRoot, 'scripts/build-android.mjs');
const releaseHelper = path.join(mobileRoot, 'scripts/android-release.mjs');

const EXPO_APP_BUILD_GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

function callPlugin<T = unknown>(name: string, ...args: unknown[]): T {
  const source = args.length === 0
    ? `const m = require(${JSON.stringify(pluginPath)}); console.log(JSON.stringify(m[${JSON.stringify(name)}]));`
    : `const m = require(${JSON.stringify(pluginPath)}); console.log(JSON.stringify(m[${JSON.stringify(name)}](...${JSON.stringify(args)})));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', source], { encoding: 'utf8' }));
}

function callBuild<T = unknown>(name: string, ...args: unknown[]): T {
  const source = args.length === 0
    ? `import * as m from ${JSON.stringify(buildScript)}; console.log(JSON.stringify(m[${JSON.stringify(name)}]));`
    : `import * as m from ${JSON.stringify(buildScript)}; console.log(JSON.stringify(m[${JSON.stringify(name)}](...${JSON.stringify(args)})));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
}

function callRelease<T = unknown>(name: string, ...args: unknown[]): T {
  const source = args.length === 0
    ? `import * as m from ${JSON.stringify(releaseHelper)}; console.log(JSON.stringify(m[${JSON.stringify(name)}]));`
    : `import * as m from ${JSON.stringify(releaseHelper)}; console.log(JSON.stringify(m[${JSON.stringify(name)}](...${JSON.stringify(args)})));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
}

function callBuildResult(name: string, ...args: unknown[]) {
  const source = `import * as m from ${JSON.stringify(buildScript)};
    try { console.log(JSON.stringify({ ok: true, value: m[${JSON.stringify(name)}](...${JSON.stringify(args)}) })); }
    catch (error) { console.log(JSON.stringify({ ok: false, message: String(error.message) })); }`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8' }));
}

function namedInner(source: string, parent: string, child: string) {
  const parentMatch = new RegExp(String.raw`\b${parent}\s*\{`).exec(source);
  if (!parentMatch) return '';
  let depth = 0;
  let open = -1;
  for (let i = parentMatch.index + parentMatch[0].length - 1; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
      if (depth === 1) open = i;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        const inner = source.slice(open + 1, i);
        const childMatch = new RegExp(String.raw`\b${child}\s*\{`).exec(inner);
        if (!childMatch) return '';
        let childDepth = 0;
        let childOpen = -1;
        for (let j = childMatch.index + childMatch[0].length - 1; j < inner.length; j += 1) {
          if (inner[j] === '{') {
            childDepth += 1;
            if (childDepth === 1) childOpen = j;
          } else if (inner[j] === '}') {
            childDepth -= 1;
            if (childDepth === 0) return inner.slice(childOpen + 1, j);
          }
        }
      }
    }
  }
  return '';
}

describe('the release signing config plugin', () => {
  it('adds a release signingConfig from env and stops release using the debug keystore', () => {
    const out = callPlugin<string>('applyReleaseSigningGradle', EXPO_APP_BUILD_GRADLE);
    const signingRelease = namedInner(out, 'signingConfigs', 'release');
    const releaseType = namedInner(out, 'buildTypes', 'release');
    const debugType = namedInner(out, 'buildTypes', 'debug');

    expect(signingRelease).toMatch(/ANDROID_KEYSTORE_PATH/);
    expect(signingRelease).toMatch(/ANDROID_KEYSTORE_PASSWORD/);
    expect(signingRelease).toMatch(/ANDROID_KEY_ALIAS/);
    expect(signingRelease).toMatch(/ANDROID_KEY_PASSWORD/);
    expect(signingRelease).toMatch(/storeType "PKCS12"/);
    expect(signingRelease).toMatch(/REQUIRE_ANDROID_RELEASE_SIGNING/);
    expect(signingRelease).toMatch(/GradleException/);
    expect(signingRelease).not.toMatch(/signingConfig signingConfigs\.debug/);

    expect(releaseType).toMatch(/signingConfig signingConfigs\.release/);
    expect(releaseType).not.toMatch(/signingConfig signingConfigs\.debug/);
    expect(debugType).toMatch(/signingConfig signingConfigs\.debug/);
    expect(debugType).not.toMatch(/signingConfig signingConfigs\.release/);
  });

  it('is idempotent and keeps the Expo debug signingConfig for the debug build type', () => {
    const once = callPlugin<string>('applyReleaseSigningGradle', EXPO_APP_BUILD_GRADLE);
    const twice = callPlugin<string>('applyReleaseSigningGradle', once);
    expect(twice).toBe(once);
    expect(namedInner(once, 'signingConfigs', 'debug')).toMatch(/keyAlias 'androiddebugkey'/);
  });
});

describe('build-android.mjs signing args and log redaction', () => {
  it('passes complete PKCS12 signing through gradle args and env', () => {
    const env = {
      ANDROID_KEYSTORE_PATH: '/tmp/android-release.p12',
      ANDROID_KEYSTORE_PASSWORD: 'store-secret',
      ANDROID_KEY_PASSWORD: 'key-secret',
      ANDROID_KEY_ALIAS: 'branch',
      ANDROID_VERSION_CODE: '4',
      ANDROID_VERSION_NAME: '0.4.4',
    };
    const args = callRelease<string[]>('gradleAssembleArgs', env);
    const signingEnv = callRelease<Record<string, string>>('gradleSigningEnv', env);
    expect(args).toContain('assembleRelease');
    expect(args).toContain('-Pandroid.injected.signing.store.file=/tmp/android-release.p12');
    expect(args).toContain('-Pandroid.injected.signing.store.type=PKCS12');
    expect(signingEnv[callRelease<string>('GRADLE_SIGNING_STORE_PASSWORD_ENV')]).toBe('store-secret');
    expect(signingEnv[callRelease<string>('GRADLE_SIGNING_KEY_PASSWORD_ENV')]).toBe('key-secret');
    expect(signingEnv[callRelease<string>('GRADLE_SIGNING_KEY_ALIAS_ENV')]).toBe('branch');
    expect(args.join('\0')).not.toContain('store-secret');
    expect(args.join('\0')).not.toContain('key-secret');
    expect(args.some((arg) => /signing\.(store|key)\.password=/.test(arg))).toBe(false);
    expect(args.some((arg) => /signing\.key\.alias=/.test(arg))).toBe(false);
  });

  it('redacts signing passwords and the key alias in the logged command', () => {
    expect(callBuild('printableArgs', [
      'assembleRelease',
      '-Pandroid.injected.signing.store.file=/tmp/android-release.p12',
      '-Pandroid.injected.signing.store.type=PKCS12',
      '-Pandroid.injected.signing.store.password=store-secret',
      '-Pandroid.injected.signing.key.password=key-secret',
      '-Pandroid.injected.signing.key.alias=branch',
    ])).toEqual([
      'assembleRelease',
      '-Pandroid.injected.signing.store.file=/tmp/android-release.p12',
      '-Pandroid.injected.signing.store.type=PKCS12',
      '-Pandroid.injected.signing.store.password=***',
      '-Pandroid.injected.signing.key.password=***',
      '-Pandroid.injected.signing.key.alias=***',
    ]);
  });

  it('rejects a debug-signed APK when release signing is required, and skips the check otherwise', () => {
    expect(callBuild('verifyReleaseApkSigner', 'app-release.apk', {})).toBeNull();
    const required = { REQUIRE_ANDROID_RELEASE_SIGNING: '1' };
    const debug = callBuildResult(
      'verifyReleaseApkSigner',
      'app-release.apk',
      required,
      'Signer: CN=Android Debug, OU=Android, O=Android',
    );
    expect(debug.ok).toBe(false);
    expect(debug.message).toMatch(/Android Debug/);
    expect(callBuild(
      'verifyReleaseApkSigner',
      'app-release.apk',
      required,
      'Signer: CN=BranchReleaseProof',
    )).toBe('Signer: CN=BranchReleaseProof');
  });
});
