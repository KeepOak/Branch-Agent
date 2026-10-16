import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { appIdentity } from '../build/appIdentity';
import { loadDeviceIdentity } from '../connect/deviceIdentity';
import type { Platform as PhonePlatform } from '../connect/phoneGateway';
import { deviceStore } from '../storage/keyValueStore';
import { PairingSession } from './pairingSession';

/** The session the real app uses: secure storage, the platform's randomness and a real WebSocket. */
export function createDeviceSession(): PairingSession {
  const store = deviceStore();
  let identity: ReturnType<typeof loadDeviceIdentity> | null = null;
  return new PairingSession({
    store,
    platform: Platform.OS as PhonePlatform,
    appVersion: appIdentity().version,
    loadIdentity: () => (identity ??= loadDeviceIdentity(store, (length) => Crypto.getRandomBytes(length))),
    createRequestId: () => Crypto.randomUUID(),
  });
}
