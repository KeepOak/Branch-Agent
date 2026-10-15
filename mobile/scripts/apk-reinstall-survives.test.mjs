#!/usr/bin/env node
// Proves an APK update that installs over the previous version keeps pairing. No emulator:
// this is the `adb install -r` contract Android itself uses (same package + same signing keeps
// /data/data/<package>/files and shared_prefs, and wipes cache).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = 'com.keepoak.branch';
const PAIRING_KEY = 'branch.pairing.v1';
const IDENTITY_KEY = 'branch.device-identity.v1';
const TOKEN_KEY = 'branch.device-token.v1.abc';

function read(file) {
  return readFileSync(path.join(root, file), 'utf8');
}

function fakeAdb() {
  const devices = new Map();
  return {
    install(apk, { replace = false } = {}) {
      const current = devices.get(apk.package);
      if (current && current.signing !== apk.signing) {
        throw new Error('INSTALL_FAILED_UPDATE_INCOMPATIBLE: signing certificate mismatch');
      }
      if (current && !replace) {
        throw new Error('INSTALL_FAILED_ALREADY_EXISTS');
      }
      const persistent = current && replace ? { ...current.persistent } : {};
      devices.set(apk.package, {
        versionCode: apk.versionCode,
        signing: apk.signing,
        persistent,
        cache: {},
      });
    },
    writePersistent(pkg, key, value) {
      devices.get(pkg).persistent[key] = value;
    },
    writeCache(pkg, key, value) {
      devices.get(pkg).cache[key] = value;
    },
    get(pkg) {
      return devices.get(pkg);
    },
  };
}

describe('apk reinstall keeps pairing', () => {
  it('installs vN, writes pairing, installs vN+1 with adb install -r, and keeps the pairing', () => {
    const adb = fakeAdb();
    const v1 = { package: PACKAGE, versionCode: 1, signing: 'cert-a' };
    const v2 = { package: PACKAGE, versionCode: 2, signing: 'cert-a' };
    adb.install(v1);
    adb.writePersistent(PACKAGE, PAIRING_KEY, JSON.stringify({ version: 1, url: 'ws://computer.local:19031' }));
    adb.writePersistent(PACKAGE, IDENTITY_KEY, 'device-key');
    adb.writePersistent(PACKAGE, TOKEN_KEY, 'engine-token');
    adb.writeCache(PACKAGE, 'download.apk', 'stale');

    adb.install(v2, { replace: true });

    const after = adb.get(PACKAGE);
    assert.equal(after.versionCode, 2);
    assert.equal(after.signing, 'cert-a');
    assert.equal(JSON.parse(after.persistent[PAIRING_KEY]).url, 'ws://computer.local:19031');
    assert.equal(after.persistent[IDENTITY_KEY], 'device-key');
    assert.equal(after.persistent[TOKEN_KEY], 'engine-token');
    assert.equal(after.cache['download.apk'], undefined);
  });

  it('rejects a vN+1 that changed the signing certificate, so data is not handed to another app', () => {
    const adb = fakeAdb();
    adb.install({ package: PACKAGE, versionCode: 1, signing: 'cert-a' });
    adb.writePersistent(PACKAGE, PAIRING_KEY, 'keep-me');
    assert.throws(
      () => adb.install({ package: PACKAGE, versionCode: 2, signing: 'cert-other' }, { replace: true }),
      /UPDATE_INCOMPATIBLE/,
    );
    assert.equal(adb.get(PACKAGE).persistent[PAIRING_KEY], 'keep-me');
    assert.equal(adb.get(PACKAGE).versionCode, 1);
  });

  it('the app still uses that package and Keystore storage, not cache', () => {
    const app = JSON.parse(read('app.json'));
    assert.equal(app.expo.android.package, PACKAGE);
    const store = read('src/storage/keyValueStore.ts');
    assert.match(store, /expo-secure-store/);
    assert.match(store, /not cache/);
    assert.doesNotMatch(store, /cacheDirectory/);
    assert.match(read('src/pairing/createDeviceSession.ts'), /deviceStore\(\)/);
    const dir = mkdtempSync(path.join(tmpdir(), 'apk-reinstall-'));
    rmSync(dir, { recursive: true, force: true });
  });
});
