// Release-plan helper for the sideloadable Android APK.
// Used by scripts/build-android.mjs and .github/workflows/mobile-android-release.yml.
// Secrets stay in the environment; this file never writes a keystore or password.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SIGNING_SECRET_NAMES = [
  'ANDROID_KEYSTORE_B64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_PASSWORD',
  'ANDROID_KEY_ALIAS',
];

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function missingSigningSecrets(env = process.env) {
  return SIGNING_SECRET_NAMES.filter((name) => !String(env[name] ?? '').trim());
}

export function signingReady(env = process.env) {
  return missingSigningSecrets(env).length === 0;
}

// After decode, Gradle needs the keystore path plus the three remaining secrets.
// ANDROID_KEYSTORE_B64 is not an assemble input; requiring it here dropped release
// signing on the CI build step that never received that secret.
export const GRADLE_SIGNING_INPUT_NAMES = [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_PASSWORD',
  'ANDROID_KEY_ALIAS',
];

export function missingGradleSigningInputs(env = process.env) {
  return GRADLE_SIGNING_INPUT_NAMES.filter((name) => !String(env[name] ?? '').trim());
}

export function gradleSigningReady(env = process.env) {
  return missingGradleSigningInputs(env).length === 0;
}

export function requireReleaseSigning(env = process.env) {
  return String(env.REQUIRE_ANDROID_RELEASE_SIGNING ?? '').trim() === '1'
    || String(env.GITHUB_ACTIONS ?? '') === 'true';
}

export const ANDROID_DEBUG_SIGNER = 'CN=Android Debug';

export function isDebugSigner(certText) {
  return String(certText ?? '').includes(ANDROID_DEBUG_SIGNER);
}

export function assertNotDebugSigner(certText) {
  if (isDebugSigner(certText)) {
    throw new Error('Release APK is signed with the Android Debug certificate');
  }
  return true;
}

export function releaseVersion({ tag, runNumber, fallbackVersion } = {}) {
  const raw = String(tag ?? '').trim();
  if (raw) return raw.replace(/^v/i, '');
  if (fallbackVersion) return String(fallbackVersion);
  return String(runNumber ?? '');
}

// Same workflow, so github.run_number is strictly increasing across releases.
export function versionCode({ runNumber } = {}) {
  const n = Number(runNumber);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('versionCode needs a positive workflow run number');
  }
  return n;
}

export function apkFileName(version, { signed } = { signed: true }) {
  const safe = String(version || 'unsigned').replace(/[^A-Za-z0-9._-]+/g, '-');
  return signed ? `branch-android-${safe}.apk` : `branch-android-${safe}-unsigned.apk`;
}

export function sha256FileName(apkName) {
  return `${apkName}.sha256`;
}

// Sibling of the APK: the workflow run number baked in as Android versionCode.
export function versionCodeFileName(apkName, code) {
  return `${apkName}.versioncode.${code}`;
}

export function hexSha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256SidecarText(hex, apkName) {
  return `${String(hex).toLowerCase()}  ${apkName}\n`;
}

export function writeSha256Sidecar(apkPath, apkName = path.basename(apkPath)) {
  const hex = hexSha256(readFileSync(apkPath));
  const sidecarPath = `${apkPath}.sha256`;
  writeFileSync(sidecarPath, sha256SidecarText(hex, apkName));
  return { path: sidecarPath, name: sha256FileName(apkName), hex };
}

export function writeVersionCodeSidecar(apkPath, code, apkName = path.basename(apkPath)) {
  const n = Number(code);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('versionCode sidecar needs a positive workflow run number');
  }
  const name = versionCodeFileName(apkName, n);
  const sidecarPath = path.join(path.dirname(apkPath), name);
  writeFileSync(sidecarPath, `${n}\n`);
  return { path: sidecarPath, name, versionCode: n };
}

