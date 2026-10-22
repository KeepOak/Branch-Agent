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
/**
 * A failed activity check (a probe that timed out, an engine that is restarting) backs off from AUTO_APPLY_POLL_MS,
 * doubling up to this cap, and retries with the setting left on (Private #1054). Auto-apply never turns itself off.
 */
export const AUTO_APPLY_CHECK_BACKOFF_MAX_MS = 5 * 60_000;
/**
 * After this many activity checks fail in a row (a window that never answers its probe), the failure counts as
 * unknown-idle: the engine's own run count decides, and the usual idle hold still applies before anything restarts.
 * Without it, a silent window held a staged update forever.
 */
export const AUTO_APPLY_SILENT_IDLE_AFTER = 3;
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
/**
 * Private #951 health rule, legacy form: free fractions of disk and RAM. It applies only when a reading has no byte
 * count (a test pinning a fraction); a real reading uses the absolute floors below, because a percentage blocks a
 * large drive forever (9% of 952 GB is still 89 GB free).
 */
export const UPDATE_MIN_FREE_DISK = 0.10;
export const UPDATE_MIN_FREE_MEMORY = 0.20;
const GIB = 1024 ** 3;
/** No update starts with less free disk than this, nor less than UPDATE_DISK_SIZE_FACTOR times the update's size. */
export const UPDATE_MIN_FREE_DISK_BYTES = 2 * GIB;
export const UPDATE_DISK_SIZE_FACTOR = 3;
/** No update starts with less free RAM than this (room for a standby engine beside the running one). */
export const UPDATE_MIN_FREE_MEMORY_BYTES = 1 * GIB;

/** Free fractions (0 to 1) of the disk holding Branch's data and of the machine's RAM, with free bytes when known. */
export interface UpdateHealth {
  diskFree: number;
  memoryFree: number;
  diskFreeBytes?: number;
  memoryFreeBytes?: number;
}

/**
 * This host's free disk (the volume holding Branch's data) and free RAM. Tests pin a fraction with
 * BRANCH_DESKTOP_UPDATE_FREE_DISK or BRANCH_DESKTOP_UPDATE_FREE_MEMORY (0 to 1; that reading then has no byte count),
 * or a byte count with BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES or BRANCH_DESKTOP_UPDATE_FREE_MEMORY_BYTES.
 */
export function readUpdateHealth(dataDir: string, availableMemoryBytes: number, totalMemoryBytes: number, env: NodeJS.ProcessEnv = process.env): UpdateHealth {
  const pinned = (value: string | undefined): number | undefined => {
    const fraction = Number(value);
    return value && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction : undefined;
  };
  const pinnedBytes = (value: string | undefined): number | undefined => {
    const bytes = Number(value);
    return value && Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
  };
  let diskFree = pinned(env.BRANCH_DESKTOP_UPDATE_FREE_DISK);
  let diskFreeBytes: number | undefined;
  if (diskFree === undefined) {
    const disk = statfsSync(dataDir);
    diskFree = disk.blocks > 0 ? disk.bavail / disk.blocks : 1;
    // On Windows, bavail counts available clusters and bsize is bytes per cluster.
    diskFreeBytes = pinnedBytes(env.BRANCH_DESKTOP_UPDATE_FREE_DISK_BYTES) ?? Number(disk.bavail) * Number(disk.bsize);
  }
  let memoryFree = pinned(env.BRANCH_DESKTOP_UPDATE_FREE_MEMORY);
  let memoryFreeBytes: number | undefined;
  if (memoryFree === undefined) {
    memoryFree = totalMemoryBytes > 0 ? availableMemoryBytes / totalMemoryBytes : 1;
    memoryFreeBytes = pinnedBytes(env.BRANCH_DESKTOP_UPDATE_FREE_MEMORY_BYTES) ?? availableMemoryBytes;
  }
  return { diskFree, memoryFree, ...(diskFreeBytes === undefined ? {} : { diskFreeBytes }), ...(memoryFreeBytes === undefined ? {} : { memoryFreeBytes }) };
}

