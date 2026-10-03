// What the pre-connect screens remember: the Welcome promise and the Where choice for this window session (so setup
// continues at Models once connected), and the Branch the person chose to connect to.
import type { Where } from "./setup-model";

const PRE_KEY = "branch.setupPre";
const TARGET_KEY = "branch.gatewayTarget";

export type PreConnect = { promise: boolean; where: Where };

export function readPreConnect(): PreConnect | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(PRE_KEY) ?? "null") as PreConnect | null;
    return v && typeof v.promise === "boolean" && typeof v.where === "string" ? v : null;
  } catch {
    return null; // storage blocked: setup asks again from Welcome
  }
}

export function savePreConnect(v: PreConnect): void {
  try {
    sessionStorage.setItem(PRE_KEY, JSON.stringify(v));
  } catch {
    // storage blocked: setup asks again from Welcome once connected
  }
}

/** The address picked on "Where should Branch run?" or "Connect to a Branch elsewhere"; the key is never stored here. */
export function readTarget(): string | null {
  try {
    const v = localStorage.getItem(TARGET_KEY);
    return v && /^wss?:\/\/\S+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveTarget(url: string | null): void {
  try {
    if (url) {
      localStorage.setItem(TARGET_KEY, url);
    } else {
      localStorage.removeItem(TARGET_KEY);
    }
  } catch {
    // storage blocked: the address lasts for this window only
  }
}

/** The engine's own default gateway address on this computer (engine config/paths.ts DEFAULT_GATEWAY_PORT). */
export const LOCAL_ADDRESS = "ws://127.0.0.1:18789";
