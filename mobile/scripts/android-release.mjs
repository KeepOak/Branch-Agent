// Release-plan helper for the sideloadable Android APK.
// Used by scripts/build-android.mjs and .github/workflows/mobile-android-release.yml.
// Secrets stay in the environment; this file never writes a keystore or password.
import { execFileSync } from 'node:child_process';
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

/** GitHub vars, apksigner, and keytool all print SHA-256 fingerprints; formats differ by colon and case. */
export function normalizeCertSha256(value) {
  return String(value ?? '').toLowerCase().replace(/[:\s]/g, '');
}

// Desktop publishes vX.Y.Z-build-<first 12 hex of the commit>, e.g. v0.4.4-build-9a15209115dc.
export const BUILD_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+-build-[a-f0-9]{12}$/i;
export const ANDROID_RELEASE_CONCURRENCY_GROUP = 'mobile-android-release';
// Retry listing releases on API errors. Do not wait minutes for a desktop tag:
// mobile-only commits never get one, and a long poll skipped the APK build.
export const PUSH_RELEASE_WAIT = {
  intervalMs: 10_000,
  maxAttempts: 3,
};
// workflow_dispatch run 38919220548 shipped versionCode 5. Later builds must be newer.
export const LAST_SHIPPED_VERSION_CODE = 5;

export function commitBuildId(sha) {
  return String(sha ?? '').trim().toLowerCase().slice(0, 12);
}

export function isBuildReleaseTag(tag) {
  return BUILD_RELEASE_TAG_RE.test(String(tag ?? '').trim());
}

export function isBuildReleaseTagForCommit(tag, sha) {
  const t = String(tag ?? '').trim();
  const id = commitBuildId(sha);
  if (!isBuildReleaseTag(t) || !/^[a-f0-9]{12}$/.test(id)) return false;
  return t.toLowerCase().endsWith(`-build-${id}`);
}

export function pickReleaseTagForCommit(releases, sha) {
  for (const item of releases ?? []) {
    const tag = typeof item === 'string' ? item : item?.tag_name;
    if (isBuildReleaseTagForCommit(tag, sha)) return tag;
  }
  return '';
}

export function releaseTagFromItem(item) {
  return typeof item === 'string' ? item : item?.tag_name;
}

// GitHub returns newest first. Same source as a workflow_dispatch that attaches
// to the current desktop tag (run 38919220548 used v0.4.4-build-9a15209115dc).
export function pickLatestBuildReleaseTag(releases) {
  for (const item of releases ?? []) {
    const tag = releaseTagFromItem(item);
    if (isBuildReleaseTag(tag)) return tag;
  }
  return '';
}

export function sourceReleaseVersion(pkg) {
  return String(pkg?.version ?? '').trim();
}

export function buildReleaseTag(version, sha) {
  const v = sourceReleaseVersion({ version }).replace(/^v/i, '');
  const id = commitBuildId(sha);
  if (!/^\d+\.\d+\.\d+$/.test(v) || !/^[a-f0-9]{12}$/.test(id)) return '';
  return `v${v}-build-${id}`;
}

export function desktopSourceVersionFromRepo(
  pkgPath = path.join(root, '../desktop/package.json'),
  read = (file) => readFileSync(file, 'utf8'),
) {
  return sourceReleaseVersion(JSON.parse(read(pkgPath)));
}

export function staleVersionCodeAssetNames(assetNames, apkName, keepName) {
  const prefix = `${String(apkName ?? '')}.versioncode.`;
  const keep = String(keepName ?? '');
  if (!prefix.startsWith('branch-android-') || prefix === '.versioncode.') return [];
  return (assetNames ?? []).filter((name) => {
    const n = String(name ?? '');
    return n.startsWith(prefix) && n !== keep;
  });
}

// Same group for push, release, and workflow_dispatch. Tag and event are ignored
// on purpose so two triggers that attach the same assets share one lock.
export function releaseConcurrencyGroup(_context = {}) {
  return ANDROID_RELEASE_CONCURRENCY_GROUP;
}

export function pushReleaseWaitMs(wait = PUSH_RELEASE_WAIT) {
  return Number(wait.intervalMs) * Number(wait.maxAttempts);
}

export function missingPushReleaseError(sha, wait = PUSH_RELEASE_WAIT) {
  const id = commitBuildId(sha);
  const seconds = Math.round(pushReleaseWaitMs(wait) / 1000);
  return `No GitHub release with tag vX.Y.Z-build-${id} for commit ${String(sha ?? '').trim()} after ${seconds}s`;
}

export function missingPushReleaseVersionError(sha) {
  const id = commitBuildId(sha);
  return `Cannot construct vX.Y.Z-build-${id} without a dotted source version`;
}

export function listGithubReleases({
  repository = process.env.GITHUB_REPOSITORY,
  run = (file, args) => execFileSync(file, args, { encoding: 'utf8' }),
} = {}) {
  if (!String(repository ?? '').trim()) {
    throw new Error('GITHUB_REPOSITORY is required to list releases');
  }
  const raw = run('gh', ['api', `repos/${repository}/releases?per_page=100`]);
  const releases = JSON.parse(raw);
  if (!Array.isArray(releases)) {
    throw new Error('GitHub releases response was not a list');
  }
  return releases;
}

