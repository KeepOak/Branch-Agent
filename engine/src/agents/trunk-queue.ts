// A per-install queue of briefed jobs. The Coordinator adds jobs (queue_add); when a Trunk's run ends and it is
// idle, the gateway hands it the top unclaimed job in a new thread, the way trunk_send would. The queue lives in
// Branch's state folder and only the gateway writes it: each read-modify-write is synchronous, so two Trunks that
// finish together can never claim the same job. Same storage pattern as gateway/contacts/graft-work.ts.
import { randomUUID } from "node:crypto";
import { isClaimThreadLive, probeWorking, waitForTrunkIdle } from "./trunk-queue-probe.js";
import {
  claimMayRelease,
  GATEWAY_EPOCH,
  queueRunId,
  stopSilentClaim,
} from "./trunk-queue-run-fence.js";
import {
  errorText,
  isTrunkUnavailableError,
  type TrunkAvailability,
} from "./trunk-queue-status.js";
import {
  byPriority,
  withQueueLock,
  claimRef,
  type ClaimRef,
  findClaim,
  isClaimable,
  isOpenClaim,
  isPastStaleTime,
  MAX_CLAIM_FAILURES,
  read,
  release,
  type TrunkQueueGateway,
  type TrunkQueueItem,
  type TrunkQueueStatus,
  updateClaim,
  write,
} from "./trunk-queue-store.js";
export type { TrunkQueueGateway, TrunkQueueItem, TrunkQueueStatus } from "./trunk-queue-store.js";
export { MAX_CLAIM_FAILURES, STALE_CLAIM_MS } from "./trunk-queue-store.js";
export { GATEWAY_EPOCH, ownerEpochFor, queueRunId } from "./trunk-queue-run-fence.js";
export {
  isTrunkUnavailableError,
  trunkAvailabilityLogger,
  type TrunkAvailability,
  type TrunkAvailabilityStatus,
} from "./trunk-queue-status.js";

/** A claim with no run activity for this long and no live run lost its run without a run-end event. */
export const ORPHAN_CLAIM_GRACE_MS = 2 * 60_000;
/** A claim whose run has shown no activity this long is dead in practice, whatever its run status says. */
export const HARD_CLAIM_CAP_MS = 4 * 60 * 60_000;
/** Stop attempts for a silent claim before it is marked as needing a person and not retried. */
export const MAX_STOP_ATTEMPTS = 3;
const RUN_ERROR_REASON = "the run ended with an error";
/** After a Trunk refuses work as not ready, it is not tried again until this much time has passed. */
export const UNAVAILABLE_RETRY_MS = 60_000;

/** Claim ids whose brief is still being sent. A claim is never called orphaned while its dispatch is in flight. */
const dispatchingClaimIds = new Set<string>();

/** A real change in a job's state. Refreshes and no-op calls produce none. */
export type QueueTransition = {
  kind: "claimed" | "done" | "released" | "blocked";
  item: TrunkQueueItem;
  agentId?: string;
  /** Increases with every transition the queue decides, in decision order. Assigned inside the queue lock. */
  seq: number;
};
let transitionSeq = 0;

/** Called inside the queue lock, so the number follows the order in which the queue made each decision. */
function nextSeq(): number {
  transitionSeq += 1;
  return transitionSeq;
}
type QueueTransitionListener = (transition: QueueTransition) => void;
let transitionListener: QueueTransitionListener | undefined;

/** The gateway sets one listener for progress lines. Clearing it (undefined) stops them. */
export function setQueueTransitionListener(listener: QueueTransitionListener | undefined): void {
  transitionListener = listener;
}

/** Called only after the queue lock is released, with a snapshot taken inside it. Never throws into the queue. */
function announce(transition: QueueTransition): void {
  try {
    transitionListener?.(transition);
  } catch {
    // A progress line must never fail the queue operation that produced it.
  }
}

/**
 * Frees a claim the reaper found stale. The transition is decided inside the lock, with the claimant it released, and
 * announced after the lock is released.
 */
