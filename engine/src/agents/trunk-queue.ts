// A per-install queue of briefed jobs. The Coordinator adds jobs (queue_add); when a Trunk's run ends and it is
// idle, the gateway hands it the top unclaimed job in a new thread, the way trunk_send would. The queue lives in
// Branch's state folder and only the gateway writes it: each read-modify-write is synchronous, so two Trunks that
// finish together can never claim the same job. Same storage pattern as gateway/contacts/graft-work.ts.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { BranchConfig } from "../config/types.branch.js";

export type TrunkQueueItem = {
  id: string;
  title: string;
  brief_text: string;
  priority: number;
  added_at: number;
  /** One key for the job's operation, kept across every claim attempt. */
  operation_key?: string;
  claimed_by?: string;
  claimed_at?: number;
  /** Lease token of the current claim. Release, settle and renewal act only while the job still carries it. */
  lease_token?: string;
  /** When the lease runs out unless run activity renews it first. */
  lease_expires_at?: number;
  /** The gateway process that granted or last renewed the lease. A lease from an earlier process is checked at once. */
  lease_boot?: string;
  /** This claim attempt's own id. Every attempt of one operation gets a new one. */
  attempt_id?: string;
  /** The new thread this claim attempt sends the brief to. */
  thread_key?: string;
  /** Last run activity seen in the claim's thread. */
  active_at?: number;
  done_at?: number;
  released_at?: number;
  released_from?: string;
  /** Claim attempts that ended without finishing: a failed run, a failed dispatch or a lease that ran out. */
  attempts?: number;
  /** Plain reason a job went dead after maxAttempts. Shown in the queue list; cleared by queue_release. */
  dead_reason?: string;
};

export type TrunkQueueStatus = "queued" | "claimed" | "released" | "dead" | "done";

/** The gateway calls a pickup needs: the Trunk's threads (is it idle?) and a new thread with the brief. */
export type TrunkQueueGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
};

/** Default lease length (agents.trunkQueue.leaseMs). Run start and end in the claim's thread renew it. */
export const STALE_CLAIM_MS = 2 * 60 * 60_000;
/** Default attempt limit (agents.trunkQueue.maxAttempts): a job goes dead after this many unfinished attempts. */
export const MAX_CLAIM_ATTEMPTS = 3;

export type TrunkQueueLeaseSettings = { leaseMs: number; maxAttempts: number };

/** Lease length and attempt limit from agents.trunkQueue, with the defaults above. */
export function queueLeaseSettings(cfg?: BranchConfig): TrunkQueueLeaseSettings {
  return {
    leaseMs: cfg?.agents?.trunkQueue?.leaseMs ?? STALE_CLAIM_MS,
    maxAttempts: cfg?.agents?.trunkQueue?.maxAttempts ?? MAX_CLAIM_ATTEMPTS,
  };
}

/** Live sessions requested per query. The query selects running sessions before the limit applies. */
const LIVE_SESSION_LIMIT = 500;
const RETAIN_DONE_MS = 7 * 24 * 60 * 60_000;
const RUN_ERROR_REASON = "the run ended with an error";
const LEASE_EXPIRED_REASON = "the lease ran out with no live run";

/**
 * This gateway process. Leases granted by an earlier process have no run in this one to renew them. Kept on the
 * process, so a second loaded copy of this module never mistakes this process's live leases for an earlier one's.
 */
const QUEUE_BOOT_KEY = Symbol.for("branch.trunkQueue.bootId");
const processSlots = globalThis as typeof globalThis & { [QUEUE_BOOT_KEY]?: string };
const QUEUE_BOOT_ID = (processSlots[QUEUE_BOOT_KEY] ??= randomUUID());

/** Lease tokens whose brief is still being sent. Such a claim is never reclaimed while its dispatch is in flight. */
const dispatchingLeases = new Set<string>();

function file(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "trunks", "queue.json");
}

