// AES-256-GCM envelopes the phone and desktop share on a pairing relay hop.
// Same layout as engine/src/pairing/pairing-relay.ts: nonce || tag || ciphertext.
// Hermes has no WebCrypto, so this uses @noble/ciphers the way Reef does.
// Hermes also has no crypto.getRandomValues; the nonce bytes come from expo-crypto
// (same source as the device key), installed by createDeviceSession / Jest setup.
import { gcm } from '@noble/ciphers/aes.js';
import { base64UrlToBytes, utf8ToBytes } from '../connect/base64url';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type PairingRandomBytes = (count: number) => Uint8Array;

let pairingRandomBytes: PairingRandomBytes | undefined;

/** Install the platform RNG. The app passes expo-crypto `getRandomBytes`. */
export function setPairingRandomBytes(randomBytes: PairingRandomBytes): void {
  pairingRandomBytes = randomBytes;
}

function randomNonce(): Uint8Array {
  if (!pairingRandomBytes) throw new Error('Pairing relay key is invalid.');
  const nonce = pairingRandomBytes(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new Error('Pairing relay frame is too short.');
  return nonce;
}

/** 32-byte session key from the setup code's relayKey, or undefined when it cannot wrap frames. */
export function pairingRelayKey(relayKey: string | undefined): Uint8Array | undefined {
  if (!relayKey) return undefined;
  try {
    const key = base64UrlToBytes(relayKey);
    return key.length === KEY_BYTES ? key : undefined;
  } catch {
    return undefined;
  }
}

export function encryptPairingFrame(key: Uint8Array, plaintext: Uint8Array, nonce: Uint8Array = randomNonce()): Uint8Array {
  if (key.length !== KEY_BYTES) throw new Error('Pairing relay key is invalid.');
  if (nonce.length !== NONCE_BYTES) throw new Error('Pairing relay frame is too short.');
  const sealed = gcm(key, nonce).encrypt(plaintext);
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const envelope = new Uint8Array(NONCE_BYTES + TAG_BYTES + ciphertext.length);
  envelope.set(nonce, 0);
  envelope.set(tag, NONCE_BYTES);
  envelope.set(ciphertext, NONCE_BYTES + TAG_BYTES);
  return envelope;
}

export function decryptPairingFrame(key: Uint8Array, envelope: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new Error('Pairing relay key is invalid.');
  if (envelope.length < NONCE_BYTES + TAG_BYTES) throw new Error('Pairing relay frame is too short.');
  const nonce = envelope.subarray(0, NONCE_BYTES);
  const tag = envelope.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const ciphertext = envelope.subarray(NONCE_BYTES + TAG_BYTES);
  const sealed = new Uint8Array(ciphertext.length + TAG_BYTES);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);
  return gcm(key, nonce).decrypt(sealed);
}

export function coerceRelayBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return utf8ToBytes(data);
  throw new Error('Pairing relay frame is too short.');
}

export function utf8FromRelayBytes(bytes: Uint8Array): string {
  let escaped = '';
  for (const byte of bytes) escaped += '%' + byte.toString(16).padStart(2, '0');
  return decodeURIComponent(escaped);
}