function releaseClaimAnnounced(
  env: NodeJS.ProcessEnv | undefined,
  claim: ClaimRef,
  now: number,
): boolean {
  let transition = undefined as QueueTransition | undefined;
  const released = updateClaim(env, claim, now, (row) => {
    const claimant = row.claimed_by;
    release(row, now);
    transition = { kind: "released", item: { ...row }, agentId: claimant, seq: nextSeq() };
  });
  if (transition) {
    announce(transition);
  }
  return released;
}

/** Returns true when this failure blocked the job; the caller announces it after its lock is released. */
function failClaim(row: TrunkQueueItem, now: number, reason: string): boolean {
  row.failures = (row.failures ?? 0) + 1;
  release(row, now);
  if (row.failures >= MAX_CLAIM_FAILURES) {
    row.blocked_reason =
      `Stopped after ${MAX_CLAIM_FAILURES} failed attempts (last: ${reason}). ` +
      "Check the Trunk, then queue_release this job to run it again.";
    return true;
  }
  return false;
}

export function queueItemStatus(row: TrunkQueueItem): TrunkQueueStatus {
  if (row.done_at) {
    return "done";
  }
  if (row.claimed_by) {
    return row.attention_reason ? "needs_attention" : "claimed";
  }
  if (row.blocked_reason) {
    return "blocked";
  }
  return row.released_at ? "released" : "queued";
}

export function addQueueItem(
  input: { title: string; brief_text: string; priority?: number },
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueItem {
  return withQueueLock(env, () => {
    const rows = read(env);
    const item: TrunkQueueItem = {
      id: randomUUID(),
      title: input.title,
      brief_text: input.brief_text,
      priority: input.priority ?? 0,
      added_at: now,
    };
    rows.push(item);
    write(rows, now, env);
    return item;
  });
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
  const done = withQueueLock(env, () => {
    const rows = read(env);
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) {
      return undefined;
    }
    const firstCompletion = row.done_at === undefined;
    row.done_at ??= now;
    write(rows, now, env);
    const transition: QueueTransition | undefined = firstCompletion
      ? { kind: "done", item: { ...row }, seq: nextSeq() }
      : undefined;
    return { row, transition };
  });
  if (!done) {
    return undefined;
  }
  if (done.transition) {
    announce(done.transition);
  }
  return done.row;
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
  const outcome = withQueueLock(env, () => {
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
      const transition: QueueTransition = {
        kind: "released",
        item: { ...row },
        agentId: claimant,
        seq: nextSeq(),
      };
      return { before, transition };
    }
    if (!row.claimed_by && row.blocked_reason) {
      delete row.blocked_reason;
      row.failures = 0;
      row.released_at = now;
      write(rows, now, env);
    }
    return { before };
  });
  if (outcome?.transition) {
    announce(outcome.transition);
  }
  return outcome?.before;
}

/** Records run activity in the claim's own thread, so a working claim is not released as stale. */
export function touchQueueClaim(
  threadKey: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): void {
  return withQueueLock(env, () => {
    const rows = read(env);
    const row = rows.find(
      (candidate) => isOpenClaim(candidate) && candidate.thread_key === threadKey,
    );
    if (!row) {
      return;
    }
    row.active_at = now;
    write(rows, now, env);
  });
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
  const closed = withQueueLock(env, () => {
    const rows = read(env);
    const row = rows.find(
      (candidate) => isOpenClaim(candidate) && candidate.thread_key === threadKey,
    );
    if (!row) {
      return undefined;
    }
    let transition: QueueTransition | undefined;
    if (outcome === "completed") {
      const firstCompletion = row.done_at === undefined;
      row.done_at = now;
      if (firstCompletion) {
        transition = { kind: "done", item: { ...row }, agentId: row.claimed_by, seq: nextSeq() };
      }
    } else if (failClaim(row, now, RUN_ERROR_REASON)) {
      transition = { kind: "blocked", item: { ...row }, seq: nextSeq() };
    }
    write(rows, now, env);
    return { transition };
  });
  if (!closed) {
    return false;
  }
  if (closed.transition) {
    announce(closed.transition);
  }
  return true;
}

