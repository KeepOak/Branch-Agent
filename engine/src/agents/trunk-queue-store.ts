// The Trunk queue's storage and row rules: the queue file, its read and write, the claim predicates, and the fenced
// read of a claim. Synchronous read-modify-write sections here are the queue's lock.
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

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
  /** The gateway process (epoch) that made this claim. Its run cannot outlive that process. */
  gateway_epoch?: string;
  /** Stop attempts that did not confirm for a silent claim. At MAX_STOP_ATTEMPTS the claim stops being retried. */
  stop_attempts?: number;
  /** Plain-English reason a claimed job needs a person, because its run could not be stopped. Cleared on release. */
  attention_reason?: string;
};

export type TrunkQueueStatus =
  | "queued"
  | "claimed"
  | "needs_attention"
  | "released"
  | "blocked"
  | "done";

/** The gateway calls a pickup needs: the Trunk's threads (is it idle?) and a new thread with the brief. */
export type TrunkQueueGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
};

export const STALE_CLAIM_MS = 2 * 60 * 60_000;
/** Failed claim attempts after which a job is blocked, so a broken job cannot re-dispatch forever. */
export const MAX_CLAIM_FAILURES = 3;
const RETAIN_DONE_MS = 7 * 24 * 60 * 60_000;

function file(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "trunks", "queue.json");
}

export function read(env?: NodeJS.ProcessEnv): TrunkQueueItem[] {
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

export function write(rows: TrunkQueueItem[], now: number, env?: NodeJS.ProcessEnv): void {
  const target = file(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const kept = rows.filter((row) => !row.done_at || now - row.done_at < RETAIN_DONE_MS);
  fs.writeFileSync(tmp, `${JSON.stringify(kept, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

export function isOpenClaim(row: TrunkQueueItem): boolean {
  return Boolean(row.claimed_by) && !row.done_at;
}

export function release(row: TrunkQueueItem, now: number): void {
  row.released_from = row.claimed_by;
  row.released_at = now;
  delete row.claimed_by;
  delete row.claimed_at;
  delete row.claim_id;
  delete row.thread_key;
  delete row.active_at;
  delete row.stop_attempts;
  delete row.attention_reason;
}

export function isPastStaleTime(row: TrunkQueueItem, now: number): boolean {
  return now - (row.active_at ?? row.claimed_at ?? now) >= STALE_CLAIM_MS;
}

export function isClaimable(row: TrunkQueueItem): boolean {
  return !row.done_at && !row.claimed_by && (row.failures ?? 0) < MAX_CLAIM_FAILURES;
}

/** Counts a failed attempt and puts the job back. At the cap the job is blocked with a plain reason. */
/** Highest priority first; the oldest job wins a tie. */
export function byPriority(a: TrunkQueueItem, b: TrunkQueueItem): number {
  return b.priority - a.priority || a.added_at - b.added_at;
}

/** The identity of one claim attempt: a later claim on the same job never matches it. */
export type ClaimRef = {
  id: string;
  claim_id?: string;
  claimed_by?: string;
  gateway_epoch?: string;
};

export function claimRef(row: TrunkQueueItem): ClaimRef {
  return {
    id: row.id,
    claim_id: row.claim_id,
    claimed_by: row.claimed_by,
    gateway_epoch: row.gateway_epoch,
  };
}

/**
 * The claim as the queue holds it now, or undefined once it is done, released, or taken by another claim. Called
 * after every await, so a result that landed during the await is seen.
 */
export function findClaim(
  env: NodeJS.ProcessEnv | undefined,
  claim: ClaimRef,
): TrunkQueueItem | undefined {
  return read(env).find(
    (row) =>
      row.id === claim.id &&
      isOpenClaim(row) &&
      row.claim_id === claim.claim_id &&
      row.claimed_by === claim.claimed_by &&
      row.gateway_epoch === claim.gateway_epoch,
  );
}

/**
 * The read-modify-write for a claim, as one synchronous section: the queue is read, the claim re-checked, changed and
 * written with nothing in between. That section is the queue's lock: the gateway is single-threaded, and no await runs
 * inside it. Returns false when the claim is no longer held.
 */
export function updateClaim(
  env: NodeJS.ProcessEnv | undefined,
  claim: ClaimRef,
  now: number,
  change: (row: TrunkQueueItem) => void,
): boolean {
  const rows = read(env);
  const row = rows.find(
    (candidate) =>
      candidate.id === claim.id &&
      isOpenClaim(candidate) &&
      candidate.claim_id === claim.claim_id &&
      candidate.claimed_by === claim.claimed_by &&
      candidate.gateway_epoch === claim.gateway_epoch,
  );
  if (!row) {
    return false;
  }
  change(row);
  write(rows, now, env);
  return true;
}
