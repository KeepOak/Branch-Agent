// A per-install queue of briefed jobs. The Coordinator adds jobs (queue_add); when a Trunk's run ends and it is
// idle, the gateway hands it the top unclaimed job in a new thread, the way trunk_send would. The queue lives in
// Branch's state folder and only the gateway writes it: each read-modify-write is synchronous, so two Trunks that
// finish together can never claim the same job. Same storage pattern as gateway/contacts/graft-work.ts.
import { randomUUID } from "node:crypto";
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
  /** Last run start or end of the claiming Trunk; a claim with none for STALE_CLAIM_MS is released. */
  active_at?: number;
  done_at?: number;
  released_at?: number;
  released_from?: string;
};

export type TrunkQueueStatus = "queued" | "claimed" | "released" | "done";

/** The gateway calls a pickup needs: the Trunk's threads (is it idle?) and a new thread with the brief. */
export type TrunkQueueGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
};

export const STALE_CLAIM_MS = 2 * 60 * 60_000;
const RETAIN_DONE_MS = 7 * 24 * 60 * 60_000;

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
  delete row.active_at;
}

/** Puts claims with no run activity for STALE_CLAIM_MS back in the queue, marked released. */
function releaseStale(rows: TrunkQueueItem[], now: number): boolean {
  let changed = false;
  for (const row of rows) {
    if (isOpenClaim(row) && now - (row.active_at ?? row.claimed_at ?? now) >= STALE_CLAIM_MS) {
      release(row, now);
      changed = true;
    }
  }
  return changed;
}

export function queueItemStatus(row: TrunkQueueItem): TrunkQueueStatus {
  if (row.done_at) {
    return "done";
  }
  if (row.claimed_by) {
    return "claimed";
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
}

export function listQueueItems(
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): Array<TrunkQueueItem & { status: TrunkQueueStatus }> {
  const rows = read(env);
  if (releaseStale(rows, now)) {
    write(rows, now, env);
  }
  return rows
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

/** Puts a stuck claim back in the queue and returns the job as it was before. */
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
  }
  return before;
}

/** Records run activity on the job a Trunk holds, so a working Trunk's claim is not released as stale. */
export function touchQueueClaim(agentId: string, env?: NodeJS.ProcessEnv, now = Date.now()): void {
  const rows = read(env);
  const row = rows.find((candidate) => isOpenClaim(candidate) && candidate.claimed_by === agentId);
  if (!row) {
    return;
  }
  row.active_at = now;
  write(rows, now, env);
}

/**
 * Claims the top unclaimed job for a Trunk; nothing when the queue is empty or the Trunk already holds one.
 * Synchronous from read to write, so concurrent pickups in the gateway never claim the same job.
 */
export function claimNextQueueItem(
  agentId: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): TrunkQueueItem | undefined {
  const rows = read(env);
  const stale = releaseStale(rows, now);
  const holds = rows.some((row) => isOpenClaim(row) && row.claimed_by === agentId);
  const next = holds
    ? undefined
    : rows.filter((row) => !row.done_at && !row.claimed_by).toSorted(byPriority)[0];
  if (next) {
    next.claimed_by = agentId;
    next.claimed_at = now;
    next.active_at = now;
  }
  if (next || stale) {
    write(rows, now, env);
  }
  return next;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});

/** A Trunk is working while any of its threads has a run: the same test trunks_list uses. */
async function isTrunkWorking(gw: TrunkQueueGateway, agentId: string): Promise<boolean> {
  const rows = rec(await gw.request("sessions.list", { agentId, limit: 50 })).sessions;
  return (Array.isArray(rows) ? rows.map(rec) : []).some(
    (row) =>
      row.hasActiveRun === true ||
      row.status === "running" ||
      (typeof row.activeWriterRunId === "string" && row.activeWriterRunId !== ""),
  );
}

/**
 * After a Trunk's run ends: when it is idle and holds no job, claim the top job and send its brief in a new
 * thread titled with the job title, as trunk_send does. Returns the job and thread, or undefined for no pickup.
 */
export async function pickUpQueuedWork(params: {
  agentId: string;
  gateway: TrunkQueueGateway;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): Promise<{ item: TrunkQueueItem; threadKey: string } | undefined> {
  const now = params.now ?? Date.now;
  // Empty queue: no gateway call, no thread.
  if (!read(params.env).some((row) => !row.done_at && !row.claimed_by)) {
    return undefined;
  }
  if (await isTrunkWorking(params.gateway, params.agentId)) {
    return undefined;
  }
  const item = claimNextQueueItem(params.agentId, params.env, now());
  if (!item) {
    return undefined;
  }
  const threadKey = `agent:${params.agentId}:queue-${item.id}`;
  try {
    await params.gateway.request("sessions.create", {
      key: threadKey,
      agentId: params.agentId,
      label: item.title,
    });
    await params.gateway.request("chat.send", {
      sessionKey: threadKey,
      agentId: params.agentId,
      message: item.brief_text,
      deliver: false,
      idempotencyKey: `trunk-queue-${item.id}`,
    });
  } catch (error) {
    releaseQueueItem(item.id, params.env, now());
    throw error;
  }
  return { item, threadKey };
}
