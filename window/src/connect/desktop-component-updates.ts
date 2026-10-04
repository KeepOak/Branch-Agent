import { useEffect, useState } from "react";
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
type Desktop = { gatewayUrl?: string; componentUpdates?: ComponentUpdates; unavailableReason?: string };
/** An older Branch Agent app has no Check now bridge, but it still checks every hour and stages updates itself. */
export const MANUAL_UPDATE_UNSUPPORTED = "Checking by hand needs a newer Branch Agent app.";
export const DESKTOP_CHECKS_HOURLY = "Branch checks for updates every hour and lets you know when one is ready to restart into.";
const TARGET_UNVERIFIED = "Branch is connected to a different computer’s engine. Reconnect to this computer to check for updates.";
export function componentDesktop(gatewayUrl?: string): Desktop | undefined {
  const desktop = (window as unknown as { branchDesktop?: Desktop }).branchDesktop;
  if (!desktop) return undefined;
  if (!gatewayUrl || !desktop.gatewayUrl) return { unavailableReason: TARGET_UNVERIFIED };
  try {
    const target = new URL(gatewayUrl); const local = new URL(desktop.gatewayUrl);
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
