#!/usr/bin/env node
// Real `adb install -r` proof for the phone's Android package. CI builds vN and vN+1 with the same
// throwaway test key, writes pairing/chat/settings into the installed app's data, reinstalls, and
// asserts that state survived. No in-process fake adb.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'com.keepoak.branch';
export const WORKFLOW_PATH = '.github/workflows/mobile-apk-reinstall.yml';
export const EMULATOR_RUNNER_SHA = 'a421e43855164a8197daf9d8d40fe71c6996bb0d';
export const PAIRING_RECORD = '{"version":1,"url":"ws://127.0.0.1:9","pairedAtMs":1}';
export const CHAT_RECORD = '{"thread":"oak","last":"still here after the update"}';
export const SETTINGS_RECORD =
  `<?xml version="1.0" encoding="utf-8"?>\n<map><string name="appearance">system</string></map>\n`;

const windows = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PINNED_SHA = /^[0-9a-f]{40}$/;

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: windows,
    ...opts,
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal}): ${detail}`);
  }
  return result;
}

export function workflowContract(yaml) {
  const text = String(yaml ?? '');
  const problems = [];
  if (!/name:\s*Mobile APK reinstall/.test(text)) problems.push('workflow name');
  if (!/name:\s*Android APK reinstall/.test(text)) problems.push('job name');
  if (!/timeout-minutes:\s*15/.test(text)) problems.push('timeout-minutes 15');
  if (/timeout-minutes:\s*(1[6-9]|[2-9]\d)/.test(text)) problems.push('timeout over 15');
  if (!/permissions:\s*\n\s+contents:\s*read/.test(text)) problems.push('read-only permissions');
  if (/contents:\s*write/.test(text)) problems.push('contents write');
  if (!/- 'mobile\/\*\*'/.test(text)) problems.push('path-filter mobile/');
  const runner = text.match(/reactivecircus\/android-emulator-runner@([0-9a-f]{40})/);
  if (!runner || runner[1] !== EMULATOR_RUNNER_SHA) problems.push('pinned android-emulator-runner SHA');
  for (const action of text.matchAll(/uses:\s+\S+@([0-9a-f]+)/g)) {
    if (!PINNED_SHA.test(action[1])) problems.push(`unpinned action ${action[1]}`);
  }
  if (!/adb-reinstall/.test(text)) problems.push('live adb reinstall step');
  if (!/throwaway CI test key/.test(text)) problems.push('same throwaway CI test key');
  return problems;
}

export function gradleSettingsText() {
  return `pluginManagement {
  repositories { google(); mavenCentral(); gradlePluginPortal() }
}
plugins { id 'com.android.application' version '8.7.3' apply false }
dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories { google(); mavenCentral() }
}
rootProject.name = 'apk-reinstall'
include ':app'
`;
}

function writeGradleProject(dir, keystorePath) {
  mkdirSync(path.join(dir, 'app', 'src', 'main', 'java', 'com', 'keepoak', 'branch'), { recursive: true });
  writeFileSync(path.join(dir, 'settings.gradle'), gradleSettingsText());
  writeFileSync(path.join(dir, 'gradle.properties'), 'org.gradle.jvmargs=-Xmx1536m\nandroid.useAndroidX=true\n');
  writeFileSync(path.join(dir, 'app', 'build.gradle'), `plugins { id 'com.android.application' }
android {
  namespace 'com.keepoak.branch'
  compileSdk 36
  defaultConfig {
    applicationId 'com.keepoak.branch'
    minSdk 24
    targetSdk 36
    versionCode Integer.parseInt(System.getenv('ANDROID_VERSION_CODE') ?: '1')
    versionName System.getenv('ANDROID_VERSION_NAME') ?: '0.1.0'
  }
  signingConfigs {
    ci {
      storeFile file('${keystorePath.replace(/\\/g, '/')}')
      storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
      keyAlias System.getenv('ANDROID_KEY_ALIAS')
      keyPassword System.getenv('ANDROID_KEY_PASSWORD')
      storeType 'PKCS12'
    }
  }
  buildTypes {
    release {
      signingConfig signingConfigs.ci
      minifyEnabled false
    }
  }
}
`);
  writeFileSync(
    path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:label="Branch">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
`,
  );
  writeFileSync(
    path.join(dir, 'app', 'src', 'main', 'java', 'com', 'keepoak', 'branch', 'MainActivity.java'),
    'package com.keepoak.branch;\nimport android.app.Activity;\npublic class MainActivity extends Activity {}\n',
  );
}

function generateKeystore(file) {
  run('keytool', [
    '-genkeypair',
    '-keystore', file,
    '-storetype', 'PKCS12',
    '-alias', 'ci',
    '-storepass', 'android',
    '-keypass', 'android',
    '-dname', 'CN=BranchCI',
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '2',
    '-noprompt',
  ]);
}

