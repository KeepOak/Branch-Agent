// Node stand-in for mobile/src/pairing/relayFrames.ts when the engine hop test
// loads PhoneGateway. Same AES-256-GCM envelope as pairing-relay.ts; no Expo,
// no @noble/ciphers, no mobile node_modules.
import {
  decryptPairingFrame as decryptEngineFrame,
  encryptPairingFrame as encryptEngineFrame,
} from "./pairing-relay.js";

const KEY_BYTES = 32;

export type PairingRandomBytes = (count: number) => Uint8Array;

export function setPairingRandomBytes(_randomBytes: PairingRandomBytes): void {
  // Engine frames mint a fresh 12-byte nonce in encryptPairingFrame.
}

export function pairingRelayKey(relayKey: string | undefined): Uint8Array | undefined {
  if (!relayKey || !/^[A-Za-z0-9_-]+$/u.test(relayKey)) {
    return undefined;
  }
  try {
    const key = Buffer.from(relayKey, "base64url");
    return key.length === KEY_BYTES ? new Uint8Array(key) : undefined;
  } catch {
    return undefined;
  }
}

export function encryptPairingFrame(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return new Uint8Array(encryptEngineFrame(Buffer.from(key), Buffer.from(plaintext)));
}

export function decryptPairingFrame(key: Uint8Array, envelope: Uint8Array): Uint8Array {
  return new Uint8Array(decryptEngineFrame(Buffer.from(key), Buffer.from(envelope)));
}

export function coerceRelayBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (typeof data === "string") {
    return Buffer.from(data);
  }
  throw new Error("Pairing relay frame is too short.");
}

export function utf8FromRelayBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}