/** The free disk an update of `updateBytes` needs: the fixed floor, or three times its size when that is more. */
export function updateDiskFloor(updateBytes = 0): number {
  return Math.max(UPDATE_MIN_FREE_DISK_BYTES, UPDATE_DISK_SIZE_FACTOR * Math.max(0, updateBytes));
}

/** Why an update must not start on this host now, or undefined when it may. */
export function updateHealthRefusal(health: UpdateHealth, updateBytes = 0): string | undefined {
  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;
  const gb = (bytes: number) => `${(bytes / GIB).toFixed(1)} GB`;
  if (health.diskFreeBytes !== undefined) {
    const floor = updateDiskFloor(updateBytes);
    if (health.diskFreeBytes < floor) return `low disk: ${gb(health.diskFreeBytes)} free, the update needs about ${gb(floor)}`;
  } else if (health.diskFree < UPDATE_MIN_FREE_DISK) return `low disk: ${percent(health.diskFree)} free, under ${percent(UPDATE_MIN_FREE_DISK)}`;
  if (health.memoryFreeBytes !== undefined) {
    if (health.memoryFreeBytes < UPDATE_MIN_FREE_MEMORY_BYTES) return `low memory: ${gb(health.memoryFreeBytes)} free, under ${gb(UPDATE_MIN_FREE_MEMORY_BYTES)}`;
  } else if (health.memoryFree < UPDATE_MIN_FREE_MEMORY) return `low memory: ${percent(health.memoryFree)} free, under ${percent(UPDATE_MIN_FREE_MEMORY)}`;
  return undefined;
}

export function createAutoApplyUpdate(options: {
  pendingVersion(): Promise<string | null>;
  /** The owner's "apply updates automatically" setting, and nothing else. */
  enabled(): boolean;
  /**
   * What holds the desktop's update lock now (crash recovery, a staged-update replacement, Undo), or undefined. A held
   * lock only postpones the update: auto-apply stays on and retries once it is released (Private #1054).
   */
  busy?(): string | undefined;
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
  /** Activity checks that failed in a row; each one doubles the wait before the next (Private #1054). */
  let checkFailures = 0;
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
  let silentNoted = false;
  const readActivity = async (): Promise<UpdateActivity> => {
    let activity: UpdateActivity;
    try { activity = await options.activity(); }
    catch (error) {
      if (checkFailures + 1 < AUTO_APPLY_SILENT_IDLE_AFTER) throw error;
      // Repeated failures: idle unless the engine itself reports runs; the gap and final re-check still apply.
      const runs = options.activeRuns ? await options.activeRuns() : 0;
      if (!silentNoted) {
        silentNoted = true;
        options.log(`auto-apply: activity check failed ${checkFailures + 1} times (${error instanceof Error ? error.message : String(error)}); treating the window as idle and using the engine's run count`);
      }
      lastSampleAt = now();
      if (runs > 0) lastRunSeenAt = lastSampleAt;
      return { activeRuns: runs, pendingApprovals: 0, streaming: false, unsavedDraftFiles: false };
    }
    checkFailures = 0; silentNoted = false;
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
        idleSince = undefined; retryAfter = 0; checkFailures = 0; failedVersion = undefined; notifiedVersion = undefined;
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
      const holder = options.busy?.();
      if (holder) {
        idleSince = undefined;
        decision(`waiting; ${holder} in progress; ${version} applies once it ends`);
        return;
      }
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
      // Crash recovery or a staged-update replacement can take the lock during the gap: postpone, never "off".
      const stillHeld = options.busy?.();
      if (stillHeld) {
        idleSince = undefined;
        decision(`waiting; ${stillHeld} in progress; ${version} applies once it ends`);
        return;
      }
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
      // A failed check is unknown, not "off": the setting stays on, and the next check waits a little longer.
      checkFailures++;
      const wait = Math.min(AUTO_APPLY_POLL_MS * 2 ** (checkFailures - 1), AUTO_APPLY_CHECK_BACKOFF_MAX_MS);
      retryAfter = Math.max(retryAfter, now() + wait);
      decision(`waiting; activity check failed: ${error instanceof Error ? error.message : String(error)}; retrying in ${Math.round(wait / 1000)} s`);
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
