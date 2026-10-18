#!/usr/bin/env node
// Unsigned iOS Simulator proof for the phone app. CI generates ios/ with `expo prebuild --clean`,
// installs CocoaPods, builds with CODE_SIGNING_ALLOWED=NO, then installs and launches the .app
// on a booted simulator. No Apple account, signing, provisioning, TestFlight or EAS.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE = 'com.keepoak.branch';
export const WORKFLOW_PATH = '.github/workflows/mobile-ios-simulator.yml';
export const LAUNCH_WATCH_SECONDS = 30;
export const SCREENSHOT_NAME = 'ios-simulator-launch.png';
export const APP_ZIP_NAME = 'BranchAgent.app.zip';
export const SCREENSHOT_ARTIFACT = 'ios-simulator-screenshot';
export const APP_ARTIFACT = 'ios-simulator-app';
export const DERIVED_DIR_NAME = 'ios-derived';
export const PINNED_SHA = /^[0-9a-f]{40}$/;

const windows = process.platform === 'win32';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mobile = path.join(root, 'mobile');

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
  if (!/name:\s*Mobile iOS Simulator/.test(text)) problems.push('workflow name');
  if (!/name:\s*iOS Simulator/.test(text)) problems.push('job name');
  if (!/runs-on:\s*macos-15/.test(text)) problems.push('macos-15 runner');
  if (!/timeout-minutes:\s*15/.test(text)) problems.push('timeout-minutes 15');
  if (/timeout-minutes:\s*(1[6-9]|[2-9]\d)/.test(text)) problems.push('timeout over 15');
  if (!/permissions:\s*\n\s+contents:\s*read/.test(text)) problems.push('read-only permissions');
  if (/contents:\s*write/.test(text)) problems.push('contents write');
  if (!/- 'mobile\/\*\*'/.test(text)) problems.push('path-filter mobile/');
  if (!/- '\.github\/workflows\/mobile-ios-simulator\.yml'/.test(text)) problems.push('path-filter workflow');
  if (!/expo prebuild --platform ios --clean/.test(text) && !/--prebuild|--ci/.test(text)) {
    problems.push('expo prebuild ios clean');
  }
  if (!/CODE_SIGNING_ALLOWED=NO/.test(text) && !/ios-simulator-check\.mjs/.test(text)) {
    problems.push('unsigned CODE_SIGNING_ALLOWED=NO');
  }
  if (/secrets\.|APPLE_|ASC_|EXPO_TOKEN|EAS_/.test(text)) problems.push('paid or signing secret');
  if (/TestFlight|provisioning|adhoc|ad-hoc|appleTeamId|ASC_/.test(text)) problems.push('store or signing flow');
  if (!/ios-simulator-check\.mjs/.test(text)) problems.push('uses ios-simulator-check.mjs');
  if (!new RegExp(SCREENSHOT_ARTIFACT).test(text)) problems.push('screenshot artifact');
  if (!new RegExp(APP_ARTIFACT).test(text)) problems.push('app zip artifact');
  for (const action of text.matchAll(/uses:\s+\S+@([0-9a-f]+)/g)) {
    if (!PINNED_SHA.test(action[1])) problems.push(`unpinned action ${action[1]}`);
  }
  return problems;
}

export function xcodebuildArgs({ workspace, scheme, derivedData }) {
  return [
    '-workspace', workspace,
    '-scheme', scheme,
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-destination', 'generic/platform=iOS Simulator',
    '-derivedDataPath', derivedData,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    'COMPILER_INDEX_STORE_ENABLE=NO',
    'FORCE_BUNDLING=1',
    'RCT_NO_LAUNCH_PACKAGER=1',
    'ONLY_ACTIVE_ARCH=YES',
    'build',
  ];
}

export function parseSimctlLaunch(output) {
  const text = String(output ?? '').trim();
  const match = /:\s*(\d+)\s*$/m.exec(text);
  if (!match) throw new Error(`simctl launch did not print a pid: ${text}`);
  return Number(match[1]);
}

export function discoverIosProject(iosDir) {
  const names = existsSync(iosDir) ? readdirSync(iosDir) : [];
  const workspaceName = names.find((name) => name.endsWith('.xcworkspace') && name !== 'Pods.xcworkspace');
  const projectName = names.find((name) => name.endsWith('.xcodeproj'));
  const scheme = (workspaceName ?? projectName ?? '').replace(/\.xcworkspace$|\.xcodeproj$/, '');
  if (!scheme) {
    throw new Error(`no iOS project in ${iosDir} (found: ${names.join(', ') || 'empty'})`);
  }
  return {
    workspace: workspaceName ? path.join(iosDir, workspaceName) : '',
    scheme,
    project: path.join(iosDir, `${scheme}.xcodeproj`),
  };
}

