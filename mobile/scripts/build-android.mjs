// Builds an installable Android APK of the phone app on this computer, without EAS or an Expo account:
// `expo prebuild` generates the native android/ project from app.json (Expo's Continuous Native
// Generation; android/ is git-ignored), then Gradle's assembleRelease builds and signs the APK.
//
//   npm run build:android              prebuild, then assembleRelease
//   npm run build:android -- --clean   regenerate android/ from scratch first
//
// Needs JDK 17 and the Android SDK (ANDROID_HOME, or sdk.dir in android/local.properties). See README.md.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertNotDebugSigner,
  gradleAssembleArgs,
  gradleSigningEnv,
  requireReleaseSigning,
  writeAppJsonReleaseMeta,
} from './android-release.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const SECRET_ARG = /signing\.(store|key)\.(password|alias)=/i;

export function printableArgs(args) {
  return args.map((arg) => (SECRET_ARG.test(arg) ? String(arg).replace(/=.*/, '=***') : arg));
}

function buildToolsApksigner(env = process.env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const dir = path.join(sdk, 'build-tools');
  if (!existsSync(dir)) return null;
  const name = windows ? 'apksigner.bat' : 'apksigner';
  for (const ver of readdirSync(dir).sort().reverse()) {
    const candidate = path.join(dir, ver, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function apkCertsCommands(apkPath, env = process.env) {
  const verifyArgs = ['verify', '--print-certs', apkPath];
  const commands = [];
  const fromSdk = buildToolsApksigner(env);
  if (fromSdk) commands.push({ command: fromSdk, args: verifyArgs });
  commands.push({ command: windows ? 'apksigner.bat' : 'apksigner', args: verifyArgs });
  commands.push({ command: 'keytool', args: ['-printcert', '-jarfile', apkPath] });
  return commands;
}

function spawnText(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: windows,
  });
  return {
    status: result.status,
    error: result.error,
    text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

export function readApkSignerCerts(apkPath, env = process.env) {
  const attempts = apkCertsCommands(apkPath, env);
  const errors = [];
  for (const attempt of attempts) {
    const { status, error, text } = spawnText(attempt.command, attempt.args);
    if (status === 0 && text) return text;
    errors.push(`${path.basename(attempt.command)}: ${error?.message ?? text ?? `exit ${status}`}`);
  }
  throw new Error(`Could not read APK signing certificate (${errors.join('; ')})`);
}

export function verifyReleaseApkSigner(apkPath, env = process.env, certText) {
  if (!requireReleaseSigning(env)) return null;
  const certs = certText === undefined ? readApkSignerCerts(apkPath, env) : String(certText);
  assertNotDebugSigner(certs);
  return certs;
}

function run(command, args, cwd, extraEnv) {
  console.log(`\n> ${command} ${printableArgs(args).join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    shell: windows,
    env: { ...process.env, CI: '1', ...extraEnv },
  });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status ?? result.signal})`);
}

function main() {
  const clean = process.argv.includes('--clean');
  // Prebuild rewrites package.json's android and ios scripts to `expo run:*`. This build leaves the
  // checked-in files as they are, so it puts them back afterwards.
  const kept = ['package.json', 'app.json', 'app.config.js']
    .filter((name) => existsSync(path.join(root, name)))
    .map((name) => [name, readFileSync(path.join(root, name))]);
  try {
    writeAppJsonReleaseMeta(path.join(root, 'app.json'));
    run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', ...(clean ? ['--clean'] : [])], root);
  } finally {
    for (const [name, content] of kept) writeFileSync(path.join(root, name), content);
  }

  const android = path.join(root, 'android');
  run(windows ? 'gradlew.bat' : './gradlew', gradleAssembleArgs(), android, gradleSigningEnv());

  const apk = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(apk)) throw new Error(`Gradle finished but ${apk} is missing.`);
  const certs = verifyReleaseApkSigner(apk);
  if (certs) console.log(`\n${certs}`);
  console.log(`\nInstallable APK: ${apk}\nInstall it with: adb install -r "${apk}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}
