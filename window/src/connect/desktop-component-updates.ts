import { useEffect, useState } from "react";
import { dismiss, getToasts, notify, subscribeToasts } from "../shell/notify";
import type { WindowEngine } from "./engine";

export type ComponentUpdateStatus = {
  phase: "unchecked" | "checking" | "available" | "current" | "staging" | "staged" | "error";
  currentVersion: string | null; latestVersion: string | null; pendingVersion: string | null;
  checkedAt: number | null; error: string | null;
};
export type ComponentUpdates = {
  status(): Promise<ComponentUpdateStatus>;
  check(): Promise<ComponentUpdateStatus>;
  stage(): Promise<ComponentUpdateStatus>;
  /** Older desktop builds have no Install now; the page hides the button without it. */
  install?: () => void;
  /** Whether the last update can still be undone, with its version line; older desktop builds lack it and offer no Undo here. */
  undoAvailability?: () => Promise<UndoAvailability>;
  undo?: () => void;
};
/** From the desktop: `until` is the end of the previous engine's probation (confirmation + 3 days, Private #983);
 *  `version` and `installedAt` are the installed release and when it was confirmed, for the version line. */
export type UndoAvailability = { available: boolean; until: number | null; removed: boolean; version?: string | null; installedAt?: number | null };
/** Undo is offered only while it can still run: never past the probation's end or after the previous engine is pruned. */
export function undoOpen(value: UndoAvailability | null, now = Date.now()): boolean {
  return Boolean(value?.available && (value.until == null || now < value.until));
}
/** The desktop update bar's states, published by the preload as this window event (same wording as the bar). */
export type EngineUpdateState = "ready" | "auto-wait" | "preparing" | "restarting" | "updating" | "updated" | "kept" | "failed";
export type EngineUpdateEvent = { state: EngineUpdateState; message?: string };
export const ENGINE_UPDATE_EVENT = "branch:update-state";
export type AppliedUpdateNotice = { version: string; canUndo: boolean; expiresAt: number };
export type UpdateNoticeEvent = "shown" | "dismissed" | "expired" | "undo";
/** Preview T0 (`updT5` in design/spec-v23/index.html): a normal toast after an in-place update. */
export const UPDATED_IN_PLACE = "Updated in place. Nothing restarted.";
/** The R1 toast when the owner's or an auto update was postponed (Private #1047: update toasts live in the window's toast layer). */
export const UPDATE_POSTPONED = "Update postponed; Branch kept the current version";
/** Preview T0 (`updT5`): wait this long and try again while setup (`.ob-main, .ob9`) is on screen. */
export const UPDATE_TOAST_SETUP_WAIT_MS = 5000;
type Desktop = { gatewayUrl?: string; getGatewayUrl?: () => string; componentUpdates?: ComponentUpdates; unavailableReason?: string;
  onAutoApplyProbe?: (listener: () => Promise<{ pendingApprovals: number; streaming: boolean; unsavedDraftFiles: boolean; workingTrunks?: number }>) => () => void;
  /** The tray's Pause all work (Private #454 C); older desktop builds lack it. */
  onPauseAll?: (listener: () => void) => () => void;
  /** A closed-window "done" notice for a paired phone (Private #454 D); older desktop builds lack it. */
  onPhonePush?: (listener: (notice: { title: string; body: string }) => void) => () => void;
  onUpdateApplied?: (listener: (notice: AppliedUpdateNotice) => void) => () => void;
  onUpdateUndone?: (listener: () => void) => () => void;
  reportUpdateNotice?: (event: UpdateNoticeEvent, notice: AppliedUpdateNotice) => void };

/** Preload-time buffer: keep the last applied/undone event and replay it when a subscriber attaches. Dedupes by version. */
export function createUpdateNoticeHub(): {
  pushApplied: (notice: AppliedUpdateNotice) => void;
  pushUndone: () => void;
  onUpdateApplied: (listener: (notice: AppliedUpdateNotice) => void) => () => void;
  onUpdateUndone: (listener: () => void) => () => void;
} {
  let lastApplied: AppliedUpdateNotice | undefined;
  let lastUndone = false;
  let applied: ((notice: AppliedUpdateNotice) => void) | undefined;
  let undone: (() => void) | undefined;
  let deliveredVersion: string | undefined;
  const deliver = (notice: AppliedUpdateNotice) => {
    if (!applied || deliveredVersion === notice.version) return;
    deliveredVersion = notice.version;
    applied(notice);
  };
  return {
    pushApplied(notice) {
      lastApplied = notice;
      lastUndone = false;
      deliver(notice);
    },
    pushUndone() {
      lastUndone = true;
      lastApplied = undefined;
      deliveredVersion = undefined;
      undone?.();
    },
    onUpdateApplied(listener) {
      applied = listener;
      if (lastApplied) deliver(lastApplied);
      return () => { if (applied === listener) applied = undefined; };
    },
    onUpdateUndone(listener) {
      undone = listener;
      if (lastUndone) listener();
      return () => { if (undone === listener) undone = undefined; };
    },
  };
}
/** An older Branch Agent app has no Check now bridge, but it still checks every hour and stages updates itself. */
export const MANUAL_UPDATE_UNSUPPORTED = "Update the Branch app to check by hand.";
export const DESKTOP_CHECKS_HOURLY = "Branch checks for updates every 10 minutes and lets you know when one is ready to apply.";
export const installOnComputer = (name: string) => `Ready to install on ${name || "the computer running Branch"}: open Branch there to install it.`;
const TARGET_UNVERIFIED = "Branch is connected to a different computer’s engine. Reconnect to this computer to check for updates.";
export function componentDesktop(gatewayUrl?: string): Desktop | undefined {
  const desktop = (window as unknown as { branchDesktop?: Desktop }).branchDesktop;
  if (!desktop) return undefined;
  const localUrl = desktop.getGatewayUrl?.() ?? desktop.gatewayUrl;
  if (!gatewayUrl || !localUrl) return { unavailableReason: TARGET_UNVERIFIED };
  try {
    const target = new URL(gatewayUrl); const local = new URL(localUrl);
    if (target.protocol !== "ws:" && target.protocol !== "wss:") return { unavailableReason: TARGET_UNVERIFIED };
    return target.href === local.href ? desktop : undefined;
  } catch { return { unavailableReason: TARGET_UNVERIFIED }; }
}