export function findBuiltApp(derivedData, scheme) {
  const expected = path.join(derivedData, 'Build', 'Products', 'Debug-iphonesimulator', `${scheme}.app`);
  if (existsSync(expected)) return expected;
  const products = path.join(derivedData, 'Build', 'Products');
  if (!existsSync(products)) throw new Error(`xcodebuild finished but ${expected} is missing`);
  const stack = [products];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name.endsWith('.app') && statSync(full).isDirectory()) return full;
      if (statSync(full).isDirectory()) stack.push(full);
    }
  }
  throw new Error(`xcodebuild finished but no .app was under ${products}`);
}

export function pickIphoneSimulator(devicesJson) {
  const runtimeEntries = Object.entries(devicesJson?.devices ?? {});
  const iphones = [];
  for (const [runtime, devices] of runtimeEntries) {
    if (!/iOS/.test(runtime)) continue;
    for (const device of devices ?? []) {
      if (!device?.isAvailable) continue;
      if (!/^iPhone /.test(String(device.name ?? ''))) continue;
      iphones.push({
        udid: device.udid,
        name: device.name,
        runtime,
        state: device.state,
      });
    }
  }
  if (!iphones.length) throw new Error('no available iPhone simulator');
  const preferred = iphones.find((device) => device.name === 'iPhone 16')
    ?? iphones.find((device) => /^iPhone 1\d$/.test(device.name))
    ?? iphones[0];
  return preferred;
}

export function crashReportsForBundle(dir, bundleId, sinceMs) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    if (!name.includes(bundleId) && !/BranchAgent|Branch Agent/i.test(name)) return false;
    try {
      return statSync(path.join(dir, name)).mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  });
}

function restoreKept(kept) {
  for (const [name, content] of kept) writeFileSync(path.join(mobile, name), content);
}

function keepConfigFiles() {
  return ['package.json', 'app.json', 'app.config.js']
    .filter((name) => existsSync(path.join(mobile, name)))
    .map((name) => [name, readFileSync(path.join(mobile, name))]);
}

function appendOutput(lines) {
  const file = process.env.GITHUB_OUTPUT;
  const text = `${lines.filter(Boolean).join('\n')}\n`;
  if (file) writeFileSync(file, text, { flag: 'a' });
  else process.stdout.write(text);
}

function workDir() {
  return process.env.RUNNER_TEMP ? process.env.RUNNER_TEMP : tmpdir();
}

function derivedDataPath() {
  return process.env.IOS_DERIVED_DATA || path.join(workDir(), DERIVED_DIR_NAME);
}

function artifactDir() {
  const dir = path.join(workDir(), 'ios-simulator-artifacts');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function prebuild() {
  const kept = keepConfigFiles();
  try {
    run('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean', '--no-install'], {
      cwd: mobile,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
    });
  } finally {
    restoreKept(kept);
  }
  const ios = path.join(mobile, 'ios');
  if (!existsSync(ios)) throw new Error('expo prebuild finished but mobile/ios is missing');
  return discoverIosProject(ios);
}

function podInstall() {
  const ios = path.join(mobile, 'ios');
  run('pod', ['install', '--silent'], {
    cwd: ios,
    stdio: 'inherit',
    env: {
      ...process.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      COCOAPODS_DISABLE_STATS: 'true',
    },
  });
}

