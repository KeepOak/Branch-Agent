// R1-11 update button and avatar-menu banner (HANDOFF R1-11 "Update UI"): one view model for both, from the desktop
// component updater or, outside the desktop app, the engine's update.status. Nothing here makes up a number: neither
// updater reports a percentage, so the ring spins and the line says only what is happening.
import type { ComponentUpdateStatus, EngineUpdateEvent } from "../../connect/desktop-component-updates";
import { isNewerBranchVersion, versionParts } from "../../connect/branch-version";

export type UpdateView =
  | { kind: "none" }
  /** A newer verified release exists. Desktop: Install downloads and checks it. Engine: Install runs update.run. */
  | { kind: "offer"; version: string }
  | { kind: "installing"; version: string; step: string | null }
  /** Desktop only: downloaded and checked; the engine restarts on the new version when asked. */
  | { kind: "restart"; version: string; note: string | null; canRestart: boolean }
  | { kind: "restarting"; version: string }
  | { kind: "done"; version: string }
  | { kind: "failed"; version: string; message: string };

/** update.runs phases in the person's words (the same words as Settings › Updates & about). */
export const RUN_STEP: Record<string, string> = {
  requested: "Getting ready", staging: "Downloading", validating: "Checking it", repairing: "Repairing",
  activating: "Installing", restarting: "Restarting", verifying: "Checking settings and data",
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The desktop updater (desktop/src/main.ts restartEngine): stage() downloads and checks; install() lets running work
 * finish, then swaps the engine process. The window stays open, but the engine does restart, so the action says
 * "Restart Branch" rather than the preview's "Relaunch … Nothing restarted" (HANDOFF §5 item 14).
 */
export function desktopUpdateView(input: {
  status: ComponentUpdateStatus | null; current: string; bar: EngineUpdateEvent | null;
  staging: boolean; restartRequested: boolean; canRestart: boolean; error: string | null;
}): UpdateView {
  const { status, current, bar } = input;
  const pending = status?.pendingVersion ?? null, latest = status?.latestVersion ?? null;
  const version = (status?.phase === "staged" ? pending ?? latest : latest ?? pending) ?? "";
  if (bar?.state === "updated" && (input.restartRequested || version)) return { kind: "done", version: version || current };
  if (!version || !isNewerBranchVersion(version, current)) return { kind: "none" };
  if (bar?.state === "failed") return { kind: "failed", version, message: bar.message || "The update didn’t finish. Branch kept the current version." };
  if (input.error) return { kind: "failed", version, message: input.error };
  if (input.restartRequested || bar?.state === "preparing" || bar?.state === "restarting" || bar?.state === "updating") return { kind: "restarting", version };
  if (input.staging || status?.phase === "staging") return { kind: "installing", version, step: "Downloading and checking" };
  if (status?.phase === "staged") return { kind: "restart", version, canRestart: input.canRestart,
    note: bar?.state === "kept" ? "Branch kept the current version. Try again when your work is done." : null };
  if (status?.phase === "available") return { kind: "offer", version };
  return { kind: "none" };
}

/** Outside the desktop app: update.status { updateAvailable, activeRun, lastRun } (engine UpdateRunRecord); update.run does every step. */
export function engineUpdateView(input: { status: unknown; current: string; started: boolean; error: string | null; doneVersion: string | null }): UpdateView {
  if (input.doneVersion) return { kind: "done", version: input.doneVersion };
  const status = rec(input.status), available = rec(status.updateAvailable), active = rec(status.activeRun), last = rec(status.lastRun);
  const version = str(available.latestVersion) || str(rec(active.target).version);
  if (!version || (input.current && !isNewerBranchVersion(version, input.current) && !str(active.runId))) return { kind: "none" };
  if (input.error) return { kind: "failed", version, message: input.error };
  if (str(active.runId) || input.started) return { kind: "installing", version, step: RUN_STEP[str(active.phase)] ?? null };
  if (last.status === "failed" || last.status === "rolled-back") return { kind: "failed", version, message: str(last.reason) || "The last update didn’t finish. Branch kept the current version." };
  return { kind: "offer", version };
}

/** The words for one view: the button's tooltip and name, its visible label, and the banner's line and pill. */
export function updateCopy(view: UpdateView): { tip: string; label: string | null; banner: string; action: string | null } {
  if (view.kind === "none") return { tip: "", label: null, banner: "", action: null };
  const short = versionParts(view.version).short;
  switch (view.kind) {
    case "offer": return { tip: `Update to ${short}`, label: null, banner: `Update to ${short}`, action: "Install" };
    case "installing": return { tip: `Installing ${short}…${view.step ? ` ${view.step}.` : ""}`, label: null, banner: `Installing ${short}…`, action: null };
    case "restart": return { tip: view.note ?? `Restart Branch to finish updating to ${short}. Running work gets up to about 6 minutes to finish first.`,
      label: "Restart Branch", banner: `${short} is ready`, action: "Restart Branch" };
    case "restarting": return { tip: `Restarting Branch on ${short}…`, label: null, banner: `Restarting Branch on ${short}…`, action: null };
    case "done": return { tip: `Updated to ${short}`, label: `Updated to ${short}`, banner: `Updated to ${short}`, action: null };
    case "failed": return { tip: view.message, label: null, banner: view.message, action: "Try again" };
  }
}