/** Native calls cannot fall through into a gateway's checkout or package updater. */
export async function stageWindowUpdate(engine: Pick<WindowEngine, "request" | "gatewayUrl">): Promise<unknown> {
  const desktop = componentDesktop(engine.gatewayUrl);
  if (!desktop) return engine.request("update.run", {});
  if (!desktop.componentUpdates) throw new Error(desktop.unavailableReason ?? MANUAL_UPDATE_UNSUPPORTED);
  const status = await desktop.componentUpdates.stage();
  if (status.error) throw new Error(status.error);
  return status;
}

/** Read-only cadence; no background manifest requests or gateway mutations. */
export function useDesktopComponentStatus(gatewayUrl?: string): {
  status: ComponentUpdateStatus | null;
  error: string | null;
  setStatus: (value: ComponentUpdateStatus) => void;
} {
  const bridge = componentDesktop(gatewayUrl)?.componentUpdates;
  const [status, setStatus] = useState<ComponentUpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let live = true; let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try { const value = await bridge.status(); if (live) { setStatus(value); setError(value.error); } }
      catch (error) { if (live) setError(error instanceof Error ? error.message : String(error)); }
      finally { busy = false; }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => { live = false; clearInterval(timer); };
  }, [bridge]);
  return { status, error, setStatus: value => { setStatus(value); setError(value.error); } };
}

/** The last update's Undo, read from the desktop and re-read every minute (so Undo goes once its probation ends). */
export function useDesktopUndoAvailability(gatewayUrl?: string): { value: UndoAvailability | null; reload: () => void } {
  const bridge = componentDesktop(gatewayUrl)?.componentUpdates;
  const [value, setValue] = useState<UndoAvailability | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const read = bridge?.undoAvailability;
    if (!read) return;
    let live = true;
    void read().then(next => { if (live) setValue(next); }, () => { if (live) setValue(null); });
    const timer = setTimeout(() => setTick(n => n + 1), 60_000);
    return () => { live = false; clearTimeout(timer); };
  }, [bridge, tick]);
  return { value, reload: () => setTick(n => n + 1) };
}

function desktopBridge(): Desktop | undefined {
  return (window as unknown as { branchDesktop?: Desktop }).branchDesktop;
}

function reportUpdateNotice(event: UpdateNoticeEvent, notice: AppliedUpdateNotice): void {
  desktopBridge()?.reportUpdateNotice?.(event, notice);
}

/** Preview T0: `if (document.querySelector('.ob-main, .ob9')) return setTimeout(updT5, 5000)`. */
export function setupBlocksUpdateToast(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(".ob-main, .ob9"));
}

/** Show the preview in-place toast through `notify`, after setup closes, and log shown/dismissed. */
export function showAppliedUpdateToast(notice: AppliedUpdateNotice): void {
  if (!notice.version) return;
  const show = () => {
    if (notice.expiresAt <= Date.now()) {
      reportUpdateNotice("expired", notice);
      return;
    }
    if (setupBlocksUpdateToast()) {
      window.setTimeout(show, UPDATE_TOAST_SETUP_WAIT_MS);
      return;
    }
    const id = notify(UPDATED_IN_PLACE);
    reportUpdateNotice("shown", notice);
    const unsub = subscribeToasts(() => {
      if (getToasts().some((toast) => toast.id === id)) return;
      unsub();
      reportUpdateNotice("dismissed", notice);
    });
  };
  show();
}

function dismissInPlaceToast(): void {
  for (const toast of getToasts()) {
    if (toast.text === UPDATED_IN_PLACE) dismiss(toast.id);
  }
}

/** Toasts (always mounted) subscribe here. Preload buffers the last event so a late subscribe still sees it. */
export function useDesktopAppliedUpdateNotice(): void {
  useEffect(() => {
    const desktop = desktopBridge();
    const stopApplied = desktop?.onUpdateApplied?.(showAppliedUpdateToast);
    const stopUndone = desktop?.onUpdateUndone?.(() => {
      dismissInPlaceToast();
    });
    const onEngineState = (event: Event) => {
      if ((event as CustomEvent<EngineUpdateEvent>).detail?.state === "kept") notify(UPDATE_POSTPONED);
    };
    window.addEventListener(ENGINE_UPDATE_EVENT, onEngineState);
    return () => { stopApplied?.(); stopUndone?.(); window.removeEventListener(ENGINE_UPDATE_EVENT, onEngineState); };
  }, []);
}