function build(project) {
  const derivedData = derivedDataPath();
  mkdirSync(derivedData, { recursive: true });
  const args = xcodebuildArgs({
    workspace: project.workspace,
    scheme: project.scheme,
    derivedData,
  });
  const env = {
    ...process.env,
    CI: '1',
    EXPO_NO_TELEMETRY: '1',
    RCT_NO_LAUNCH_PACKAGER: '1',
    SKIP_BUNDLING: '',
    FORCE_BUNDLING: '1',
  };
  const beautify = spawnSync('xcbeautify', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (beautify.status === 0) {
    const xcode = spawnSync('xcodebuild', args, {
      cwd: path.join(mobile, 'ios'),
      encoding: 'utf8',
      windowsHide: true,
      env,
    });
    const log = `${xcode.stdout ?? ''}${xcode.stderr ?? ''}`;
    spawnSync('xcbeautify', [], { input: log, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
    if (xcode.status !== 0) throw new Error(`xcodebuild failed (exit ${xcode.status ?? xcode.signal})`);
  } else {
    run('xcodebuild', args, { cwd: path.join(mobile, 'ios'), stdio: 'inherit', env });
  }
  return findBuiltApp(derivedData, project.scheme);
}

function zipApp(appPath) {
  const zipPath = path.join(artifactDir(), APP_ZIP_NAME);
  rmSync(zipPath, { force: true });
  run('ditto', ['-c', '-k', '--keepParent', appPath, zipPath], { stdio: 'inherit' });
  return zipPath;
}

function listDevices() {
  run('xcrun', ['simctl', 'list'], { stdio: 'ignore' });
  const listed = run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']);
  return JSON.parse(listed.stdout);
}

function bootSimulator(device) {
  if (device.state !== 'Booted') {
    run('xcrun', ['simctl', 'boot', device.udid], { stdio: 'inherit' });
  }
  run('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { stdio: 'inherit' });
  return device.udid;
}

function processAlive(udid, pid) {
  const byPid = spawnSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'print', `pid/${pid}`], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (byPid.status === 0) return true;
  const listed = spawnSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const text = `${listed.stdout ?? ''}\n${listed.stderr ?? ''}`;
  return new RegExp(`\\b${pid}\\b`).test(text) || text.includes(PACKAGE);
}

function launchAndWatch(udid, appPath) {
  run('xcrun', ['simctl', 'install', udid, appPath], { stdio: 'inherit' });
  const started = Date.now();
  const launched = run('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, PACKAGE]);
  const pid = parseSimctlLaunch(launched.stdout);
  const screenshotPath = path.join(artifactDir(), SCREENSHOT_NAME);
  const paintMs = Math.min(5_000, LAUNCH_WATCH_SECONDS * 1000);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, paintMs);
  run('xcrun', ['simctl', 'io', udid, 'screenshot', screenshotPath], { stdio: 'inherit' });
  const remaining = (LAUNCH_WATCH_SECONDS * 1000) - (Date.now() - started);
  if (remaining > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  if (!processAlive(udid, pid)) {
    const reports = crashReportsForBundle(
      path.join(homedir(), 'Library', 'Logs', 'DiagnosticReports'),
      PACKAGE,
      started - 2_000,
    );
    throw new Error(`app ${PACKAGE} pid ${pid} exited within ${LAUNCH_WATCH_SECONDS}s${reports.length ? `; crash reports: ${reports.join(', ')}` : ''}`);
  }
  return { pid, screenshotPath };
}

function shutdownSimulator(udid) {
  if (!udid) return;
  spawnSync('xcrun', ['simctl', 'shutdown', udid], { windowsHide: true, encoding: 'utf8' });
}

function requireDarwin() {
  if (process.platform !== 'darwin') {
    throw new Error('the iOS simulator check needs macOS with Xcode');
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const ci = args.has('--ci') || Boolean(process.env.GITHUB_ACTIONS);
  const wantPrebuild = ci || args.has('--prebuild') || args.has('--all') || args.size === 0;
  const wantPods = ci || args.has('--pods') || args.has('--all') || args.size === 0;
  const wantBuild = ci || args.has('--build') || args.has('--all') || args.size === 0;
  const wantLaunch = ci || args.has('--launch');

  if (wantPrebuild || wantPods || wantBuild || wantLaunch) requireDarwin();

  let project = existsSync(path.join(mobile, 'ios')) ? discoverIosProject(path.join(mobile, 'ios')) : null;
  if (wantPrebuild) project = prebuild();
  if (wantPods) {
    if (!project) project = discoverIosProject(path.join(mobile, 'ios'));
    podInstall();
    // `expo prebuild --no-install` writes the xcodeproj and Podfile; pod install creates the workspace.
    project = discoverIosProject(path.join(mobile, 'ios'));
  }
  let appPath = process.env.IOS_APP_PATH || '';
  if (wantBuild) {
    if (!project?.workspace) project = discoverIosProject(path.join(mobile, 'ios'));
    if (!project.workspace) throw new Error('pod install did not create an xcworkspace');
    appPath = build(project);
  }
  const zipPath = appPath ? zipApp(appPath) : '';
  let screenshotPath = '';
  let udid = '';
  try {
    if (wantLaunch) {
      if (!appPath) throw new Error('launch needs a built .app');
      const device = pickIphoneSimulator(listDevices());
      udid = bootSimulator(device);
      ({ screenshotPath } = launchAndWatch(udid, appPath));
    }
  } finally {
    if (udid) shutdownSimulator(udid);
  }

  appendOutput([
    appPath && `app_path=${appPath}`,
    zipPath && `zip_path=${zipPath}`,
    screenshotPath && `screenshot_path=${screenshotPath}`,
    `screenshot_name=${SCREENSHOT_NAME}`,
    `app_zip_name=${APP_ZIP_NAME}`,
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