/**
 * The Trunk refused the brief because it is not ready. The job is not at fault, so it goes back without a failed
 * attempt, and only if this claim still holds it.
 */
function releaseUnavailableClaim(
  id: string,
  env: NodeJS.ProcessEnv | undefined,
  now: number,
  claimId: string,
): void {
  return withQueueLock(env, () => {
    const rows = read(env);
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || !isOpenClaim(row) || row.claim_id !== claimId) {
      return;
    }
    release(row, now);
    write(rows, now, env);
  });
}

/** A claim attempt that could not be dispatched: counted as a failure, and only if it still holds this claim. */
function failQueueClaim(
  id: string,
  env: NodeJS.ProcessEnv | undefined,
  now: number,
  claimId: string,
  reason: string,
): void {
  const blocked = withQueueLock(env, () => {
    const rows = read(env);
    const row = rows.find((candidate) => candidate.id === id);
    if (!row || !isOpenClaim(row) || row.claim_id !== claimId) {
      return undefined;
    }
    const isBlocked = failClaim(row, now, reason);
    write(rows, now, env);
    const transition: QueueTransition | undefined = isBlocked
      ? { kind: "blocked", item: { ...row }, seq: nextSeq() }
      : undefined;
    return transition;
  });
  if (blocked) {
    announce(blocked);
  }
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
  epoch = GATEWAY_EPOCH,
): TrunkQueueClaim | undefined {
  const claimed = withQueueLock(env, () => {
    const rows = read(env);
    const holds = rows.some((row) => isOpenClaim(row) && row.claimed_by === agentId);
    const next = holds ? undefined : rows.filter(isClaimable).toSorted(byPriority)[0];
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
      gateway_epoch: epoch,
    });
    write(rows, now, env);
    const transition: QueueTransition = {
      kind: "claimed",
      item: { ...claim },
      agentId,
      seq: nextSeq(),
    };
    return { claim, transition };
  });
  if (!claimed) {
    return undefined;
  }
  announce(claimed.transition);
  return claimed.claim;
}

type ReaperParams = {
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  log?: (message: string) => void;
};

/**
 * A claim silent past the hard cap: stop its run first and free the job only once the run reports its end. A stop that
 * does not confirm is counted; after MAX_STOP_ATTEMPTS the claim is marked as needing a person and not retried.
 */
async function reapSilentClaim(params: ReaperParams, claim: ClaimRef): Promise<void> {
  const before = findClaim(params.env, claim);
  if (!before || (before.stop_attempts ?? 0) >= MAX_STOP_ATTEMPTS) {
    return;
  }
  const outcome = await stopSilentClaim(params.gateway, before);
  // Re-read after the stop: the run may have finished during it, which marks the job done and leaves it done.
  const after = findClaim(params.env, claim);
  if (!after) {
    return;
  }
  const at = (params.now ?? Date.now)();
  if (outcome === "stopped") {
    releaseClaimAnnounced(params.env, claim, at);
    params.log?.(
      `Stopped ${after.title} on ${claim.claimed_by} after 4 hours without finishing; it is back in the queue.`,
    );
    return;
  }
  const attempts = (after.stop_attempts ?? 0) + 1;
  const reason = `Couldn't stop ${after.title} on ${claim.claimed_by}; needs a person.`;
  updateClaim(params.env, claim, at, (row) => {
    row.stop_attempts = attempts;
    if (attempts >= MAX_STOP_ATTEMPTS) {
      row.attention_reason = reason;
    }
  });
  if (attempts >= MAX_STOP_ATTEMPTS) {
    params.log?.(reason);
  }
}

/** A claim with no run activity for the stale window: freed once its run has ended, or while its Trunk is working, kept. */
async function reapAbandonedClaim(
  params: ReaperParams,
  claim: ClaimRef,
  working: boolean,
): Promise<void> {
  const now = (params.now ?? Date.now)();
  const before = findClaim(params.env, claim);
  if (!before) {
    return;
  }
  if (working) {
    updateClaim(params.env, claim, now, (row) => {
      row.active_at = now;
    });
    return;
  }
  if (!isPastStaleTime(before, now) || !(await claimMayRelease(params.gateway, before))) {
    return;
  }
  const at = (params.now ?? Date.now)();
  releaseClaimAnnounced(params.env, claim, at);
}

