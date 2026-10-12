// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:ui/src/lib/nodes/index.ts (atlas OPS-0133). Changed for Branch: kept only the Ed25519 device identity and signing; the issued device token is kept by device-token-store.ts; the pure-JS SHA-512 fallback is dropped because the window always runs on a secure origin (127.0.0.1).
import { etc, getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import type { GatewayBrowserDeviceIdentity } from "@branch/gateway-client/browser";

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
};

type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

const DEVICE_IDENTITY_STORAGE_KEY = "branch-device-identity-v1";

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", publicKey.slice().buffer);
  return etc.bytesToHex(new Uint8Array(hash));
}

async function generateIdentity(): Promise<DeviceIdentity> {
  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  return {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
  };
}

function readStoredDeviceIdentity(): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(DEVICE_IDENTITY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKey === "string"
      ) {
        return parsed;
      }
    }
  } catch {
    // Unavailable or malformed browser storage carries no usable identity.
  }
  return null;
}

// Storage-blocked pages must still present one stable device per page lifetime;
// a fresh key on every reconnect would raise a new pairing request each time.
let sessionDeviceIdentity: DeviceIdentity | null = null;

async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const parsed = readStoredDeviceIdentity();
  try {
    if (parsed) {
      const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey));
      if (derivedId !== parsed.deviceId) {
        localStorage.setItem(
          DEVICE_IDENTITY_STORAGE_KEY,
          JSON.stringify({ ...parsed, deviceId: derivedId }),
        );
      }
      return { deviceId: derivedId, publicKey: parsed.publicKey, privateKey: parsed.privateKey };
    }
  } catch {
    // Invalid local identity is replaced below.
  }
  if (sessionDeviceIdentity) {
    return sessionDeviceIdentity;
  }
  const identity = await generateIdentity();
  const stored: StoredIdentity = { version: 1, ...identity, createdAtMs: Date.now() };
  try {
    localStorage.setItem(DEVICE_IDENTITY_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // A write-rejecting store still gets the in-memory identity below.
  }
  sessionDeviceIdentity = identity;
  return identity;
}

async function signDevicePayload(privateKeyBase64Url: string, payload: string): Promise<string> {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}

/** The window's device identity in the shape the gateway client's browser lifecycle expects. */
export async function loadBrowserDeviceIdentity(): Promise<GatewayBrowserDeviceIdentity> {
  const identity = await loadOrCreateDeviceIdentity();
  return {
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    sign: (payload) => signDevicePayload(identity.privateKey, payload),
  };
}
