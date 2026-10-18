import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { appIdentity } from '../build/appIdentity';
import { loadDeviceIdentity } from '../connect/deviceIdentity';
import type { Platform as PhonePlatform } from '../connect/phoneGateway';
import { deviceStore, type KeyValueStore } from '../storage/keyValueStore';
import { PairingSession } from './pairingSession';
import { setPairingRandomBytes } from './relayFrames';

/** The session the real app uses: secure storage, the platform's randomness and a real WebSocket. */
export function createDeviceSession(store: KeyValueStore = deviceStore()): PairingSession {
  const randomBytes = (length: number) => Crypto.getRandomBytes(length);
  setPairingRandomBytes(randomBytes);
  return new PairingSession({
    store,
    platform: Platform.OS as PhonePlatform,
    appVersion: appIdentity().version,
    loadIdentity: () => loadDeviceIdentity(store, randomBytes),
    createRequestId: () => Crypto.randomUUID(),
    randomBytes,
  });
}