/** Each pass: finds claims past the stale window and handles each one, re-reading the queue after every await. */
export async function releaseStaleQueueClaims(params: ReaperParams): Promise<void> {
  const now = params.now ?? Date.now;
  const candidates = read(params.env).filter(
    (row) => isOpenClaim(row) && isPastStaleTime(row, now()),
  );
  for (const candidate of candidates) {
    const claim = claimRef(candidate);
    // A Trunk that is not answering has no run we can see; its claim then goes only after the stale window.
    const working = (await probeWorking(params.gateway, candidate.claimed_by!)) ?? false;
    const row = findClaim(params.env, claim);
    if (!row) {
      continue;
    }
    if (now() - (row.active_at ?? row.claimed_at ?? now()) >= HARD_CLAIM_CAP_MS) {
      await reapSilentClaim(params, claim);
    } else {
      await reapAbandonedClaim(params, claim, working);
    }
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
      idempotencyKey: queueRunId(id, claimId),
    });
  } catch (error) {
    if (isTrunkUnavailableError(error)) {
      releaseUnavailableClaim(id, params.env, now(), claimId);
    } else {
      failQueueClaim(
        id,
        params.env,
        now(),
        claimId,
        `the brief could not be sent: ${errorText(error)}`,
      );
    }
    throw error;
  } finally {
    dispatchingClaimIds.delete(claimId);
  }
  return { item, threadKey };
}

/**
 * Tries one Trunk. A Trunk that is not ready is skipped until its retry time, so no job is claimed for it in between.
 * An UNAVAILABLE refusal marks the Trunk and returns; any other error still propagates.
 */
async function wakeOneTrunk(
  agentId: string,
  params: {
    gateway: TrunkQueueGateway;
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    availability?: TrunkAvailability;
  },
): Promise<boolean> {
  const { availability } = params;
  const now = (params.now ?? Date.now)();
  const held = availability?.unavailable.get(agentId);
  if (held && now < held.retryAt) {
    return false;
  }
  try {
    const picked = await pickUpQueuedWork({ ...params, agentId, idleWaitMs: 0 });
    if (availability?.unavailable.delete(agentId)) {
      availability.report?.(agentId, "available", "");
    }
    return picked !== undefined;
  } catch (error) {
    if (!isTrunkUnavailableError(error)) {
      throw error;
    }
    const detail = errorText(error);
    availability?.unavailable.set(agentId, { detail, retryAt: now + UNAVAILABLE_RETRY_MS });
    availability?.report?.(agentId, "unavailable", detail);
    return false;
  }
}

/**
 * A card was added or a claim was released: hand the top queued job to each idle Trunk in turn, one job per
 * Trunk. A Trunk that is not ready is skipped and the others still get work. Any other error stops the pass, so the
 * rest of the Trunks are not asked too; the claim that failed is already released. Returns the Trunks that took a job.
 */
export async function wakeIdleTrunks(params: {
  agentIds: string[];
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  availability?: TrunkAvailability;
  log?: (message: string) => void;
}): Promise<string[]> {
  await releaseStaleQueueClaims(params);
  const woken: string[] = [];
  for (const agentId of params.agentIds) {
    if (!read(params.env).some(isClaimable)) {
      break;
    }
    if (await wakeOneTrunk(agentId, params)) {
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
    let live: boolean;
    try {
      live = await isClaimThreadLive(
        params.gateway,
        candidate.claimed_by!,
        candidate.thread_key ?? "",
      );
    } catch (error) {
      if (isTrunkUnavailableError(error)) {
        continue;
      }
      throw error;
    }
    if (live || !(await claimMayRelease(params.gateway, candidate))) {
      continue;
    }
    const at = now();
    releaseClaimAnnounced(params.env, claimRef(candidate), at);
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
  availability?: TrunkAvailability;
  log?: (message: string) => void;
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