function versionCodeFromEnv(env = process.env) {
  const n = Number(env.ANDROID_VERSION_CODE);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function shouldAttachToRelease({ signed, releaseTag } = {}) {
  return Boolean(signed && String(releaseTag ?? '').trim());
}

// Passwords and the key alias never go on argv. Gradle maps ORG_GRADLE_PROJECT_<name>
// to the same project properties Android Studio would set with -P.
export const GRADLE_SIGNING_STORE_PASSWORD_ENV = 'ORG_GRADLE_PROJECT_android.injected.signing.store.password';
export const GRADLE_SIGNING_KEY_PASSWORD_ENV = 'ORG_GRADLE_PROJECT_android.injected.signing.key.password';
export const GRADLE_SIGNING_KEY_ALIAS_ENV = 'ORG_GRADLE_PROJECT_android.injected.signing.key.alias';

export function gradleSigningEnv(env = process.env) {
  if (!gradleSigningReady(env)) {
    if (requireReleaseSigning(env)) throw new Error(missingSigningError(missingGradleSigningInputs(env)));
    return {};
  }
  return {
    [GRADLE_SIGNING_STORE_PASSWORD_ENV]: env.ANDROID_KEYSTORE_PASSWORD,
    [GRADLE_SIGNING_KEY_PASSWORD_ENV]: env.ANDROID_KEY_PASSWORD,
    [GRADLE_SIGNING_KEY_ALIAS_ENV]: env.ANDROID_KEY_ALIAS,
  };
}

export function gradleSigningArgs({ keystorePath } = {}) {
  if (!keystorePath) return [];
  return [
    `-Pandroid.injected.signing.store.file=${keystorePath}`,
    '-Pandroid.injected.signing.store.type=PKCS12',
  ];
}

export function gradleVersionArgs({ versionCode: code, versionName } = {}) {
  const args = [];
  if (code) args.push(`-Pandroid.injected.version.code=${code}`);
  if (versionName) args.push(`-Pandroid.injected.version.name=${versionName}`);
  return args;
}

export function gradleAssembleArgs(env = process.env) {
  const args = ['assembleRelease', ...gradleVersionArgs({
    versionCode: env.ANDROID_VERSION_CODE,
    versionName: env.ANDROID_VERSION_NAME,
  })];
  if (gradleSigningReady(env)) {
    args.push(...gradleSigningArgs({ keystorePath: env.ANDROID_KEYSTORE_PATH }));
    return args;
  }
  if (requireReleaseSigning(env)) {
    throw new Error(missingSigningError(missingGradleSigningInputs(env)));
  }
  return args;
}

export function applyAppJsonReleaseMeta(app, { versionName, versionCode: code } = {}) {
  const expo = { ...(app?.expo ?? {}) };
  const android = { ...(expo.android ?? {}) };
  if (versionName) expo.version = String(versionName);
  if (code) android.versionCode = Number(code);
  expo.android = android;
  return { ...app, expo };
}

export function writeAppJsonReleaseMeta(appJsonPath, env = process.env) {
  const versionName = String(env.ANDROID_VERSION_NAME ?? '').trim();
  const code = String(env.ANDROID_VERSION_CODE ?? '').trim();
  if (!versionName && !code) return false;
  const app = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  writeFileSync(appJsonPath, `${JSON.stringify(applyAppJsonReleaseMeta(app, {
    versionName: versionName || undefined,
    versionCode: code || undefined,
  }), null, 2)}\n`);
  return true;
}

export function missingSigningError(missing) {
  const names = (missing?.length ? missing : SIGNING_SECRET_NAMES).join(', ');
  return `Release signing is not configured (${names}). The job must fail and never fall back to debug signing.`;
}

export function releasePlan({
  tag,
  runNumber,
  fallbackVersion,
  env = process.env,
} = {}) {
  const missing = missingSigningSecrets(env);
  const signed = missing.length === 0;
  const releaseTag = String(tag ?? '').trim();
  const version = releaseVersion({ tag: releaseTag, runNumber, fallbackVersion });
  const code = versionCode({ tag: releaseTag, runNumber });
  const apkName = apkFileName(version, { signed });
  return {
    signed,
    missing,
    version,
    versionCode: code,
    apkName,
    sha256Name: signed ? sha256FileName(apkName) : '',
    versioncodeName: signed ? versionCodeFileName(apkName, code) : '',
    artifactName: apkName.replace(/\.apk$/i, ''),
    attachRelease: shouldAttachToRelease({ signed, releaseTag }),
    releaseTag,
  };
}

function fallbackVersionFromAppJson() {
  return JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version;
}

function printGithubOutput(plan) {
  const rows = {
    signed: plan.signed ? 'true' : 'false',
    version: plan.version,
    version_code: String(plan.versionCode),
    apk_name: plan.apkName,
    sha256_name: plan.sha256Name,
    versioncode_name: plan.versioncodeName,
    artifact_name: plan.artifactName,
    attach_release: plan.attachRelease ? 'true' : 'false',
    release_tag: plan.releaseTag,
    missing: plan.missing.join(','),
  };
  for (const [key, value] of Object.entries(rows)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

function printSha256Output(sidecar) {
  const rows = {
    sha256_path: sidecar.path,
    sha256_name: sidecar.name,
    sha256_hex: sidecar.hex,
  };
  if (sidecar.versioncode_path) {
    rows.versioncode_path = sidecar.versioncode_path;
    rows.versioncode_name = sidecar.versioncode_name;
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(sidecar)}\n`);
    return;
  }
  for (const [key, value] of Object.entries(rows)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

function main() {
  const shaIndex = process.argv.indexOf('--sha256');
  if (shaIndex !== -1) {
    const apkPath = process.argv[shaIndex + 1];
    if (!apkPath) throw new Error('pass the staged APK path after --sha256');
    const sha = writeSha256Sidecar(apkPath);
    const code = versionCodeFromEnv();
    if (code == null) {
      printSha256Output(sha);
      return;
    }
    const versioncode = writeVersionCodeSidecar(apkPath, code);
    printSha256Output({
      ...sha,
      versioncode_path: versioncode.path,
      versioncode_name: versioncode.name,
    });
    return;
  }

  const env = process.env;
  const plan = releasePlan({
    tag: env.RELEASE_TAG,
    runNumber: env.GITHUB_RUN_NUMBER,
    fallbackVersion: fallbackVersionFromAppJson(),
    env,
  });
  if (!plan.signed) {
    throw new Error(missingSigningError(plan.missing));
  }
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  printGithubOutput(plan);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
