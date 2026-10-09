// Builds an installable Android APK of the phone app on this computer, without EAS or an Expo account:
// `expo prebuild` generates the native android/ project from app.json (Expo's Continuous Native
// Generation; android/ is git-ignored), then Gradle's assembleRelease builds and signs the APK.
//
//   npm run build:android              prebuild, then assembleRelease
//   npm run build:android -- --clean   regenerate android/ from scratch first
//
// Needs JDK 17 and the Android SDK (ANDROID_HOME, or sdk.dir in android/local.properties). See README.md.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const clean = process.argv.includes('--clean');

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, shell: windows, env: { ...process.env, CI: '1' } });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (exit ${result.status ?? result.signal})`);
}

function main() {
  // Prebuild rewrites package.json's android and ios scripts to `expo run:*`. This build leaves the
  // checked-in files as they are, so it puts them back afterwards.
  const kept = ['package.json', 'app.json'].map((name) => [name, readFileSync(path.join(root, name))]);
  try {
    run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', ...(clean ? ['--clean'] : [])], root);
  } finally {
    for (const [name, content] of kept) writeFileSync(path.join(root, name), content);
  }

  const android = path.join(root, 'android');
  run(windows ? 'gradlew.bat' : './gradlew', ['assembleRelease'], android);

  const apk = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(apk)) throw new Error(`Gradle finished but ${apk} is missing.`);
  console.log(`\nInstallable APK: ${apk}\nInstall it with: adb install -r "${apk}"`);
}

try {
  main();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
