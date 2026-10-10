// Keeps the device token the engine issues once this phone is approved, one per engine address,
// client, device and role (the window's device-token-store.ts, on the phone's secure storage).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  GatewayBrowserDeviceTokenRecord,
  GatewayBrowserDeviceTokenStore,
} from '@branch/gateway-client/browser';
import type { KeyValueStore } from '../storage/keyValueStore';
import { utf8ToBytes } from './base64url';

type Key = { clientId: string; deviceId: string; role: string };

// Secure storage keys may only use letters, digits, dot, dash and underscore, so the address is hashed.
export function deviceTokenKey(gatewayUrl: string, { clientId, deviceId, role }: Key): string {
  const digest = bytesToHex(sha256(utf8ToBytes(`${gatewayUrl}|${clientId}|${deviceId}|${role}`))).slice(0, 32);
  return `branch.device-token.v1.${digest}`;
}

export function createDeviceTokenStore(store: KeyValueStore, gatewayUrl: string): GatewayBrowserDeviceTokenStore {
  return {
    async load(key) {
      const raw = await store.get(deviceTokenKey(gatewayUrl, key));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as GatewayBrowserDeviceTokenRecord;
        return typeof parsed.token === 'string' && Array.isArray(parsed.scopes) ? parsed : null;
      } catch {
        return null;
      }
    },
    async store({ token, scopes, ...key }) {
      await store.set(deviceTokenKey(gatewayUrl, key), JSON.stringify({ token, scopes }));
    },
    async clear(key) {
      await store.remove(deviceTokenKey(gatewayUrl, key));
    },
  };
}
