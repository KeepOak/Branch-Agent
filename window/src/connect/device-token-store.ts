import type {
  GatewayBrowserDeviceTokenRecord,
  GatewayBrowserDeviceTokenStore,
} from "@branch/gateway-client/browser";

const PREFIX = "branch-device-token-v1";

type Key = { clientId: string; deviceId: string; role: string };

/**
 * Keeps the device token the engine issues after pairing, one per engine address,
 * client, device and role. The shared gateway token is never stored here.
 */
export function createDeviceTokenStore(gatewayUrl: string): GatewayBrowserDeviceTokenStore {
  const keyOf = ({ clientId, deviceId, role }: Key) =>
    `${PREFIX}:${gatewayUrl}:${clientId}:${deviceId}:${role}`;
  return {
    load(key) {
      try {
        const raw = localStorage.getItem(keyOf(key));
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw) as GatewayBrowserDeviceTokenRecord;
        return typeof parsed.token === "string" && Array.isArray(parsed.scopes) ? parsed : null;
      } catch {
        return null;
      }
    },
    store({ token, scopes, ...key }) {
      try {
        localStorage.setItem(keyOf(key), JSON.stringify({ token, scopes }));
      } catch {
        // Without storage the window pairs again on the next load.
      }
    },
    clear(key) {
      try {
        localStorage.removeItem(keyOf(key));
      } catch {
        // Nothing stored, nothing to clear.
      }
    },
  };
}

/** True when this browser already holds a device token for the engine at `gatewayUrl`. */
export function hasStoredDeviceToken(gatewayUrl: string): boolean {
  try {
    const prefix = `${PREFIX}:${gatewayUrl}:`;
    for (let i = 0; i < localStorage.length; i += 1) {
      if (localStorage.key(i)?.startsWith(prefix)) {
        return true;
      }
    }
  } catch {
    // Storage blocked: treat as not paired.
  }
  return false;
}