function assemble(project, versionCode, outApk) {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdk) writeFileSync(path.join(project, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
  const env = {
    ...process.env,
    ANDROID_VERSION_CODE: String(versionCode),
    ANDROID_VERSION_NAME: `0.1.${versionCode}`,
    ANDROID_KEYSTORE_PASSWORD: 'android',
    ANDROID_KEY_ALIAS: 'ci',
    ANDROID_KEY_PASSWORD: 'android',
  };
  run('gradle', [
    '-p', project,
    ':app:assembleRelease',
    '--build-cache',
    '-x', 'lint',
    '-x', 'test',
    `-Pandroid.injected.version.code=${versionCode}`,
  ], { env, stdio: 'inherit' });
  const built = path.join(project, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(built)) throw new Error(`Gradle finished but ${built} is missing`);
  writeFileSync(outApk, readFileSync(built));
  return outApk;
}

export function buildPair(workDir = mkdtempSync(path.join(tmpdir(), 'apk-reinstall-'))) {
  const keystore = path.join(workDir, 'ci.p12');
  const project = path.join(workDir, 'app');
  mkdirSync(project, { recursive: true });
  generateKeystore(keystore);
  writeGradleProject(project, keystore);
  const v1 = assemble(project, 1, path.join(workDir, 'v1.apk'));
  const v2 = assemble(project, 2, path.join(workDir, 'v2.apk'));
  return { workDir, v1, v2 };
}

function adb(args, opts = {}) {
  return run('adb', args, opts);
}

function adbShell(command) {
  const result = adb(['shell', command]);
  return String(result.stdout ?? '').replace(/\r/g, '').trim();
}

function writeDeviceFile(devicePath, contents) {
  const b64 = Buffer.from(contents, 'utf8').toString('base64');
  adbShell(`echo ${b64} | base64 -d > ${devicePath}`);
}

function dumpsysVersionCode() {
  const text = adbShell(`dumpsys package ${PACKAGE}`);
  const match = /versionCode=(\d+)/.exec(text);
  if (!match) throw new Error(`versionCode missing from dumpsys package ${PACKAGE}`);
  return Number(match[1]);
}

export function reinstallOnAdb({ v1, v2 }) {
  if (!existsSync(v1) || !existsSync(v2)) throw new Error('v1 and v2 APKs are required');
  adb(['wait-for-device']);
  adb(['install', '-r', v1], { stdio: 'inherit' });
  if (dumpsysVersionCode() !== 1) throw new Error('vN did not install as versionCode 1');

  adb(['root']);
  adb(['wait-for-device']);
  const data = `/data/data/${PACKAGE}`;
  adbShell(`mkdir -p ${data}/files ${data}/shared_prefs ${data}/cache`);
  writeDeviceFile(`${data}/files/pairing.json`, PAIRING_RECORD);
  writeDeviceFile(`${data}/files/chat.json`, CHAT_RECORD);
  writeDeviceFile(`${data}/shared_prefs/settings.xml`, SETTINGS_RECORD);
  const uid = adbShell(`stat -c %u ${data}`);
  adbShell(`chown -R ${uid}:${uid} ${data}/files ${data}/shared_prefs`);

  adb(['install', '-r', v2], { stdio: 'inherit' });
  if (dumpsysVersionCode() !== 2) throw new Error('vN+1 did not install as versionCode 2');

  adb(['root']);
  adb(['wait-for-device']);
  const pairing = adbShell(`cat ${data}/files/pairing.json`);
  const chat = adbShell(`cat ${data}/files/chat.json`);
  const settings = adbShell(`cat ${data}/shared_prefs/settings.xml`);
  if (pairing !== PAIRING_RECORD) throw new Error(`pairing did not survive adb install -r: ${pairing}`);
  if (chat !== CHAT_RECORD) throw new Error(`chat did not survive adb install -r: ${chat}`);
  if (!settings.includes('appearance') || !settings.includes('system')) {
    throw new Error(`settings did not survive adb install -r: ${settings}`);
  }
}

function printOutputs(pair) {
  const lines = `v1_apk=${pair.v1}\nv2_apk=${pair.v2}\n`;
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, lines, { flag: 'a' });
  else process.stdout.write(lines);
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--build')) {
    printOutputs(buildPair(process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'apk-reinstall') : undefined));
    return;
  }
  if (args.has('--adb-reinstall')) {
    reinstallOnAdb({ v1: process.env.V1_APK, v2: process.env.V2_APK });
    return;
  }
  throw new Error('pass --build or --adb-reinstall');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
