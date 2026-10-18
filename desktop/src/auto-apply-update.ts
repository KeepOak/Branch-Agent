import { statfsSync } from "node:fs";

/** Holds a staged release until the renderer's gateway snapshot stays idle long enough. */
export interface UpdateActivity {
  activeRuns: number;
  pendingApprovals: number;
  streaming: boolean;
  unsavedDraftFiles: boolean;
}

export const AUTO_APPLY_POLL_MS = 30_000;
/** A gap: no turn streams, no approval waits and no draft is unsaved for this long (Private #1047). */
export const AUTO_APPLY_GAP_MS = 30_000;
export const AUTO_APPLY_RETRY_MS = 60_000;
/** An update pending this long applies at the next gap, without waiting for the Trunk-work batch (Private #1047). */
export const AUTO_APPLY_PENDING_CAP_MS = 6 * 60 * 60_000;

/**
 * Private #951 cadence: on a machine running Trunk work, updates are batched. One applies at most this often, and only
 * once the machine is idle, unless the release is a security fix.
 */
export const TRUNK_UPDATE_MIN_INTERVAL_MS = 60 * 60_000;
/** A machine whose engine had a run in flight this recently counts as running Trunk work. */
export const TRUNK_WORK_WINDOW_MS = 24 * 60 * 60_000;
/** With no update pending, the engine's activity is sampled this often to notice Trunk work. */
export const TRUNK_WORK_SAMPLE_MS = 5 * 60_000;
/** Private #951 health rule: no update starts below these free fractions of disk and RAM, security fixes included. */
export const UPDATE_MIN_FREE_DISK = 0.10;
export const UPDATE_MIN_FREE_MEMORY = 0.20;

/** Free fractions (0 to 1) of the disk holding Branch's data and of the machine's RAM. */
export interface UpdateHealth {
  diskFree: number;
  memoryFree: number;
}

/**
 * This host's free disk (the volume holding Branch's data) and free RAM as fractions. Tests pin either reading with
 * BRANCH_DESKTOP_UPDATE_FREE_DISK or BRANCH_DESKTOP_UPDATE_FREE_MEMORY (a fraction from 0 to 1).
 */
export function readUpdateHealth(dataDir: string, availableMemoryBytes: number, totalMemoryBytes: number, env: NodeJS.ProcessEnv = process.env): UpdateHealth {
  const pinned = (value: string | undefined): number | undefined => {
    const fraction = Number(value);
    return value && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : undefined;
  };
  let diskFree = pinned(env.BRANCH_DESKTOP_UPDATE_FREE_DISK);
  if (diskFree === undefined) {
    const disk = statfsSync(dataDir);
    diskFree = disk.blocks > 0 ? disk.bavail / disk.blocks : 1;
  }
  const memoryFree = pinned(env.BRANCH_DESKTOP_UPDATE_FREE_MEMORY) ?? (totalMemoryBytes > 0 ? availableMemoryBytes / totalMemoryBytes : 1);
  return { diskFree, memoryFree };
}

/** Why an update must not start on this host now, or undefined when it may. */
export function updateHealthRefusal(health: UpdateHealth): string | undefined {
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
  if (health.diskFree < UPDATE_MIN_FREE_DISK) return `low disk: ${percent(health.diskFree)} free, under ${percent(UPDATE_MIN_FREE_DISK)}`;
  if (health.memoryFree < UPDATE_MIN_FREE_MEMORY) return `low memory: ${percent(health.memoryFree)} free, under ${percent(UPDATE_MIN_FREE_MEMORY)}`;
  return undefined;
}

