/** Holds a staged release until the renderer's gateway snapshot stays idle long enough. */
export interface UpdateActivity {
  activeRuns: number;
  pendingApprovals: number;
  streaming: boolean;
  unsavedDraftFiles: boolean;
  /**
   * How long ago (ms) the owner last typed or moved the pointer while a Branch window had focus; absent when no Branch
   * window has focus. The stop/start restart never starts while the owner is using Branch: it would cut off the
   * message being written or sent and show the window offline mid-chat.
   */
  ownerActiveMsAgo?: number;
}

/** What an applied update did: a handoff or candidate swap kept the engine serving; a drain stopped and started it. */
export interface UpdateOutcome {
  restarted: boolean;
}

export const AUTO_APPLY_POLL_MS = 30_000;
export const AUTO_APPLY_IDLE_MS = 60_000;
export const AUTO_APPLY_RETRY_MS = 60_000;
/** The owner counts as away from Branch after this long without input in a focused Branch window. */
export const AUTO_APPLY_OWNER_AWAY_MS = 120_000;

/** Why the stop/start restart has to wait, or undefined when it may run now. */
export function restartBlocker(activity: UpdateActivity): string | undefined {
  if (activity.activeRuns || activity.pendingApprovals || activity.streaming || activity.unsavedDraftFiles) {
    return `waiting for ${activity.activeRuns} active runs, ${activity.pendingApprovals} approvals${activity.streaming ? ", streaming reply" : ""}${activity.unsavedDraftFiles ? ", unsaved draft files" : ""}`;
  }
  if (activity.ownerActiveMsAgo !== undefined && activity.ownerActiveMsAgo < AUTO_APPLY_OWNER_AWAY_MS) return "waiting; the owner is using Branch";
  return undefined;
}

export function createAutoApplyUpdate(options: {
  pendingVersion(): Promise<string | null>;
  enabled(): boolean;
  activity(): Promise<UpdateActivity>;
  restart(version: string, handoffOnly: boolean): Promise<UpdateOutcome | void>;
  /** A flagged standby can take over while the predecessor finishes admitted work. */
  seamlessHandoff?(): boolean;
  /** Applied with nothing restarted: the only case for the "Updated in place. Nothing restarted." notice. */
  onApplied?(version: string): void | Promise<void>;
  /** Applied by stopping and starting the engine (no standby, as on a low-memory Mac). */
  onRestarted?(version: string): void | Promise<void>;
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
  let notifiedVersion: string | undefined;
  let stopped = false;
  let lastDecision = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  const now = options.now ?? Date.now;
  const decision = (line: string) => {
    if (line !== lastDecision) { options.log(`auto-apply: ${line}`); lastDecision = line; }
  };
  // A restart callback without an outcome (an older caller) restarted unless it was the handoff-only attempt.
  const applied = async (version: string, outcome: UpdateOutcome | void, handoffOnly: boolean) => {
    if (outcome?.restarted ?? !handoffOnly) await options.onRestarted?.(version);
    else await options.onApplied?.(version);
  };
  const tick = async () => {
    if (checking || restarting || stopped) return;
    checking = true;
    try {
      const version = await options.pendingVersion();
      if (version !== heldVersion) {
        idleSince = undefined; retryAfter = 0; failedVersion = undefined; notifiedVersion = undefined;
        appliedVersion = undefined; heldVersion = version ?? undefined;
      }
      if (!version || !options.enabled() || appliedVersion === version) {
        idleSince = undefined;
        if (version) decision("off; awaiting Restart");
        return;
      }
      if (now() < retryAfter) return;
      if (options.seamlessHandoff?.() && failedVersion !== version) {
        restarting = true;
        decision(`prepared handoff for ${version}`);
        try {
          await applied(version, await options.restart(version, true), true);
          appliedVersion = version;
          restarting = false;
          return;
        } catch {
          // No standby (typical on a low-memory Mac): drain after idle, without a toast or back-off.
          restarting = false;
          failedVersion = version;
          decision(`handoff unavailable; falling back to idle drain for ${version}`);
        }
      }
      const waiting = restartBlocker(await options.activity());
      if (waiting) {
        idleSince = undefined;
        decision(waiting);
        return;
      }
      idleSince ??= now();
      if (now() - idleSince < AUTO_APPLY_IDLE_MS) {
        decision(`idle hold for ${version}`);
        return;
      }
      // A fresh gateway snapshot closes the gap after the hold timer and before relaunch.
      const finalWaiting = restartBlocker(await options.activity());
      if (finalWaiting || !options.enabled()) {
        idleSince = undefined;
        decision(finalWaiting ?? "off; awaiting Restart");
        return;
      }
      restarting = true;
      decision(`restarting for ${version}`);
      try { await applied(version, await options.restart(version, false), false); appliedVersion = version; restarting = false; }
      catch (error) {
        restarting = false;
        retryAfter = now() + AUTO_APPLY_RETRY_MS;
        if (notifiedVersion !== version) { notifiedVersion = version; options.onFailure?.(version); }
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
