// A per-install queue of briefed jobs. The Coordinator adds jobs (queue_add); when a Trunk's run ends and it is
// idle, the gateway hands it the top unclaimed job in a new thread, the way trunk_send would. The queue lives in
// Branch's state folder and only the gateway writes it: each read-modify-write is synchronous, so two Trunks that
// finish together can never claim the same job. Same storage pattern as gateway/contacts/graft-work.ts.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { teamMembers } from "./trunk-team-registry.js";

export type TrunkQueueItem = {
  id: string;
  title: string;
  brief_text: string;
  priority: number;
  added_at: number;
  claimed_by?: string;
  claimed_at?: number;
  /** One claim attempt: dispatch and failure cleanup act only while the job still carries this id. */
  claim_id?: string;
  /** The new thread this claim attempt sends the brief to. */
  thread_key?: string;
  /** Last run activity seen for the claiming Trunk; with none for STALE_CLAIM_MS and no live run, it is released. */
  active_at?: number;
  done_at?: number;
  released_at?: number;
  released_from?: string;
  /** Claim attempts that ended in an error or a failed dispatch. At MAX_CLAIM_FAILURES the job is blocked. */
  failures?: number;
  /** Plain reason a job stopped after MAX_CLAIM_FAILURES. Shown in the queue list; cleared by queue_release. */
  blocked_reason?: string;
  /** The team this job belongs to. Only that team's registered members may claim it. */
  team?: string;
};

export type TrunkQueueStatus = "queued" | "claimed" | "released" | "blocked" | "done";

/** The gateway calls a pickup needs: the Trunk's threads (is it idle?) and a new thread with the brief. */
export type TrunkQueueGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
};

export const STALE_CLAIM_MS = 2 * 60 * 60_000;
/** A claim with no run activity for this long and no live run lost its run without a run-end event. */
export const ORPHAN_CLAIM_GRACE_MS = 2 * 60_000;
/** Failed claim attempts after which a job is blocked, so a broken job cannot re-dispatch forever. */
export const MAX_CLAIM_FAILURES = 3;
/** Live sessions requested per query. The query selects running sessions before the limit applies. */
const LIVE_SESSION_LIMIT = 500;
const RETAIN_DONE_MS = 7 * 24 * 60 * 60_000;
const RUN_ERROR_REASON = "the run ended with an error";

/** Claim ids whose brief is still being sent. A claim is never called orphaned while its dispatch is in flight. */
const dispatchingClaimIds = new Set<string>();

function file(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "trunks", "queue.json");
}