/** The field names an earlier queue file used for the lease token, attempt count and dead reason. */
type LegacyQueueItem = TrunkQueueItem & {
  claim_id?: string;
  failures?: number;
  blocked_reason?: string;
};

function upgrade(row: LegacyQueueItem): TrunkQueueItem {
  const { claim_id, failures, blocked_reason, ...item } = row;
  item.lease_token ??= claim_id;
  item.attempts ??= failures;
  item.dead_reason ??= blocked_reason;
  for (const key of ["lease_token", "attempts", "dead_reason"] as const) {
    if (item[key] === undefined) {
      delete item[key];
    }
  }
  return item;
}

function read(env?: NodeJS.ProcessEnv): TrunkQueueItem[] {
  try {
    const rows = JSON.parse(fs.readFileSync(file(env), "utf8")) as unknown;
    return Array.isArray(rows)
      ? rows
          .filter(
            (row): row is LegacyQueueItem =>
              Boolean(row) &&
              typeof row.id === "string" &&
              typeof row.title === "string" &&
              typeof row.brief_text === "string" &&
              typeof row.priority === "number" &&
              typeof row.added_at === "number",
          )
          .map(upgrade)
      : [];
  } catch {
    return [];
  }
}

function write(rows: TrunkQueueItem[], now: number, env?: NodeJS.ProcessEnv): void {
  const target = file(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const kept = rows.filter((row) => !row.done_at || now - row.done_at < RETAIN_DONE_MS);
  fs.writeFileSync(tmp, `${JSON.stringify(kept, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

function isOpenClaim(row: TrunkQueueItem): boolean {
  return Boolean(row.claimed_by) && !row.done_at;
}

function operationKey(id: string): string {
  return `trunk-queue-${id}`;
}

/**
 * The conditional update every release, settle and renewal goes through: change the job only while exactly one
 * open claim on it carries this lease token. Returns the number of rows that matched. Any count other than 1 means
 * the lease was lost (released, reclaimed, settled or ambiguous), and nothing is changed or written. `change` may
 * return false to leave a matched row as it is.
 */
function updateLeased(
  id: string,
  leaseToken: string,
  env: NodeJS.ProcessEnv | undefined,
  now: number,
  change: (row: TrunkQueueItem) => boolean | void,
): number {
  const rows = read(env);
  const held = rows.filter(
    (row) => row.id === id && isOpenClaim(row) && row.lease_token === leaseToken,
  );
  if (held.length !== 1) {
    return held.length;
  }
  if (change(held[0]!) !== false) {
    write(rows, now, env);
  }
  return 1;
}

function release(row: TrunkQueueItem, now: number): void {
  row.released_from = row.claimed_by;
  row.released_at = now;
  delete row.claimed_by;
  delete row.claimed_at;
  delete row.lease_token;
  delete row.lease_expires_at;
  delete row.lease_boot;
  delete row.attempt_id;
  delete row.thread_key;
  delete row.active_at;
}

function renew(row: TrunkQueueItem, now: number, settings: TrunkQueueLeaseSettings): void {
  row.active_at = now;
  row.lease_expires_at = now + settings.leaseMs;
  row.lease_boot = QUEUE_BOOT_ID;
}

function leaseExpiresAt(row: TrunkQueueItem, settings: TrunkQueueLeaseSettings): number {
  return row.lease_expires_at ?? (row.active_at ?? row.claimed_at ?? 0) + settings.leaseMs;
}

function isClaimable(row: TrunkQueueItem): boolean {
  return !row.done_at && !row.claimed_by && !row.dead_reason;
}

/** Counts an unfinished attempt and puts the job back. At maxAttempts the job is dead, with a plain reason. */
function failClaim(
  row: TrunkQueueItem,
  now: number,
  reason: string,
  settings: TrunkQueueLeaseSettings,
): void {
  row.attempts = (row.attempts ?? 0) + 1;
  release(row, now);
  if (row.attempts >= settings.maxAttempts) {
    row.dead_reason =
      `Stopped after ${row.attempts} attempts (last: ${reason}). ` +
      "Check the Trunk, then queue_release this job to run it again.";
  }
}

export function queueItemStatus(row: TrunkQueueItem): TrunkQueueStatus {
  if (row.done_at) {
    return "done";
  }
  if (row.claimed_by) {
    return "claimed";
  }
  if (row.dead_reason) {
    return "dead";
  }
  return row.released_at ? "released" : "queued";
}

/** Highest priority first; the oldest job wins a tie. */
function byPriority(a: TrunkQueueItem, b: TrunkQueueItem): number {
  return b.priority - a.priority || a.added_at - b.added_at;
}

export function addQueueItem(
  input: { title: string; brief_text: string; priority?: number },
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueItem {
  const rows = read(env);
  const id = randomUUID();
  const item: TrunkQueueItem = {
    id,
    title: input.title,
    brief_text: input.brief_text,
    priority: input.priority ?? 0,
    added_at: now,
    operation_key: operationKey(id),
  };
  rows.push(item);
  write(rows, now, env);
  return item;
}

export function listQueueItems(
  env?: NodeJS.ProcessEnv,
): Array<TrunkQueueItem & { status: TrunkQueueStatus }> {
  return read(env)
    .toSorted(byPriority)
    .map((row) => Object.assign(row, { status: queueItemStatus(row) }));
}

/** Marks a job finished and returns it (with the Trunk that held it). */
export function markQueueItemDone(
  id: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueItem | undefined {
  const rows = read(env);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) {
    return undefined;
  }
  row.done_at ??= now;
  write(rows, now, env);
  return row;
}

/**
 * The person's queue_release: puts a claim back in the queue and returns the job as it was before. A dead job is
 * revived: its attempt count resets and it can be claimed again. A holder releasing its own claim uses
 * releaseQueueClaim with its lease token instead.
 */
export function releaseQueueItem(
  id: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueItem | undefined {
  const rows = read(env);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) {
    return undefined;
  }
  const before = { ...row };
  if (isOpenClaim(row)) {
    release(row, now);
    write(rows, now, env);
  } else if (!row.claimed_by && row.dead_reason) {
    delete row.dead_reason;
    row.attempts = 0;
    row.released_at = now;
    write(rows, now, env);
  }
  return before;
}

/** Puts the claim back without counting an attempt, only while this lease still holds it. Returns the row count. */
export function releaseQueueClaim(
  id: string,
  leaseToken: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): number {
  return updateLeased(id, leaseToken, env, now, (row) => release(row, now));
}

/**
 * Settles one claim attempt, only while this lease still holds the job: a clean end completes the job, a failure
 * counts an attempt and puts it back (dead at maxAttempts). Returns the row count; anything but 1 means the lease
 * was lost and nothing changed.
 */
export function settleQueueClaim(
  id: string,
  leaseToken: string,
  outcome: "completed" | "failed",
  params: {
    reason?: string;
    env?: NodeJS.ProcessEnv;
    now?: number;
    settings?: TrunkQueueLeaseSettings;
  } = {},
): number {
  const now = params.now ?? Date.now();
  const settings = params.settings ?? queueLeaseSettings();
  return updateLeased(id, leaseToken, params.env, now, (row) => {
    if (outcome === "completed") {
      row.done_at = now;
    } else {
      failClaim(row, now, params.reason ?? RUN_ERROR_REASON, settings);
    }
  });
}

/** The open claim whose own thread is this one, if any. */
function claimForThread(threadKey: string, env?: NodeJS.ProcessEnv): TrunkQueueItem | undefined {
  return read(env).find(
    (candidate) => isOpenClaim(candidate) && candidate.thread_key === threadKey,
  );
}

/** Run activity in the claim's own thread renews its lease, so a working claim is not reclaimed. */
export function touchQueueClaim(
  threadKey: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
  settings: TrunkQueueLeaseSettings = queueLeaseSettings(),
): void {
  const row = claimForThread(threadKey, env);
  if (row?.lease_token) {
    updateLeased(row.id, row.lease_token, env, now, (held) => renew(held, now, settings));
  }
}

/**
 * The run in a claim's own thread ended. A clean end completes the job; an error counts an attempt and puts it
 * back. Runs in other threads do not touch the claim. Returns whether a claim was closed.
 */
export function closeQueueClaimForThread(
  threadKey: string,
  outcome: "completed" | "failed",
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
  settings: TrunkQueueLeaseSettings = queueLeaseSettings(),
): boolean {
  const row = claimForThread(threadKey, env);
  return (
    Boolean(row?.lease_token) &&
    settleQueueClaim(row!.id, row!.lease_token!, outcome, { env, now, settings }) === 1
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True while the job is still held by this lease (not done, released or reclaimed since). */
export function isQueueClaimCurrent(
  id: string,
  leaseToken: string,
  env?: NodeJS.ProcessEnv,
): boolean {
  return read(env).some(
    (row) => row.id === id && isOpenClaim(row) && row.lease_token === leaseToken,
  );
}

export type TrunkQueueClaim = TrunkQueueItem & {
  claimed_by: string;
  operation_key: string;
  lease_token: string;
  lease_expires_at: number;
  attempt_id: string;
  thread_key: string;
};

/**
 * Claims the top unclaimed job for a Trunk; nothing when the queue is empty or the Trunk already holds one.
 * Synchronous from read to write, so concurrent pickups in the gateway never claim the same job. Each claim
 * gets its own lease token, attempt id and new thread, under the job's one operation key.
 */
export function claimNextQueueItem(
  agentId: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
  settings: TrunkQueueLeaseSettings = queueLeaseSettings(),
): TrunkQueueClaim | undefined {
  const rows = read(env);
  const holds = rows.some((row) => isOpenClaim(row) && row.claimed_by === agentId);
  const next = holds ? undefined : rows.filter(isClaimable).toSorted(byPriority)[0];
  if (!next) {
    return undefined;
  }
  const attemptId = randomUUID();
  const claim = Object.assign(next, {
    operation_key: next.operation_key ?? operationKey(next.id),
    claimed_by: agentId,
    claimed_at: now,
    lease_token: randomUUID(),
    lease_expires_at: now + settings.leaseMs,
    lease_boot: QUEUE_BOOT_ID,
    attempt_id: attemptId,
    thread_key: `agent:${agentId}:queue-${next.id}-${attemptId.slice(0, 8)}`,
    active_at: now,
  });
  write(rows, now, env);
  return claim;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

/** A session row counts as live when it reports a run in progress. */
function isLiveRow(row: Rec): boolean {
  return (
    row.hasActiveRun === true ||
    row.status === "running" ||
    (typeof row.activeWriterRunId === "string" && row.activeWriterRunId !== "")
  );
}

/**
 * Live sessions of one Trunk, selected before pagination so the limit cannot hide a running session. A page
 * that comes back full is treated as live, so an unseen run is never released by mistake.
 */
async function liveSessionRows(gw: TrunkQueueGateway, agentId: string): Promise<Rec[] | "full"> {
  const rows = rec(
    await gw.request("sessions.list", {
      agentId,
      activeOnly: true,
      limit: LIVE_SESSION_LIMIT,
    }),
  ).sessions;
  const list = Array.isArray(rows) ? rows.map(rec) : [];
  return list.length >= LIVE_SESSION_LIMIT ? "full" : list;
}

/** A Trunk is working while any of its threads has a run: the same test trunks_list uses. */
async function isTrunkWorking(gw: TrunkQueueGateway, agentId: string): Promise<boolean> {
  const rows = await liveSessionRows(gw, agentId);
  return rows === "full" || rows.some(isLiveRow);
}

/** Whether one claim's own thread has a live run. Matched on the exact stored thread key. */
async function isClaimThreadLive(
  gw: TrunkQueueGateway,
  agentId: string,
  threadKey: string,
): Promise<boolean> {
  const rows = await liveSessionRows(gw, agentId);
  return rows === "full" || rows.some((row) => row.key === threadKey && isLiveRow(row));
}

const IDLE_POLL_MS = 500;

/** True once the Trunk has no running thread, checking again every IDLE_POLL_MS for up to waitMs. */
async function waitForTrunkIdle(
  gw: TrunkQueueGateway,
  agentId: string,
  waitMs: number,
): Promise<boolean> {
  for (let waited = 0; ; waited += IDLE_POLL_MS) {
    if (!(await isTrunkWorking(gw, agentId))) {
      return true;
    }
    if (waited + IDLE_POLL_MS > waitMs) {
      return false;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, IDLE_POLL_MS);
    });
  }
}

/**
 * The reaper. A claim is due when its lease ran out, or when an earlier gateway process granted it (that process's
 * runs are gone, so nothing here would renew it). A due claim whose run is still live gets a fresh lease: for a
 * lease that ran out, any live run of its Trunk counts; for an earlier process's lease, only its own thread. Otherwise
 * an expired lease counts an attempt and goes back to pending, or dead at maxAttempts; an earlier process's lease
 * that has not run out goes back without counting. Every change is the conditional lease update, so a claim that was
 * renewed, settled or released meanwhile is left alone. A claim whose brief is still being sent is never touched,
 * and the gateway is called only for due claims.
 */
export async function reapExpiredQueueClaims(params: {
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  settings?: TrunkQueueLeaseSettings;
}): Promise<void> {
  const now = params.now ?? Date.now;
  const settings = params.settings ?? queueLeaseSettings();
  const isDue = (row: TrunkQueueItem, at: number) =>
    isOpenClaim(row) &&
    Boolean(row.lease_token) &&
    !dispatchingLeases.has(row.lease_token!) &&
    (row.lease_boot !== QUEUE_BOOT_ID || at >= leaseExpiresAt(row, settings));
  const due = read(params.env).filter((row) => isDue(row, now()));
  for (const candidate of due) {
    const agentId = candidate.claimed_by!;
    const expired = now() >= leaseExpiresAt(candidate, settings);
    const live = expired
      ? await isTrunkWorking(params.gateway, agentId)
      : await isClaimThreadLive(params.gateway, agentId, candidate.thread_key ?? "");
    const at = now();
    updateLeased(candidate.id, candidate.lease_token!, params.env, at, (row) => {
      if (!isDue(row, at)) {
        return false;
      }
      if (live) {
        renew(row, at, settings);
      } else if (at >= leaseExpiresAt(row, settings)) {
        failClaim(row, at, LEASE_EXPIRED_REASON, settings);
      } else {
        release(row, at);
      }
      return true;
    });
  }
}

type PickupParams = {
  agentId: string;
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  settings?: TrunkQueueLeaseSettings;
  /**
   * Right after a run ends, sessions.list can still count it as active for a moment. Wait up to this long
   * for the Trunk to show idle; a Trunk still working after that keeps its turn, and its next run end tries again.
   */
  idleWaitMs?: number;
};

/** Trunks with a pickup in flight: overlapping pickups for one Trunk are serialized, not run side by side. */
const pickupsInFlight = new Set<string>();

/**
 * After a Trunk's run ends, or when a card is added: when the Trunk is idle and holds no job, claim the top job
 * and send its brief in a new thread titled with the job title, as trunk_send does. Returns the job and thread,
 * or undefined for no pickup. Overlapping pickups for one Trunk are serialized, and a pickup only starts when the
 * Trunk has no active run at check time. Runs started elsewhere are not fenced here; per-Trunk run exclusivity
 * belongs to the run admission and the arch mailbox work.
 */
export async function pickUpQueuedWork(
  params: PickupParams,
): Promise<{ item: TrunkQueueItem; threadKey: string } | undefined> {
  if (pickupsInFlight.has(params.agentId)) {
    return undefined;
  }
  pickupsInFlight.add(params.agentId);
  try {
    return await claimAndDispatch(params);
  } finally {
    pickupsInFlight.delete(params.agentId);
  }
}

async function claimAndDispatch(
  params: PickupParams,
): Promise<{ item: TrunkQueueItem; threadKey: string } | undefined> {
  const now = params.now ?? Date.now;
  // Expired claims go back first, so a queue holding only those still recovers.
  await reapExpiredQueueClaims(params);
  // Empty queue: no thread, no message.
  if (!read(params.env).some(isClaimable)) {
    return undefined;
  }
  if (!(await waitForTrunkIdle(params.gateway, params.agentId, params.idleWaitMs ?? 0))) {
    return undefined;
  }
  const item = claimNextQueueItem(params.agentId, params.env, now(), params.settings);
  if (!item) {
    return undefined;
  }
  return await dispatchClaim(item, params, now);
}

async function dispatchClaim(
  item: TrunkQueueClaim,
  params: PickupParams,
  now: () => number,
): Promise<{ item: TrunkQueueItem; threadKey: string } | undefined> {
  const { id, lease_token: leaseToken, attempt_id: attemptId, thread_key: threadKey } = item;
  // A claim released (or released and reclaimed) while a call was in flight sends nothing more.
  const current = () => isQueueClaimCurrent(id, leaseToken, params.env);
  dispatchingLeases.add(leaseToken);
  try {
    if (!current()) {
      return undefined;
    }
    await params.gateway.request("sessions.create", {
      key: threadKey,
      agentId: params.agentId,
      // Session labels are unique per Trunk, so a job sent again after a release needs its own label.
      label: `${item.title} (${attemptId.slice(0, 8)})`,
    });
    if (!current()) {
      return undefined;
    }
    await params.gateway.request("chat.send", {
      sessionKey: threadKey,
      agentId: params.agentId,
      message: item.brief_text,
      deliver: false,
      // One operation key for the job; each attempt is a fresh run, so the key carries the attempt id too.
      idempotencyKey: `${item.operation_key}:${attemptId}`,
    });
  } catch (error) {
    settleQueueClaim(id, leaseToken, "failed", {
      reason: `the brief could not be sent: ${errorText(error)}`,
      env: params.env,
      now: now(),
      settings: params.settings,
    });
    throw error;
  } finally {
    dispatchingLeases.delete(leaseToken);
  }
  return { item, threadKey };
}

/**
 * A card was added or a claim was released: hand the top queued job to each idle Trunk in turn, one job per
 * Trunk. Stops at the first error (a refused run, for instance), so the rest of the Trunks are not asked too;
 * the claim that failed is already released. Returns the Trunks that took a job.
 */
export async function wakeIdleTrunks(params: {
  agentIds: string[];
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  settings?: TrunkQueueLeaseSettings;
}): Promise<string[]> {
  await reapExpiredQueueClaims(params);
  const woken: string[] = [];
  for (const agentId of params.agentIds) {
    if (!read(params.env).some(isClaimable)) {
      break;
    }
    const picked = await pickUpQueuedWork({ ...params, agentId, idleWaitMs: 0 });
    if (picked) {
      woken.push(agentId);
    }
  }
  return woken;
}

/**
 * Periodic and post-restart pass. Reaps expired claims, then hands queued jobs to idle eligible Trunks. It makes
 * no gateway call while the queue has neither an open claim nor a claimable job, so an empty queue costs nothing.
 */
export async function reconcileTrunkQueue(params: {
  gateway: TrunkQueueGateway;
  agentIds: () => Promise<string[]>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  settings?: TrunkQueueLeaseSettings;
}): Promise<void> {
  const rows = read(params.env);
  if (!rows.some((row) => isOpenClaim(row) || isClaimable(row))) {
    return;
  }
  await reapExpiredQueueClaims(params);
  if (!read(params.env).some(isClaimable)) {
    return;
  }
  await wakeIdleTrunks({ ...params, agentIds: await params.agentIds() });
}
