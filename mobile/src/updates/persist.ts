import { DEVICE_IDENTITY_KEY } from '../connect/deviceIdentity';
import { PAIRING_RECORD_KEY } from '../pairing/pairingSession';

/**
 * Pairing, the device key and the engine token live in expo-secure-store (Keystore), which Android
 * keeps across `adb install -r` / in-app APK updates. They must never be written to cache.
 * Chats and settings that the engine holds come back once pairing is still there.
 */
export const PERSISTENT_KEYS = {
  identity: DEVICE_IDENTITY_KEY,
  pairing: PAIRING_RECORD_KEY,
  deviceTokenPrefix: 'branch.device-token.v1.',
} as const;

export const ANDROID_PACKAGE = 'com.keepoak.branch';
