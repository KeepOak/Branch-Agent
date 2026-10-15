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

export function shouldAttachToRelease({ signed, releaseTag } = {}) {
  return Boolean(signed && String(releaseTag ?? '').trim());
}

export function gradleSigningArgs({ keystorePath, storePassword, keyAlias, keyPassword } = {}) {
  if (!keystorePath || !storePassword || !keyAlias || !keyPassword) return [];
  return [
    `-Pandroid.injected.signing.store.file=${keystorePath}`,
    `-Pandroid.injected.signing.store.password=${storePassword}`,
    `-Pandroid.injected.signing.key.alias=${keyAlias}`,
    `-Pandroid.injected.signing.key.password=${keyPassword}`,
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
  if (signingReady(env) && env.ANDROID_KEYSTORE_PATH) {
    args.push(...gradleSigningArgs({
      keystorePath: env.ANDROID_KEYSTORE_PATH,
      storePassword: env.ANDROID_KEYSTORE_PASSWORD,
      keyAlias: env.ANDROID_KEY_ALIAS,
      keyPassword: env.ANDROID_KEY_PASSWORD,
    }));
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

export function unsignedWarning(missing) {
  const names = missing.length ? missing.join(', ') : SIGNING_SECRET_NAMES.join(', ');
  return `Signing secrets are missing (${names}). Building a debug-signed APK and uploading it as a workflow artifact only. It will not be attached to the GitHub release.`;
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
    printSha256Output(writeSha256Sidecar(apkPath));
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
    const message = unsignedWarning(plan.missing);
    process.stderr.write(`::warning::${message}\n`);
    if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, `## Unsigned Android APK\n\n${message}\n`, { flag: 'a' });
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
