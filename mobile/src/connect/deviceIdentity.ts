// The phone's own device key. Same scheme as the desktop window (window/src/connect/device-identity.ts):
// an Ed25519 key pair, device id = hex SHA-256 of the raw public key, keys and signatures in base64url.
// Hermes has no WebCrypto, so hashing and signing use @noble's synchronous code with SHA-512 from
// @noble/hashes, and the 32 random key bytes come from the platform (expo-crypto).
import { getPublicKey, hashes, sign } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { GatewayBrowserDeviceIdentity } from '@branch/gateway-client/browser';
import type { KeyValueStore } from '../storage/keyValueStore';
import { base64UrlToBytes, bytesToBase64Url, utf8ToBytes } from './base64url';

hashes.sha512 = sha512;

export const DEVICE_IDENTITY_KEY = 'branch.device-identity.v1';

type StoredIdentity = { version: 1; deviceId: string; publicKey: string; privateKey: string; createdAtMs: number };

function deviceIdFor(publicKey: Uint8Array): string {
  return bytesToHex(sha256(publicKey));
}

function parse(raw: string | null): StoredIdentity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredIdentity>;
    if (value.version === 1 && typeof value.publicKey === 'string' && typeof value.privateKey === 'string') {
      return value as StoredIdentity;
    }
  } catch {
    // A damaged record is replaced by a new key below.
  }
  return null;
}

/** Loads this phone's device key, creating and saving one the first time. */
export async function loadDeviceIdentity(
  store: KeyValueStore,
  randomBytes: (length: number) => Uint8Array,
): Promise<GatewayBrowserDeviceIdentity> {
  let stored = parse(await store.get(DEVICE_IDENTITY_KEY));
  if (!stored) {
    const privateKey = randomBytes(32);
    const publicKey = getPublicKey(privateKey);
    stored = {
      version: 1,
      deviceId: deviceIdFor(publicKey),
      publicKey: bytesToBase64Url(publicKey),
      privateKey: bytesToBase64Url(privateKey),
      createdAtMs: Date.now(),
    };
    await store.set(DEVICE_IDENTITY_KEY, JSON.stringify(stored));
  }
  const secret = base64UrlToBytes(stored.privateKey);
  return {
    deviceId: deviceIdFor(base64UrlToBytes(stored.publicKey)),
    publicKey: stored.publicKey,
    sign: async (payload) => bytesToBase64Url(sign(utf8ToBytes(payload), secret)),
  };
}
