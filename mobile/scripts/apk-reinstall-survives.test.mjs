#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  EMULATOR_RUNNER_SHA,
  PACKAGE,
  WORKFLOW_PATH,
  workflowContract,
} from './apk-reinstall-survives.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mobile = path.join(root, 'mobile');

function read(file) {
  return readFileSync(path.join(mobile, file), 'utf8');
}

describe('apk reinstall keeps pairing', () => {
  it('CI runs a real emulator adb install -r job, not a fake adb', () => {
    const yaml = readFileSync(path.join(root, WORKFLOW_PATH), 'utf8');
    assert.deepEqual(workflowContract(yaml), []);
    assert.match(yaml, new RegExp(`reactivecircus/android-emulator-runner@${EMULATOR_RUNNER_SHA}`));
    assert.match(yaml, /paths:\n(?:[^\n]*\n)*?\s+- 'mobile\/\*\*'/);
    const script = read('scripts/apk-reinstall-survives.mjs');
    assert.match(script, /adb install -r/);
    assert.doesNotMatch(script, /fakeAdb/);
    assert.match(script, /throwaway test key/);
    assert.match(script, /pairing\.json/);
    assert.match(script, /chat\.json/);
    assert.match(script, /settings\.xml/);
  });

  it('the app still uses that package and Keystore storage, not cache', () => {
    const app = JSON.parse(read('app.json'));
    assert.equal(app.expo.android.package, PACKAGE);
    const store = read('src/storage/keyValueStore.ts');
    assert.match(store, /expo-secure-store/);
    assert.match(store, /not cache/);
    assert.doesNotMatch(store, /cacheDirectory/);
    assert.match(read('src/pairing/createDeviceSession.ts'), /deviceStore\(\)/);
  });
});
