#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  APP_ARTIFACT,
  APP_ZIP_NAME,
  LAUNCH_WATCH_SECONDS,
  PACKAGE,
  SCREENSHOT_ARTIFACT,
  SCREENSHOT_NAME,
  WORKFLOW_PATH,
  crashReportsForBundle,
  discoverIosProject,
  parseSimctlLaunch,
  pickIphoneSimulator,
  workflowContract,
  xcodebuildArgs,
  xcodebuildLaunch,
  xcodebuildOutputIsBuffered,
} from './ios-simulator-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mobile = path.join(root, 'mobile');

function read(file) {
  return readFileSync(path.join(mobile, file), 'utf8');
}

describe('iOS simulator CI contract', () => {
  it('builds an unsigned simulator app and launches it, with no Apple account', () => {
    const yaml = readFileSync(path.join(root, WORKFLOW_PATH), 'utf8');
    assert.deepEqual(workflowContract(yaml), []);
    assert.match(yaml, /runs-on:\s*macos-15/);
    assert.match(yaml, /timeout-minutes:\s*15/);
    assert.doesNotMatch(yaml, /timeout-minutes:\s*(1[6-9]|[2-9]\d)/);
    assert.match(yaml, /CODE_SIGNING_ALLOWED=NO|ios-simulator-check\.mjs/);
    assert.doesNotMatch(yaml, /secrets\./);
    assert.doesNotMatch(yaml, /TestFlight|appleTeamId|provisioning/);
    assert.match(yaml, new RegExp(SCREENSHOT_ARTIFACT));
    assert.match(yaml, new RegExp(APP_ARTIFACT));
    assert.match(yaml, /ios-simulator-check\.mjs --ci/);
    assert.doesNotMatch(yaml, /\$\{\{\s*env\.HOME\s*\}\}/);
    assert.match(yaml, /path:\s*~\/Library\/Caches\/CocoaPods/);
    assert.match(yaml, /cocoapods-v2-/);
    assert.match(yaml, /ios-derived-v2-/);
    assert.ok(workflowContract(yaml.replaceAll('~/Library/Caches/CocoaPods', '${{ env.HOME }}/Library/Caches/CocoaPods')).includes('env.HOME'));
  });

  it('never buffers xcodebuild output', () => {
    const args = xcodebuildArgs({
      workspace: 'ios/BranchAgent.xcworkspace',
      scheme: 'BranchAgent',
      derivedData: '/tmp/ios-derived',
    });
    const piped = xcodebuildLaunch(args, { xcbeautify: true });
    assert.equal(piped.command, 'bash');
    assert.deepEqual(piped.args.slice(0, 4), ['-o', 'pipefail', '-c', 'xcodebuild "$@" | xcbeautify']);
    assert.equal(piped.stdio, 'inherit');
    assert.equal(piped.encoding, undefined);
    const fallback = xcodebuildLaunch(args, { xcbeautify: false });
    assert.equal(fallback.command, 'xcodebuild');
    assert.equal(fallback.args, args);
    assert.equal(fallback.stdio, 'inherit');
    assert.equal(fallback.encoding, undefined);
    const source = readFileSync(path.join(mobile, 'scripts/ios-simulator-check.mjs'), 'utf8');
    assert.equal(xcodebuildOutputIsBuffered(source), false);
    assert.equal(
      xcodebuildOutputIsBuffered("spawnSync('xcodebuild', args, { encoding: 'utf8' })"),
      true,
    );
  });

  it('the app still uses that bundle id and Keychain storage, not cache', () => {
    const app = JSON.parse(read('app.json'));
    assert.equal(app.expo.ios.bundleIdentifier, PACKAGE);
    assert.equal(app.expo.android.package, PACKAGE);
    const store = read('src/storage/keyValueStore.ts');
    assert.match(store, /expo-secure-store/);
    assert.match(store, /not cache/);
    assert.doesNotMatch(store, /cacheDirectory/);
  });

  it('xcodebuild is simulator-only, unsigned, and bundles JS so launch needs no Metro', () => {
    const args = xcodebuildArgs({
      workspace: 'ios/BranchAgent.xcworkspace',
      scheme: 'BranchAgent',
      derivedData: '/tmp/ios-derived',
    }).join(' ');
    assert.match(args, /generic\/platform=iOS Simulator/);
    assert.match(args, /CODE_SIGNING_ALLOWED=NO/);
    assert.match(args, /FORCE_BUNDLING=1/);
    assert.match(args, /RCT_NO_LAUNCH_PACKAGER=1/);
    assert.doesNotMatch(args, /iphoneos/);
    assert.equal(LAUNCH_WATCH_SECONDS, 30);
    assert.equal(SCREENSHOT_NAME, 'ios-simulator-launch.png');
    assert.equal(APP_ZIP_NAME, 'BranchAgent.app.zip');
  });

  it('discovers the generated workspace and prefers an iPhone simulator', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ios-project-'));
    try {
      mkdirSync(path.join(dir, 'BranchAgent.xcodeproj'));
      assert.deepEqual(discoverIosProject(dir), {
        workspace: '',
        scheme: 'BranchAgent',
        project: path.join(dir, 'BranchAgent.xcodeproj'),
      });
      mkdirSync(path.join(dir, 'BranchAgent.xcworkspace'));
      mkdirSync(path.join(dir, 'Pods.xcworkspace'));
      assert.deepEqual(discoverIosProject(dir), {
        workspace: path.join(dir, 'BranchAgent.xcworkspace'),
        scheme: 'BranchAgent',
        project: path.join(dir, 'BranchAgent.xcodeproj'),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const devices = {
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-5': [
          { udid: 'pad', name: 'iPad Air 11-inch (M3)', isAvailable: true, state: 'Shutdown' },
          { udid: 'phone-se', name: 'iPhone SE (3rd generation)', isAvailable: true, state: 'Shutdown' },
          { udid: 'phone-16', name: 'iPhone 16', isAvailable: true, state: 'Shutdown' },
        ],
      },
    };
    assert.deepEqual(pickIphoneSimulator(devices), {
      udid: 'phone-16',
      name: 'iPhone 16',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-5',
      state: 'Shutdown',
    });
    assert.equal(parseSimctlLaunch('com.keepoak.branch: 4321\n'), 4321);
    assert.deepEqual(crashReportsForBundle(dir, PACKAGE, Date.now()), []);
  });
});
