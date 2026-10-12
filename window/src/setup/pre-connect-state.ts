// What the pre-connect screens remember: the Welcome promise and the Where choice for this window session (so setup
// continues at Models once connected), and the Branch the person chose to connect to.
import type { Where } from "./setup-model";

const PRE_KEY = "branch.setupPre";
const TARGET_KEY = "branch.gatewayTarget";
const TARGET_NAME_KEY = "branch.gatewayTargetName";
const SAVED_TARGETS_KEY = "branch.gatewayTargets.v1";

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
      localStorage.removeItem(TARGET_NAME_KEY);
    }
  } catch {
    // storage blocked: the address lasts for this window only
  }
}

/** The last name reported by a successfully connected remote Branch. */
export function readTargetName(url: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(TARGET_NAME_KEY) ?? "null") as { url?: string; name?: string } | null;
    return saved?.url === url && typeof saved.name === "string" ? saved.name : readSavedTargets().find(row => row.url === url)?.name ?? null;
  } catch { return null; }
}

export function saveTargetName(url: string, name: string): void {
  try {
    localStorage.setItem(TARGET_NAME_KEY, JSON.stringify({ url, name }));
    if (name.trim() && !isLocalTarget(url)) {
      const rows = readSavedTargets().filter(row => row.url !== url);
      localStorage.setItem(SAVED_TARGETS_KEY, JSON.stringify([...rows, { url, name: name.trim() }]));
    }
  } catch { /* The connection still works when storage is unavailable. */ }
}

/** Successfully connected Branches, for the machine switcher. No keys are kept here. */
export function readSavedTargets(): { url: string; name: string }[] {
  try {
    const rows = JSON.parse(localStorage.getItem(SAVED_TARGETS_KEY) ?? "[]") as unknown;
    const seen = new Set<string>();
    return Array.isArray(rows) ? rows.filter((row): row is { url: string; name: string } => {
      if (!row || typeof row.url !== "string" || !/^wss?:\/\/\S+$/.test(row.url)
        || typeof row.name !== "string" || !row.name.trim() || isLocalTarget(row.url) || seen.has(row.url)) return false;
      seen.add(row.url);
      return true;
    }) : [];
  } catch { return []; }
}

export function isLocalTarget(url: string): boolean {
  try { return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname); }
  catch { return false; }
}

/** The engine's own default gateway address on this computer (engine config/paths.ts DEFAULT_GATEWAY_PORT). */
export const LOCAL_ADDRESS = "ws://127.0.0.1:18789";
