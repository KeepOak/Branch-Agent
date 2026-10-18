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
