import { hasStoredDeviceToken } from "./device-token-store";

/** Browser-safe part of the engine's pairing/setup-code payload. The code is never stored. */
export function readLimitedSetupCode(key: string | undefined): { url: string; bootstrapToken: string } | null {
  if (!key) return null;
  const value = key.trim().replace(/^oc-pair:\/\//i, "");
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== "object") return null;
    const code = payload as { url?: unknown; bootstrapToken?: unknown; expiresAtMs?: unknown };
    if (typeof code.url !== "string" || !/^wss?:\/\/\S+$/.test(code.url) ||
        typeof code.bootstrapToken !== "string" || !code.bootstrapToken.trim() ||
        (code.expiresAtMs !== undefined &&
          (typeof code.expiresAtMs !== "number" || !Number.isSafeInteger(code.expiresAtMs) || code.expiresAtMs <= Date.now()))) {
      return null;
    }
    return { url: code.url, bootstrapToken: code.bootstrapToken };
  } catch {
    return null;
  }
}

/** Set by the desktop app's preload, only when the window runs inside the desktop app. */
export type DesktopBridge = { gatewayUrl?: string; getGatewayUrl?: () => string; gatewayToken?: string };

/** The key this window starts with for `url`: the desktop app's for its own gateway, none once paired elsewhere,
 *  null when it must ask. The desktop app always sends its key, so a pairing made with fewer scopes (an older
 *  window) widens to the scopes this window asks for; a stored device token alone can never widen its own scopes. */
export function startKey(url: string, typed: string | null, bridge: DesktopBridge | undefined): string | null {
  if (typed !== null) {
    return typed;
  }
  if (url === bridge?.gatewayUrl && bridge.gatewayToken) {
    return bridge.gatewayToken;
  }
  return hasStoredDeviceToken(url) ? "" : null;
}
