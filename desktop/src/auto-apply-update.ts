/** Holds a staged release until the renderer's gateway snapshot stays idle long enough. */
export interface UpdateActivity {
  activeRuns: number;
  pendingApprovals: number;
  streaming: boolean;
  unsavedDraftFiles: boolean;
}

export const AUTO_APPLY_POLL_MS = 30_000;
export const AUTO_APPLY_IDLE_MS = 60_000;
export const AUTO_APPLY_RETRY_MS = 60_000;

export function createAutoApplyUpdate(options: {
  pendingVersion(): Promise<string | null>;
  enabled(): boolean;
  activity(): Promise<UpdateActivity>;
  restart(version: string, handoffOnly: boolean): Promise<void>;
  /** A flagged standby can take over while the predecessor finishes admitted work. */
  seamlessHandoff?(): boolean;
  onApplied?(version: string): void | Promise<void>;
  onFailure?(version: string): void;
  log(line: string): void;
  now?: () => number;
  interval?: (tick: () => void, ms: number) => ReturnType<typeof setInterval>;
  clear?: (timer: ReturnType<typeof setInterval>) => void;
}) {
  let idleSince: number | undefined;
  let heldVersion: string | undefined;
  let checking = false;
  let restarting = false;
  let appliedVersion: string | undefined;
  let retryAfter = 0;
  let failedVersion: string | undefined;
  let stopped = false;
  let lastDecision = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  const now = options.now ?? Date.now;
  const decision = (line: string) => {
    if (line !== lastDecision) { options.log(`auto-apply: ${line}`); lastDecision = line; }
  };
  const tick = async () => {
    if (checking || restarting || stopped) return;
    checking = true;
    try {
      const version = await options.pendingVersion();
      if (version !== heldVersion) { idleSince = undefined; retryAfter = 0; failedVersion = undefined; appliedVersion = undefined; heldVersion = version ?? undefined; }
      if (!version || !options.enabled() || appliedVersion === version) {
        idleSince = undefined;
        if (version) decision("off; awaiting Restart");
        return;
      }
      if (now() < retryAfter) return;
      if (options.seamlessHandoff?.() && failedVersion !== version) {
        restarting = true;
        decision(`prepared handoff for ${version}`);
        try { await options.restart(version, true); await options.onApplied?.(version); appliedVersion = version; restarting = false; }
        catch (error) {
          restarting = false;
          retryAfter = now() + AUTO_APPLY_RETRY_MS;
          if (failedVersion !== version) { failedVersion = version; options.onFailure?.(version); }
          throw error;
        }
        return;
      }
      const activity = await options.activity();
      if (activity.activeRuns || activity.pendingApprovals || activity.streaming || activity.unsavedDraftFiles) {
        idleSince = undefined;
        decision(`waiting for ${activity.activeRuns} active runs, ${activity.pendingApprovals} approvals${activity.streaming ? ", streaming reply" : ""}${activity.unsavedDraftFiles ? ", unsaved draft files" : ""}`);
        return;
      }
      idleSince ??= now();
      if (now() - idleSince < AUTO_APPLY_IDLE_MS) {
        decision(`idle hold for ${version}`);
        return;
      }
      // A fresh gateway snapshot closes the gap after the hold timer and before relaunch.
      const final = await options.activity();
      if (final.activeRuns || final.pendingApprovals || final.streaming || final.unsavedDraftFiles || !options.enabled()) {
        idleSince = undefined;
        decision(`waiting for ${final.activeRuns} active runs, ${final.pendingApprovals} approvals`);
        return;
      }
      restarting = true;
      decision(`restarting for ${version}`);
      try { await options.restart(version, false); await options.onApplied?.(version); appliedVersion = version; restarting = false; }
      catch (error) {
        restarting = false;
        retryAfter = now() + AUTO_APPLY_RETRY_MS;
        if (failedVersion !== version) { failedVersion = version; options.onFailure?.(version); }
        throw error;
      }
    } catch (error) {
      idleSince = undefined;
      decision(`waiting; activity check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { checking = false; }
  };
  return {
    tick,
    start() {
      if (timer) return;
      stopped = false;
      void tick();
      timer = (options.interval ?? setInterval)(() => void tick(), AUTO_APPLY_POLL_MS);
    },
    stop() {
      stopped = true;
      if (timer) (options.clear ?? clearInterval)(timer);
      timer = undefined;
    },
  };
}
