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
};
export type AppliedUpdateNotice = { version: string; canUndo: boolean; expiresAt: number };
export type UpdateNoticeEvent = "shown" | "dismissed" | "expired" | "undo";
/** Preview T0 (`updT5` in design/spec-v23/index.html): a normal toast after an in-place update. */
export const UPDATED_IN_PLACE = "Updated in place. Nothing restarted.";
/** Preview T0 (`updT5`): wait this long and try again while setup (`.ob-main, .ob9`) is on screen. */
export const UPDATE_TOAST_SETUP_WAIT_MS = 5000;
type Desktop = { gatewayUrl?: string; getGatewayUrl?: () => string; componentUpdates?: ComponentUpdates; unavailableReason?: string;
  onAutoApplyProbe?: (listener: () => Promise<{ pendingApprovals: number; streaming: boolean; unsavedDraftFiles: boolean }>) => () => void;
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
    return () => { stopApplied?.(); stopUndone?.(); };
  }, []);
}