function read(env?: NodeJS.ProcessEnv): TrunkQueueItem[] {
  try {
    const rows = JSON.parse(fs.readFileSync(file(env), "utf8")) as unknown;
    return Array.isArray(rows)
      ? rows.filter(
          (row): row is TrunkQueueItem =>
            Boolean(row) &&
            typeof row.id === "string" &&
            typeof row.title === "string" &&
            typeof row.brief_text === "string" &&
            typeof row.priority === "number" &&
            typeof row.added_at === "number",
        )
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

function release(row: TrunkQueueItem, now: number): void {
  row.released_from = row.claimed_by;
  row.released_at = now;
  delete row.claimed_by;
  delete row.claimed_at;
  delete row.claim_id;
  delete row.thread_key;
  delete row.active_at;
}

function isPastStaleTime(row: TrunkQueueItem, now: number): boolean {
  return now - (row.active_at ?? row.claimed_at ?? now) >= STALE_CLAIM_MS;
}

/** A team job is claimable only by a member of that team; any other job is open to every eligible Trunk. */
function mayClaim(row: TrunkQueueItem, agentId: string, env?: NodeJS.ProcessEnv): boolean {
  if (!row.team) {
    return true;
  }
  return (teamMembers(row.team, env) ?? []).includes(agentId);
}

function isClaimable(row: TrunkQueueItem): boolean {
  return !row.done_at && !row.claimed_by && (row.failures ?? 0) < MAX_CLAIM_FAILURES;
}

/** Counts a failed attempt and puts the job back. At the cap the job is blocked with a plain reason. */
function failClaim(row: TrunkQueueItem, now: number, reason: string): void {
  row.failures = (row.failures ?? 0) + 1;
  release(row, now);
  if (row.failures >= MAX_CLAIM_FAILURES) {
    row.blocked_reason =
      `Stopped after ${MAX_CLAIM_FAILURES} failed attempts (last: ${reason}). ` +
      "Check the Trunk, then queue_release this job to run it again.";
    announce({ kind: "blocked", item: { ...row } });
  }
}

export function queueItemStatus(row: TrunkQueueItem): TrunkQueueStatus {
  if (row.done_at) {
    return "done";
  }
  if (row.claimed_by) {
    return "claimed";
  }
  if (row.blocked_reason) {
    return "blocked";
  }
  return row.released_at ? "released" : "queued";
}

/** Highest priority first; the oldest job wins a tie. */
function byPriority(a: TrunkQueueItem, b: TrunkQueueItem): number {
  return b.priority - a.priority || a.added_at - b.added_at;
}

export function addQueueItem(
  input: { title: string; brief_text: string; priority?: number; team?: string },
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueItem {
  const rows = read(env);
  const item: TrunkQueueItem = {
    id: randomUUID(),
    title: input.title,
    brief_text: input.brief_text,
    priority: input.priority ?? 0,
    added_at: now,
    ...(input.team ? { team: input.team } : {}),
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
/** A real change in a job's state. Refreshes and no-op calls produce none. */
export type QueueTransition = {
  kind: "claimed" | "done" | "released" | "blocked";
  item: TrunkQueueItem;
  agentId?: string;
};
type QueueTransitionListener = (transition: QueueTransition) => void;
let transitionListener: QueueTransitionListener | undefined;

/** The gateway sets one listener for progress lines. Clearing it (undefined) stops them. */
export function setQueueTransitionListener(listener: QueueTransitionListener | undefined): void {
  transitionListener = listener;
}

function announce(transition: QueueTransition): void {
  try {
    transitionListener?.(transition);
  } catch {
    // A progress line must never fail the queue operation that produced it.
  }
}

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
  const firstCompletion = row.done_at === undefined;
  row.done_at ??= now;
  write(rows, now, env);
  if (firstCompletion) {
    announce({ kind: "done", item: { ...row } });
  }
  return row;
}

/**
 * Puts a stuck claim back in the queue and returns the job as it was before. With claimId, only that claim
 * attempt is released, so a late failure never releases a newer claim on the same job. A blocked job is
 * unblocked: its failure count resets and it can be claimed again.
 */
export function releaseQueueItem(
  id: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
  claimId?: string,
): TrunkQueueItem | undefined {
  const rows = read(env);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) {
    return undefined;
  }
  const before = { ...row };
  if (isOpenClaim(row) && (claimId === undefined || row.claim_id === claimId)) {
    const claimant = row.claimed_by;
    release(row, now);
    write(rows, now, env);
    announce({ kind: "released", item: { ...row }, agentId: claimant });
  } else if (!row.claimed_by && row.blocked_reason) {
    delete row.blocked_reason;
    row.failures = 0;
    row.released_at = now;
    write(rows, now, env);
  }
  return before;
}

/** Records run activity in the claim's own thread, so a working claim is not released as stale. */
export function touchQueueClaim(
  threadKey: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): void {
  const rows = read(env);
  const row = rows.find(
    (candidate) => isOpenClaim(candidate) && candidate.thread_key === threadKey,
  );
  if (!row) {
    return;
  }
  row.active_at = now;
  write(rows, now, env);
}

/**
 * The run in a claim's own thread ended. A clean end completes the job; an error counts a failed attempt and
 * puts it back. Runs in other threads do not touch the claim. Returns whether a claim was closed.
 */
export function closeQueueClaimForThread(
  threadKey: string,
  outcome: "completed" | "failed",
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): boolean {
  const rows = read(env);
  const row = rows.find(
    (candidate) => isOpenClaim(candidate) && candidate.thread_key === threadKey,
  );
  if (!row) {
    return false;
  }
  if (outcome === "completed") {
    row.done_at = now;
  } else {
    failClaim(row, now, RUN_ERROR_REASON);
  }
  write(rows, now, env);
  return true;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A claim attempt that could not be dispatched: counted as a failure, and only if it still holds this claim. */
function failQueueClaim(
  id: string,
  env: NodeJS.ProcessEnv | undefined,
  now: number,
  claimId: string,
  reason: string,
): void {
  const rows = read(env);
  const row = rows.find((candidate) => candidate.id === id);
  if (!row || !isOpenClaim(row) || row.claim_id !== claimId) {
    return;
  }
  failClaim(row, now, reason);
  write(rows, now, env);
}

/** True while the job is still held by this claim attempt (not done, released or reclaimed since). */
export function isQueueClaimCurrent(id: string, claimId: string, env?: NodeJS.ProcessEnv): boolean {
  return read(env).some((row) => row.id === id && isOpenClaim(row) && row.claim_id === claimId);
}

export type TrunkQueueClaim = TrunkQueueItem & {
  claimed_by: string;
  claim_id: string;
  thread_key: string;
};

/**
 * Claims the top unclaimed job for a Trunk; nothing when the queue is empty or the Trunk already holds one.
 * Synchronous from read to write, so concurrent pickups in the gateway never claim the same job. Each claim
 * gets its own id and new thread, so a job that was released and claimed again is a fresh dispatch.
 */
export function claimNextQueueItem(
  agentId: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueClaim | undefined {
  const rows = read(env);
  const holds = rows.some((row) => isOpenClaim(row) && row.claimed_by === agentId);
  const next = holds
    ? undefined
    : rows.filter((row) => isClaimable(row) && mayClaim(row, agentId, env)).toSorted(byPriority)[0];
  if (!next) {
    return undefined;
  }
  const claimId = randomUUID();
  const claim = Object.assign(next, {
    claimed_by: agentId,
    claimed_at: now,
    claim_id: claimId,
    thread_key: `agent:${agentId}:queue-${next.id}-${claimId.slice(0, 8)}`,
    active_at: now,
  });
  write(rows, now, env);
  announce({ kind: "claimed", item: { ...claim }, agentId });
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
 * Puts back claims that have had no run activity for STALE_CLAIM_MS. The recorded start/end time is only a
 * hint: a claim is released only when its Trunk also has no live run now, so a run lasting longer than
 * STALE_CLAIM_MS keeps its job. The gateway is called only when some claim is past that time.
 */
export async function releaseStaleQueueClaims(params: {
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): Promise<void> {
  const now = params.now ?? Date.now;
  const candidates = read(params.env).filter(
    (row) => isOpenClaim(row) && isPastStaleTime(row, now()),
  );
  for (const candidate of candidates) {
    const agentId = candidate.claimed_by!;
    const working = await isTrunkWorking(params.gateway, agentId);
    const rows = read(params.env);
    const row = rows.find(
      (current) =>
        current.id === candidate.id &&
        isOpenClaim(current) &&
        current.claimed_by === agentId &&
        current.claim_id === candidate.claim_id,
    );
    const at = now();
    if (!row || (!working && !isPastStaleTime(row, at))) {
      continue;
    }
    if (working) {
      row.active_at = at;
    } else {
      release(row, at);
    }
    write(rows, at, params.env);
  }
}

type PickupParams = {
  agentId: string;
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
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
  // Abandoned claims go back first, so a queue holding only those still recovers.
  await releaseStaleQueueClaims(params);
  // Empty queue: no thread, no message.
  if (!read(params.env).some(isClaimable)) {
    return undefined;
  }
  if (!(await waitForTrunkIdle(params.gateway, params.agentId, params.idleWaitMs ?? 0))) {
    return undefined;
  }
  const item = claimNextQueueItem(params.agentId, params.env, now());
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
  const { id, claim_id: claimId, thread_key: threadKey } = item;
  // A claim released (or released and reclaimed) while a call was in flight sends nothing more.
  const current = () => isQueueClaimCurrent(id, claimId, params.env);
  dispatchingClaimIds.add(claimId);
  try {
    if (!current()) {
      return undefined;
    }
    await params.gateway.request("sessions.create", {
      key: threadKey,
      agentId: params.agentId,
      // Session labels are unique per Trunk, so a job sent again after a release needs its own label.
      label: `${item.title} (${claimId.slice(0, 8)})`,
    });
    if (!current()) {
      return undefined;
    }
    await params.gateway.request("chat.send", {
      sessionKey: threadKey,
      agentId: params.agentId,
      message: item.brief_text,
      deliver: false,
      idempotencyKey: `trunk-queue-${id}-${claimId}`,
    });
  } catch (error) {
    failQueueClaim(
      id,
      params.env,
      now(),
      claimId,
      `the brief could not be sent: ${errorText(error)}`,
    );
    throw error;
  } finally {
    dispatchingClaimIds.delete(claimId);
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
}): Promise<string[]> {
  await releaseStaleQueueClaims(params);
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
 * A claim whose own thread has no live run, past ORPHAN_CLAIM_GRACE_MS without activity, lost its run without a
 * run-end event (a gateway restart, for one). It goes back in the queue. This is not a failed attempt. A claim whose
 * brief is still being sent is never touched.
 */
export async function releaseOrphanQueueClaims(params: {
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): Promise<void> {
  const now = params.now ?? Date.now;
  const orphans = read(params.env).filter(
    (row) =>
      isOpenClaim(row) &&
      !dispatchingClaimIds.has(row.claim_id ?? "") &&
      now() - (row.active_at ?? row.claimed_at ?? now()) >= ORPHAN_CLAIM_GRACE_MS,
  );
  for (const candidate of orphans) {
    const live = await isClaimThreadLive(
      params.gateway,
      candidate.claimed_by!,
      candidate.thread_key ?? "",
    );
    if (live) {
      continue;
    }
    const rows = read(params.env);
    const row = rows.find(
      (current) =>
        current.id === candidate.id &&
        isOpenClaim(current) &&
        current.claim_id === candidate.claim_id,
    );
    if (!row) {
      continue;
    }
    const at = now();
    release(row, at);
    write(rows, at, params.env);
  }
}

/**
 * Periodic and post-restart pass. Releases orphaned claims, then hands queued jobs to idle eligible Trunks. It makes
 * no gateway call while the queue has neither an open claim nor a claimable job, so an empty queue costs nothing.
 */
export async function reconcileTrunkQueue(params: {
  gateway: TrunkQueueGateway;
  agentIds: () => Promise<string[]>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): Promise<void> {
  const rows = read(params.env);
  if (!rows.some((row) => isOpenClaim(row) || isClaimable(row))) {
    return;
  }
  await releaseOrphanQueueClaims(params);
  if (!read(params.env).some(isClaimable)) {
    return;
  }
  await wakeIdleTrunks({ ...params, agentIds: await params.agentIds() });
}
