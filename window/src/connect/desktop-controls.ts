// The desktop app's controls (desktop/src/desktop-controls.ts through the preload's branchDesktop.controls).
// In a plain browser there is no bridge, so the controls stay greyed with why.
// TODO(desktop-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useState } from "react";

export type DesktopControlsState = {
  keepWorking: boolean; keepAwake: boolean; trayUsage: boolean; autoApplyUpdates: boolean; startWithWindows: boolean; branchOnPath: boolean;
  /** Older desktop apps leave it out. */
  agentControl?: boolean;
  /** Keep awake while Trunks work on battery too (Private #454 D); older desktop apps leave it out. */
  keepAwakeOnBattery?: boolean;
  /** Linux with the engine service only: keep working when nobody is signed in (systemd linger). */
  keepWorkingSignedOut?: boolean;
  /** One-time lines the app has for a control, such as why the engine runs inside the app on this computer. */
  notes?: Partial<Record<string, string>>;
};
/** The switches: every key whose value is on or off. */
export type DesktopControlName = { [K in keyof DesktopControlsState]-?: DesktopControlsState[K] extends boolean | undefined ? K : never }[keyof DesktopControlsState];
export type DesktopControlsBridge = {
  get(): Promise<DesktopControlsState>;
  set(name: DesktopControlName, on: boolean): Promise<DesktopControlsState>;
  openDownload(id: string): Promise<void>;
  setTrayUsage(left: number | null): void;
  onOpenUsage(listener: () => void): () => void;
};

/** Sent on window with the new state after any control changes, so every row showing a control follows it. */
export const DESKTOP_CONTROLS_CHANGED = "branch:desktop-controls";
const CHANGED = DESKTOP_CONTROLS_CHANGED;
export const IN_BROWSER = "This is done by the Branch app on your computer; open Branch there to change it.";
export const NEEDS_NEWER_APP = "Needs a newer Branch app on this computer.";

/** The bridge, or why there is none. */
export function desktopControls(): { bridge: DesktopControlsBridge } | { off: string } {
  const desktop = (window as unknown as { branchDesktop?: { controls?: DesktopControlsBridge } }).branchDesktop;
  if (!desktop) return { off: IN_BROWSER };
  return desktop.controls ? { bridge: desktop.controls } : { off: NEEDS_NEWER_APP };
}

/** Reads the controls once and changes one at a time; `off` says why they are greyed, `error` why a change failed. */
export function useDesktopControls() {
  const [found] = useState(desktopControls);
  const bridge = "bridge" in found ? found.bridge : undefined;
  const [state, setState] = useState<DesktopControlsState | null>(null);
  const [busy, setBusy] = useState<DesktopControlName | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    bridge.get().then((s) => { if (live) setState(s); }, (e: unknown) => { if (live) setError(String(e instanceof Error ? e.message : e)); });
    // Every row showing a control follows a change made from another row.
    const follow = (e: Event) => setState((e as CustomEvent<DesktopControlsState>).detail);
    window.addEventListener(CHANGED, follow);
    return () => { live = false; window.removeEventListener(CHANGED, follow); };
  }, [bridge]);
  /** Resolves true when the app saved the change. */
  const set = useCallback(async (name: DesktopControlName, on: boolean): Promise<boolean> => {
    if (!bridge) return false;
    setBusy(name);
    setError(null);
    try {
      const next = await bridge.set(name, on);
      setState(next);
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: next }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, [bridge]);
  return { state, set, busy, error, off: "off" in found ? found.off : state ? undefined : error ?? undefined, bridge };
}
