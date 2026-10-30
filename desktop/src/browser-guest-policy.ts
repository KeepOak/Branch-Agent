// Pure rules for the R1 browser guest: the page the person browses inside Branch. Electron wiring lives in main.ts.
// Nothing here imports Electron, so the rules are testable with node:test.

/** The only session partition a guest may use. Guests never share the app's own storage. */
export const BRANCH_BROWSER_PARTITION = "persist:branch-browser";

export type GuestUrlDecision = "allow" | "block";
export type PopupDecision = "open-tab" | "deny";

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

/** Web pages and about:blank only. file:, chrome:, devtools:, javascript:, data: and anything else are blocked. */
export function guestUrlDecision(raw: string | undefined): GuestUrlDecision {
  if (raw === undefined || raw === "") return "allow";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "block";
  }
  if (parsed.href === "about:blank") return "allow";
  return WEB_PROTOCOLS.has(parsed.protocol) ? "allow" : "block";
}

/** Attach only a guest on the Branch partition, and only to a page the rules allow. */
export function guestAttachDecision(params: { partition?: string; src?: string }): boolean {
  return params.partition === BRANCH_BROWSER_PARTITION && guestUrlDecision(params.src) === "allow";
}

/** A popup asks the host to open a new tab for web pages. Everything else is refused. */
export function popupDecision(raw: string): PopupDecision {
  try {
    return WEB_PROTOCOLS.has(new URL(raw).protocol) ? "open-tab" : "deny";
  } catch {
    return "deny";
  }
}

/** Every guest permission is refused: camera, microphone, location, notifications, clipboard and the rest. */
export function guestPermissionDecision(): false {
  return false;
}

/** Overwrite the guest's web preferences in place: no preload, no Node, isolated and sandboxed. */
export function applyGuestWebPreferences(prefs: Record<string, unknown>): void {
  delete prefs.preload;
  delete prefs.preloadURL;
  prefs.partition = BRANCH_BROWSER_PARTITION;
  prefs.nodeIntegration = false;
  prefs.nodeIntegrationInSubFrames = false;
  prefs.nodeIntegrationInWorker = false;
  prefs.contextIsolation = true;
  prefs.sandbox = true;
  prefs.webSecurity = true;
  prefs.allowRunningInsecureContent = false;
  prefs.experimentalFeatures = false;
  prefs.webviewTag = false;
  prefs.javascript = true;
}

/** The R1 window's own web preferences. Only R1 windows may host the browser guest tag. */
export function r1WebPreferences(preload: string): Record<string, unknown> {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: true,
  };
}
