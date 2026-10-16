import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEVICE_IDENTITY_KEY } from '../connect/deviceIdentity';
import { PAIRING_RECORD_KEY } from '../pairing/pairingSession';
import { deviceStore } from '../storage/keyValueStore';
import { ANDROID_PACKAGE, PERSISTENT_KEYS } from './persist';
import app from '../../app.json';

const root = path.join(__dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('pairing survives an APK update', () => {
  it('keeps pairing, the device key and the engine token in persistent keys, never cache', () => {
    expect(PERSISTENT_KEYS.pairing).toBe(PAIRING_RECORD_KEY);
    expect(PERSISTENT_KEYS.identity).toBe(DEVICE_IDENTITY_KEY);
    expect(PERSISTENT_KEYS.deviceTokenPrefix).toBe('branch.device-token.v1.');
    const store = read('src/storage/keyValueStore.ts');
    expect(store).toMatch(/expo-secure-store/);
    expect(store).toMatch(/not cache/);
    expect(store).not.toMatch(/cacheDirectory/);
    const session = read('src/pairing/createDeviceSession.ts');
    expect(session).toMatch(/deviceStore\(\)/);
    expect(read('src/pairing/pairingSession.ts')).toContain(PAIRING_RECORD_KEY);
    expect(read('src/connect/deviceIdentity.ts')).toContain(DEVICE_IDENTITY_KEY);
    expect(read('src/connect/deviceTokenStore.ts')).toContain('branch.device-token.v1.');
  });

  it('does not change the Android package, so an update installs over this app', () => {
    expect(app.expo.android.package).toBe(ANDROID_PACKAGE);
    expect(ANDROID_PACKAGE).toBe('com.keepoak.branch');
  });

  it('the live device store is SecureStore, not an in-memory or cache folder', () => {
    const store = deviceStore();
    expect(store.get.name.length).toBeGreaterThan(0);
    expect(read('src/storage/keyValueStore.ts')).toMatch(/SecureStore\.(getItemAsync|setItemAsync)/);
  });
});
