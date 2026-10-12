// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-local-inference/src/services/downloader.ts (atlas MODELS-ACCOUNTS-0141)
//
// Resumable staging for verified llama.cpp downloads. A download that knows its
// SHA-256 up front writes to a deterministic `<destination>.part` file with an
// `.expected` sidecar naming the digest it was started against, so an
// interrupted or cancelled download continues from the bytes already on disk.
import type { Hash } from "node:crypto";
import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";

type ResponseHeaders = Record<string, string | string[] | undefined>;

const keptPartialErrors = new WeakSet<object>();
const freshRetryErrors = new WeakSet<object>();

/**
 * Byte offset the response body starts at, given the offset a resume asked
 * for. Only a `206 Partial Content` whose `Content-Range` begins exactly at
 * the requested offset may be appended to the partial file. Any other 2xx
 * (an origin that ignored `Range` and sent `200` with the full body) restarts
 * the file from byte 0. A 206 for a different range is unusable: returns
 * `null` so the caller discards it and re-requests the whole file.
 */
export function resolveResumeOffset(
  requestedStart: number,
  statusCode: number,
  headers: ResponseHeaders,
): number | null {
  if (requestedStart <= 0 || statusCode !== 206) {
    return 0;
  }
  const raw = headers["content-range"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  const match = /^bytes\s+(\d+)-\d+\/(?:\d+|\*)$/iu.exec(value);
  if (!match?.[1]) {
    return null;
  }
  return Number.parseInt(match[1], 10) === requestedStart ? requestedStart : null;
}

/** Deterministic staging path, so repeated attempts reuse the same partial file and resume. */
export function stagingPartPath(destination: string): string {
  return `${destination}.part`;
}

/** Sidecar recording which expected sha256 a `.part` file was started against. */
export function stagingMetaPath(stagingPath: string): string {
  return `${stagingPath}.expected`;
}

async function partialSize(stagingPath: string): Promise<number> {
  try {
    // lstat: a symlink planted at the staging path is never appended to.
    const stat = await fsp.lstat(stagingPath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    // No staging file (ENOENT) means zero bytes resumable: a fresh start.
    return 0;
  }
}

/** Removes a staged partial and its sidecar; cleanup failures only force a fresh start later. */
export async function discardStagedPartial(stagingPath: string): Promise<void> {
  await fsp.rm(stagingPath, { force: true }).catch(() => undefined);
  await fsp.rm(stagingMetaPath(stagingPath), { force: true }).catch(() => undefined);
}

/**
 * A `.part` file is resumable only when it was started against the SAME
 * content hash the current download expects. Model hubs re-publish files
 * under stable names, so a partial from a previous version must be
 * discarded: a Range resume would append new-version bytes onto old-version
 * bytes and only fail at the final sha256 gate, gigabytes later. A partial
 * with no sidecar has unknown provenance and is discarded too.
 */
export async function resumableStartByte(
  stagingPath: string,
  expectedSha256: string,
): Promise<number> {
  const size = await partialSize(stagingPath);
  if (size <= 0) {
    await fsp.rm(stagingMetaPath(stagingPath), { force: true }).catch(() => undefined);
    return 0;
  }
  const recorded = await fsp.readFile(stagingMetaPath(stagingPath), "utf8").then(
    (value) => value.trim().toLowerCase(),
    () => undefined,
  );
  if (recorded === expectedSha256.toLowerCase()) {
    return size;
  }
  await discardStagedPartial(stagingPath);
  return 0;
}

/** Opens the staged partial: a fresh file stamped with its sidecar, or the existing prefix for append. */
export async function openStagedPartial(params: {
  stagingPath: string;
  startByte: number;
  expectedSha256: string;
}): Promise<FileHandle> {
  if (params.startByte > 0) {
    return await fsp.open(params.stagingPath, "a", 0o600);
  }
  await discardStagedPartial(params.stagingPath);
  await fsp.writeFile(
    stagingMetaPath(params.stagingPath),
    `${params.expectedSha256.toLowerCase()}\n`,
    { mode: 0o600 },
  );
  return await fsp.open(params.stagingPath, "wx", 0o600);
}

/** Feeds the bytes already staged into the running digest before the resumed tail. */
export async function hashStagedPrefix(params: {
  stagingPath: string;
  length: number;
  hash: Hash;
  signal?: AbortSignal;
}): Promise<void> {
  const stream = fs.createReadStream(params.stagingPath, {
    start: 0,
    end: params.length - 1,
    signal: params.signal,
  });
  for await (const chunk of stream) {
    params.hash.update(chunk as Buffer);
  }
}

/** Marks an interruption (network, abort) whose staged bytes stay on disk for the next attempt. */
export function keepStagedPartial(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    keptPartialErrors.add(error);
  }
  return error;
}

/** Marks a failure after which a resumed partial is discarded and the file fetched again from byte 0. */
export function retryStagedFresh(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    freshRetryErrors.add(error);
  }
  return error;
}

export function isStagedPartialKept(error: unknown): boolean {
  return typeof error === "object" && error !== null && keptPartialErrors.has(error);
}

export function isStagedFreshRetry(error: unknown): boolean {
  return typeof error === "object" && error !== null && freshRetryErrors.has(error);
}
