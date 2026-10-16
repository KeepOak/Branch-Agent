// This computer's own permissions (desktop/src/os-permissions.ts through the preload's branchDesktop.permissions):
// what the system already allows, a single Allow that shows the system's prompt, and the matching settings page.
// In a plain browser, or with an older desktop app, there is no bridge and the rows say why.
import { useCallback, useEffect, useState } from "react";

export type OsPermission = "microphone" | "camera" | "location" | "notifications";
/** allowed / denied by the system, not-asked when it never asked, unknown when the app has no way to read it. */
export type OsPermissionStatus = "allowed" | "denied" | "not-asked" | "unknown";
export type OsPermissionsState = Record<OsPermission, OsPermissionStatus>;
export type OsPermissionsBridge = {
  get(): Promise<OsPermissionsState>;
  request(name: OsPermission): Promise<OsPermissionsState>;
  open(name: OsPermission): Promise<void>;
};

/** The bridge, or null in a browser or an older desktop app. */
export function osPermissions(): OsPermissionsBridge | null {
  const desktop = (window as unknown as { branchDesktop?: { permissions?: OsPermissionsBridge } }).branchDesktop;
  return desktop?.permissions ?? null;
}

/** Reads the statuses once and again after each Allow; `error` says why a read, Allow or open failed. */
export function useOsPermissions() {
  const [bridge] = useState(osPermissions);
  const [state, setState] = useState<OsPermissionsState | null>(null);
  const [busy, setBusy] = useState<OsPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    // Coming back from System Settings: read again, since the owner may have changed one there.
    const refresh = () => { bridge.get().then((s) => { if (live) setState(s); }, (e: unknown) => { if (live) fail(e); }); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { live = false; window.removeEventListener("focus", refresh); };
  }, [bridge]);
  const request = useCallback(async (name: OsPermission) => {
    if (!bridge) return;
    setBusy(name);
    setError(null);
    try { setState(await bridge.request(name)); } catch (e) { fail(e); } finally { setBusy(null); }
  }, [bridge]);
  const open = useCallback(async (name: OsPermission) => {
    if (!bridge) return;
    setError(null);
    try { await bridge.open(name); } catch (e) { fail(e); }
  }, [bridge]);
  return { bridge, state, busy, error, request, open };
}

/** Why the window's own microphone can't be used, in plain words: the device is missing, or this browser has none. */
export type MicNote = "no-device" | "no-browser-mic";

/**
 * The microphone as this window sees it, where the app can't read it from the system (Linux, or a plain browser):
 * Chromium's own permission. null when this browser has no microphone API at all.
 */
export async function readWindowMic(): Promise<OsPermissionStatus | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    const answer = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return answer.state === "granted" ? "allowed" : answer.state === "denied" ? "denied" : "not-asked";
  } catch {
    return "not-asked";
  }
}

/** Asks for the microphone through the window (the browser's or the desktop's own prompt), then lets it go at once. */
export async function askWindowMic(): Promise<{ status: OsPermissionStatus; note: MicNote | null }> {
  if (!navigator.mediaDevices?.getUserMedia) return { status: "unknown", note: "no-browser-mic" };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return { status: "allowed", note: null };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "NotFoundError" || name === "OverconstrainedError") return { status: "not-asked", note: "no-device" };
    if (name === "NotAllowedError" || name === "SecurityError") return { status: "denied", note: null };
    throw e;
  }
}

/**
 * The Microphone row where the system can't be read: the window's own permission, one Allow… that asks, and a plain
 * note when there is no microphone. `active` is false where the desktop app reads the system itself (macOS, Windows).
 */
export function useWindowMic(active: boolean) {
  const [status, setStatus] = useState<OsPermissionStatus | null>(null);
  const [note, setNote] = useState<MicNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void readWindowMic().then((s) => { if (!live) return; setStatus(s); if (s === null) setNote("no-browser-mic"); });
    return () => { live = false; };
  }, [active]);
  const request = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { const r = await askWindowMic(); setStatus(r.status); setNote(r.note); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, []);
  return { active, status, note, busy, error, request };
}