export function releaseAlreadyExists(error) {
  const text = [
    error?.stderr,
    error?.message,
    error?.stdout,
    error,
  ].map((part) => String(part ?? '')).join('\n');
  return /already exists/i.test(text) || /HTTP 422/.test(text);
}

export function createGithubRelease({
  tag,
  commitSha,
  repository = process.env.GITHUB_REPOSITORY,
  title,
  notes = 'Signed Android APK.',
  run = (file, args) => execFileSync(file, args, { encoding: 'utf8' }),
} = {}) {
  const repo = String(repository ?? '').trim();
  const t = String(tag ?? '').trim();
  const sha = String(commitSha ?? '').trim();
  if (!repo) throw new Error('GITHUB_REPOSITORY is required to create a release');
  if (!isBuildReleaseTag(t)) throw new Error(`Refusing to create a non-build release tag: ${t}`);
  if (!/^[a-f0-9]{7,40}$/i.test(sha)) throw new Error('createGithubRelease needs the source commit');
  const version = t.replace(/^v/i, '');
  try {
    run('gh', [
      'release', 'create', t,
      '--repo', repo,
      '--target', sha,
      '--latest=false',
      '--title', title || `Branch Agent ${version}`,
      '--notes', notes,
    ]);
  } catch (error) {
    if (releaseAlreadyExists(error)) return t;
    throw error;
  }
  return t;
}

export async function resolveReleaseTag({
  eventName,
  releaseTag = '',
  commitSha = '',
  sourceVersion = '',
  listReleases,
  createRelease,
  sleep,
  wait = PUSH_RELEASE_WAIT,
} = {}) {
  const immediate = String(releaseTag ?? '').trim();
  if (eventName === 'release' || (eventName === 'workflow_dispatch' && immediate)) {
    return { tag: immediate, shouldAttach: true };
  }
  if (eventName !== 'push') {
    return { tag: '', shouldAttach: false };
  }
  if (typeof listReleases !== 'function') {
    throw new Error('listReleases is required to resolve a push-path release tag');
  }
  const nap = typeof sleep === 'function' ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let releases = [];
  let listed = false;
  for (let attempt = 1; attempt <= wait.maxAttempts; attempt += 1) {
    try {
      releases = await listReleases();
      listed = true;
      const tag = pickReleaseTagForCommit(releases, commitSha);
      if (tag) return { tag, shouldAttach: true };
      break;
    } catch {
      // Retry listing: a flaky or rate-limited GitHub API should not skip the APK.
    }
    if (attempt < wait.maxAttempts) await nap(wait.intervalMs);
  }
  if (listed) {
    const latest = pickLatestBuildReleaseTag(releases);
    if (latest) return { tag: latest, shouldAttach: true };
  }
  const constructed = buildReleaseTag(sourceVersion, commitSha);
  if (!constructed) {
    throw new Error(listed ? missingPushReleaseVersionError(commitSha) : missingPushReleaseError(commitSha, wait));
  }
  if (typeof createRelease === 'function') {
    try {
      await createRelease({ tag: constructed, commitSha });
    } catch (error) {
      if (!releaseAlreadyExists(error)) throw error;
    }
  }
  return { tag: constructed, shouldAttach: true };
}

async function resolveTagMain() {
  const result = await resolveReleaseTag({
    eventName: process.env.EVENT_NAME,
    releaseTag: process.env.RELEASE_TAG_INPUT,
    commitSha: process.env.COMMIT_SHA,
    sourceVersion: desktopSourceVersionFromRepo(),
    listReleases: () => listGithubReleases(),
    createRelease: (args) => createGithubRelease(args),
  });
  process.stdout.write(`tag=${result.tag}\nshould_attach=${result.shouldAttach ? 'true' : 'false'}\n`);
}

export function releaseVersion({ tag, runNumber, fallbackVersion } = {}) {
  const raw = String(tag ?? '').trim();
  if (raw) return raw.replace(/^v/i, '');
  if (fallbackVersion) return String(fallbackVersion);
  return String(runNumber ?? '');
}

// Same workflow, so github.run_number is strictly increasing across releases.
// A lower number than the last shipped APK would not replace it on a device.
export function versionCode({ runNumber } = {}) {
  const n = Number(runNumber);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error('versionCode needs a positive workflow run number');
  }
  return Math.max(n, LAST_SHIPPED_VERSION_CODE + 1);
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
    '-Pandroid.injected.signing.v1-enabled=true',
    '-Pandroid.injected.signing.v2-enabled=true',
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
  if (process.argv.includes('--resolve-tag')) {
    return resolveTagMain();
  }

  const staleIndex = process.argv.indexOf('--stale-versioncode-assets');
  if (staleIndex !== -1) {
    const apkName = process.argv[staleIndex + 1] ?? '';
    const keepName = process.argv[staleIndex + 2] ?? '';
    const names = readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const name of staleVersionCodeAssetNames(names, apkName, keepName)) {
      process.stdout.write(`${name}\n`);
    }
    return;
  }

  const normalizeIndex = process.argv.indexOf('--normalize-cert-sha256');
  if (normalizeIndex !== -1) {
    process.stdout.write(`${normalizeCertSha256(process.argv[normalizeIndex + 1] ?? '')}\n`);
    return;
  }

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
  Promise.resolve()
    .then(() => main())
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
