// A joined Branch has an outbound-only link to its host. The host keeps work for that device until the
// joined gateway polls it, and retains the result so the sender can observe completion across reconnects.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export type GraftWork = {
  id: string;
  deviceId: string;
  trunkId: string;
  text: string;
  sourceSessionKey: string;
  sourceAgentId: string;
  idempotencyKey?: string;
  createdAt: number;
  claimedAt?: number;
  completedAt?: number;
  deliveryState?: "pending" | "delivered";
  deliveredAt?: number;
  reply?: string;
  error?: string;
};

const CLAIM_MS = 15 * 60_000;
const RETAIN_COMPLETED_MS = 7 * 24 * 60 * 60_000;

function file(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "graft", "work.json");
}

function read(env?: NodeJS.ProcessEnv): GraftWork[] {
  let text: string;
  try {
    text = fs.readFileSync(file(env), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const rows: unknown = JSON.parse(text);
  if (
    !Array.isArray(rows) ||
    !rows.every(
      (row) =>
        Boolean(row) &&
        typeof row.id === "string" &&
        typeof row.deviceId === "string" &&
        typeof row.trunkId === "string" &&
        typeof row.text === "string" &&
        typeof row.sourceSessionKey === "string" &&
        typeof row.sourceAgentId === "string" &&
        typeof row.createdAt === "number" &&
        Number.isFinite(row.createdAt) &&
        ["claimedAt", "completedAt", "deliveredAt"].every(
          (key) =>
            row[key] === undefined || (typeof row[key] === "number" && Number.isFinite(row[key])),
        ) &&
        ["reply", "error", "idempotencyKey"].every(
          (key) => row[key] === undefined || typeof row[key] === "string",
        ) &&
        (row.deliveryState === undefined ||
          row.deliveryState === "pending" ||
          row.deliveryState === "delivered"),
    )
  ) {
    throw new Error("Invalid Graft work store; refusing to overwrite it.");
  }
  return rows as GraftWork[];
}

function write(rows: GraftWork[], env?: NodeJS.ProcessEnv): void {
  const target = file(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify(rows.filter((row) => !row.completedAt || row.deliveryState === "pending" || Date.now() - row.completedAt < RETAIN_COMPLETED_MS))}\n`,
  );
  fs.renameSync(tmp, target);
}

export function enqueueGraftWork(
  input: Omit<GraftWork, "id" | "createdAt">,
  env?: NodeJS.ProcessEnv,
): GraftWork {
  const rows = read(env);
  const existing = input.idempotencyKey
    ? rows.find(
        (row) => row.deviceId === input.deviceId && row.idempotencyKey === input.idempotencyKey,
      )
    : undefined;
  if (existing) {
    return existing;
  }
  const job = { ...input, id: randomUUID(), createdAt: Date.now() };
  rows.push(job);
  write(rows, env);
  return job;
}

export function claimGraftWork(
  deviceId: string,
  env?: NodeJS.ProcessEnv,
  now = Date.now(),
): GraftWork | undefined {
  const rows = read(env);
  const job = rows.find(
    (row) =>
      row.deviceId === deviceId &&
      !row.completedAt &&
      (!row.claimedAt || now - row.claimedAt >= CLAIM_MS),
  );
  if (!job) {
    return undefined;
  }
  job.claimedAt = now;
  write(rows, env);
  return job;
}

export function completeGraftWork(
  id: string,
  deviceId: string,
  result: { reply?: string; error?: string },
  env?: NodeJS.ProcessEnv,
): GraftWork | undefined {
  const rows = read(env);
  const job = rows.find((row) => row.id === id && row.deviceId === deviceId);
  if (!job) {
    return undefined;
  }
  if (job.completedAt) {
    return job;
  }
  job.completedAt = Date.now();
  job.deliveryState = "pending";
  job.reply = result.reply;
  job.error = result.error;
  write(rows, env);
  return job;
}

export function getGraftWork(id: string, env?: NodeJS.ProcessEnv): GraftWork | undefined {
  return read(env).find((row) => row.id === id);
}

const delivering = new Set<string>();
/** Called on completion and on every authenticated device poll, including after a gateway restart. */
export async function deliverPendingGraftWork(
  deviceId: string,
  deliver: (job: GraftWork) => Promise<void>,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  for (const job of read(env).filter(
    (row) => row.deviceId === deviceId && row.deliveryState === "pending",
  )) {
    const key = `${file(env)}:${job.id}`;
    if (delivering.has(key)) {
      continue;
    }
    delivering.add(key);
    try {
      await deliver(job);
      // Re-read after the await: other completions may have changed the store meanwhile.
      const rows = read(env);
      const current = rows.find((row) => row.id === job.id && row.deviceId === deviceId);
      if (current?.deliveryState === "pending") {
        current.deliveryState = "delivered";
        current.deliveredAt = Date.now();
        write(rows, env);
      }
    } finally {
      delivering.delete(key);
    }
  }
}
