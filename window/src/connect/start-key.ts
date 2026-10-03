import { hasStoredDeviceToken } from "./device-token-store";

/** Set by the desktop app's preload, only when the window runs inside the desktop app. */
export type DesktopBridge = { gatewayUrl?: string; gatewayToken?: string };

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