export function createAutoApplyUpdate(options: {
  pendingVersion(): Promise<string | null>;
  enabled(): boolean;
  activity(): Promise<UpdateActivity>;
  /** `drain`: stop the old engine by its drain (it refuses new work and finishes its runs), not only while idle. */
  restart(version: string, handoffOnly: boolean, drain?: boolean): Promise<void>;
  /** A flagged standby can take over while the predecessor finishes admitted work. */
  seamlessHandoff?(): boolean;
  /** Free disk and RAM now; an unhealthy host never starts an update (Private #951). */
  health?(): UpdateHealth | Promise<UpdateHealth>;
  /**
   * Applying this version quits and relaunches the app (a staged desktop shell, Private #1054 M5). It has no standby
   * and no drain: it waits for a gap with no run in flight, even past the pending cap, and keeps the Trunk-work batch.
   */
  relaunchesApp?(version: string): boolean | Promise<boolean>;
  /** A security fix skips the Trunk-work batching, never the health rule. */
  securityFix?(version: string): boolean | Promise<boolean>;
  /** Pins whether this machine runs Trunk work; by default it is any engine run seen in TRUNK_WORK_WINDOW_MS. */
  trunkWork?(): boolean;
  /** The engine's runs in flight, read now and then while nothing is pending (engine only, never the window). */
  activeRuns?(): Promise<number>;
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
  let notifiedVersion: string | undefined;
  let stopped = false;
  let lastDecision = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  /** When an update last applied here, and when the engine last had a run in flight. */
  let lastAppliedAt: number | undefined;
  let lastRunSeenAt: number | undefined;
  let lastSampleAt: number | undefined;
  /** When the held version was first seen pending; the cap counts from here. */
  let pendingSince: number | undefined;
  /** The version whose pending-over-cap line is already in the log, so each tick does not repeat it. */
  let cappedNoted: string | undefined;
  const now = options.now ?? Date.now;
  const decision = (line: string) => {
    if (line !== lastDecision) { options.log(`auto-apply: ${line}`); lastDecision = line; }
  };
  /** A turn is streaming, an approval waits, or a draft is unsaved: the gap rule holds the update off. */
  const turnWaiting = (activity: UpdateActivity) => Boolean(activity.streaming || activity.pendingApprovals || activity.unsavedDraftFiles);
  /** Every activity read notes a run in flight, which marks this machine as running Trunk work. */
  const readActivity = async (): Promise<UpdateActivity> => {
    const activity = await options.activity();
    lastSampleAt = now();
    if (activity.activeRuns > 0) lastRunSeenAt = lastSampleAt;
    return activity;
  };
  /** Notes runs in flight from the engine alone when it can, so a window that is not ready never blocks the update. */
  const noteRuns = async (): Promise<void> => {
    if (options.trunkWork) return;
    if (!options.activeRuns) { await readActivity(); return; }
    const runs = await options.activeRuns();
    lastSampleAt = now();
    if (runs > 0) lastRunSeenAt = lastSampleAt;
  };
  const runningTrunkWork = () => options.trunkWork?.() ?? (lastRunSeenAt !== undefined && now() - lastRunSeenAt < TRUNK_WORK_WINDOW_MS);
  const applied = async (version: string) => {
    lastAppliedAt = now();
    await options.onApplied?.(version);
    appliedVersion = version;
  };
  const tick = async () => {
    if (checking || restarting || stopped) return;
    checking = true;
    try {
      const version = await options.pendingVersion();
      if (version !== heldVersion) {
        idleSince = undefined; retryAfter = 0; failedVersion = undefined; notifiedVersion = undefined;
        appliedVersion = undefined;
        // A newer release that replaces a pending one keeps the wait: the cap counts from when an update first became
        // pending, so releases that keep coming every few hours cannot postpone the update forever.
        if (!version) pendingSince = undefined;
        else if (heldVersion === undefined) pendingSince = now();
        heldVersion = version ?? undefined;
      }
      if (!version || !options.enabled() || appliedVersion === version) {
        idleSince = undefined;
        if (version) decision("off; awaiting Restart");
        // Nothing to apply: still notice Trunk work now and then, so the next update knows how to land.
        if (!options.trunkWork && options.activeRuns && (lastSampleAt === undefined || now() - lastSampleAt >= TRUNK_WORK_SAMPLE_MS)) {
          await noteRuns().catch(() => undefined);
        }
        return;
      }
      if (now() < retryAfter) return;
      const health = await options.health?.();
      const refusal = health && updateHealthRefusal(health);
      if (refusal) {
        idleSince = undefined;
        decision(`not starting ${version}: ${refusal}`);
        return;
      }
      const security = await options.securityFix?.(version) ?? false;
      await noteRuns();
      // A pending update over the cap skips the Trunk-work batch: it lands at the next gap.
      const capped = pendingSince !== undefined && now() - pendingSince >= AUTO_APPLY_PENDING_CAP_MS;
      if (capped && cappedNoted !== version) {
        cappedNoted = version;
        options.log(`auto-apply: ${version} has been pending over 6 hours; applying at the next gap, not waiting for Trunk work to finish`);
      }
      // Trunk work batches updates: hourly at most. A security fix or a capped update lands as on any machine.
      const batched = !security && !capped && runningTrunkWork();
      if (batched && lastAppliedAt !== undefined && now() - lastAppliedAt < TRUNK_UPDATE_MIN_INTERVAL_MS) {
        idleSince = undefined;
        decision(`batching ${version} with Trunk work; the last update applied under an hour ago`);
        return;
      }
      const relaunch = await options.relaunchesApp?.(version) ?? false;
      const handoff = !relaunch && Boolean(options.seamlessHandoff?.()) && failedVersion !== version;
      if (handoff && !batched) {
        restarting = true;
        decision(`prepared handoff for ${version}${security ? " (security fix)" : ""}`);
        try {
          await options.restart(version, true);
          await applied(version);
          restarting = false;
          return;
        } catch {
          // No standby (typical on a low-memory Mac): drain after idle, without a toast or back-off.
          restarting = false;
          failedVersion = version;
          decision(`handoff unavailable; falling back to idle drain for ${version}`);
        }
      }
      // A relaunch stops every run the app owns: any run in flight holds it off and resets the gap.
      const busy = (activity: UpdateActivity) => turnWaiting(activity) || (relaunch && activity.activeRuns > 0);
      const activity = await readActivity();
      if (busy(activity)) {
        idleSince = undefined;
        decision(`waiting for ${activity.activeRuns} active runs, ${activity.pendingApprovals} approvals${activity.streaming ? ", streaming reply" : ""}${activity.unsavedDraftFiles ? ", unsaved draft files" : ""}${batched ? `; deferring ${version} until a gap in Trunk work` : ""}`);
        return;
      }
      idleSince ??= now();
      if (now() - idleSince < AUTO_APPLY_GAP_MS) {
        decision(`idle hold for ${version}`);
        return;
      }
      // A fresh gateway snapshot closes the gap after the hold timer and before relaunch.
      const final = await readActivity();
      if (busy(final) || !options.enabled()) {
        idleSince = undefined;
        decision(`waiting for ${final.activeRuns} active runs, ${final.pendingApprovals} approvals`);
        return;
      }
      // The handoff keeps running work alive, so it lands at a gap whatever Trunks are doing.
      if (batched && handoff) {
        restarting = true;
        decision(`idle; handing off to ${version}`);
        try { await options.restart(version, true); await applied(version); }
        catch { failedVersion = version; decision(`handoff unavailable; falling back to idle drain for ${version}`); }
        finally { restarting = false; }
        return;
      }
      // Without a handoff, a drain protects running work only on an idle engine, or once the update is over the cap:
      // then it drains at this gap, and the engine finishes its runs before it stops.
      if (final.activeRuns && !capped) {
        decision(`waiting for ${final.activeRuns} active runs, ${final.pendingApprovals} approvals; no standby to hand off to for ${version}`);
        return;
      }
      restarting = true;
      decision(final.activeRuns ? `draining at a gap for ${version}; ${final.activeRuns} runs finish first` : `restarting for ${version}`);
      try { await options.restart(version, false, capped && final.activeRuns > 0); await applied(version); restarting = false; }
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
