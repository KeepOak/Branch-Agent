/** Per-user gateway rendezvous, adapted from Hermes' gateway/host_rendezvous.py. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { isPidAlive } from "../shared/pid-alive.js";
import { acquireFileLockSync } from "./file-lock-manager.js";
import { readGatewayLockProcessStartTime } from "./gateway-lock-process.js";
import { writePrivateSecretFileAtomic } from "./secret-file.js";
import { createPrivateWindowsFile } from "./windows-private-directory.js";
import { decideHostAttach, type HostAttachDecision, type HostGateway } from "./host-attach.js";

export const HOST_PROTOCOL_VERSION = 1;
export const HOST_IDENTITY_PATH = "/api/host/identity";
const PROBE_TIMEOUT_MS = 2_000;
const ATTACH_CHANNEL_WAIT_MS = 5_000;

export type HostRecord = {
  role: "gateway";
  pid: number;
  createTime: number | null;
  host: string;
  port: number;
  gatewayPort: number;
  protocolVersion: number;
  tokenFingerprint: string;
  profiles: string[];
  updatedAt: string;
  home: string;
};

export type HostRendezvous = {
  decision: HostAttachDecision;
  markStarting?: () => Promise<void>;
  markReady?: (gatewayPort?: number) => Promise<void>;
  close?: () => Promise<void>;
};

function processStart(pid: number): number | null {
  return readGatewayLockProcessStartTime(pid, process.platform, 1_000);
}

function sameProcess(record: Pick<HostRecord, "pid" | "createTime">): boolean {
  if (!isPidAlive(record.pid)) {
    return false;
  }
  const actual = processStart(record.pid);
  return record.createTime === null || actual === null || actual === record.createTime;
}

function isHostLockOwner(value: unknown): value is Pick<HostRecord, "pid" | "createTime"> {
  if (typeof value !== "object" || value === null) return false;
  if (!("pid" in value) || !("createTime" in value)) return false;
  const { pid, createTime } = value;
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 &&
    (createTime === null || (typeof createTime === "number" && Number.isFinite(createTime)));
}

function parseHostLockOwner(raw: string): Pick<HostRecord, "pid" | "createTime"> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isHostLockOwner(value) ? value : null;
  } catch {
    return null;
  }
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The lock is shared by profiles of a tenant, but not by another BRANCH_HOME tenant. */
export function resolveHostStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.BRANCH_GATEWAY_HOST_LOCK_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  const osHome = path.resolve(os.homedir());
  const tenantHome = path.resolve(env.BRANCH_HOME?.trim() || osHome);
  const tenantKey = createHash("sha256")
    .update(process.platform === "win32" ? tenantHome.toLowerCase() : tenantHome)
    .digest("hex")
    .slice(0, 12);
  return path.join(osHome, ".branch", "host", tenantKey);
}

export function hostRecordPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHostStateDir(env), "host-gateway.json");
}

function hostTokenPath(env: NodeJS.ProcessEnv): string {
  return path.join(resolveHostStateDir(env), "host-gateway.token");
}

function hostLockPath(env: NodeJS.ProcessEnv): string {
  return path.join(resolveHostStateDir(env), "host-gateway.lock");
}

export function parseHostRecord(value: unknown): HostRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const item = value as Partial<HostRecord>;
  if (
    item.role !== "gateway" ||
    !Number.isInteger(item.pid) ||
    !Number.isInteger(item.port) ||
    !Number.isInteger(item.gatewayPort) ||
    typeof item.home !== "string" ||
    typeof item.tokenFingerprint !== "string" ||
    !Array.isArray(item.profiles) ||
    item.profiles.some((profile) => typeof profile !== "string")
  ) {
    return undefined;
  }
  return item as HostRecord;
}

export async function readHostRecord(
  env: NodeJS.ProcessEnv = process.env,
  includeStale = false,
): Promise<HostRecord | undefined> {
  try {
    const pathname = hostRecordPath(env);
    const stat = await fs.stat(pathname);
    if (process.platform !== "win32") {
      const parent = await fs.stat(path.dirname(pathname));
      if (
        stat.uid !== process.getuid?.() ||
        parent.uid !== process.getuid?.() ||
        (stat.mode & 0o077) ||
        (parent.mode & 0o077)
      ) {
        return undefined;
      }
    }
    const record = parseHostRecord(JSON.parse(await fs.readFile(pathname, "utf8")));
    if (!record || (!includeStale && (record.protocolVersion !== HOST_PROTOCOL_VERSION || !sameProcess(record)))) {
      return undefined;
    }
    return record;
  } catch {
    return undefined;
  }
}

async function readHostToken(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    return (await fs.readFile(hostTokenPath(env), "utf8")).trim();
  } catch {
    return "";
  }
}

/** A record alone is never an attach verdict: this endpoint must prove the owner is live. */
export async function probeHostOwner(
  record: HostRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HostGateway | undefined> {
  if (record.protocolVersion !== HOST_PROTOCOL_VERSION || !sameProcess(record)) {
    return undefined;
  }
  const token = await readHostToken(env);
  if (!token || fingerprint(token) !== record.tokenFingerprint) {
    return undefined;
  }
  const host = ["0.0.0.0", "::", "*", ""].includes(record.host) ? "127.0.0.1" : record.host;
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    return undefined;
  }
  try {
    const identity = await new Promise<Partial<HostRecord> & { ready?: boolean }>((resolve, reject) => {
      const request = http.get(
        {
          hostname: host,
          port: record.port,
          path: HOST_IDENTITY_PATH,
          agent: false,
          timeout: PROBE_TIMEOUT_MS,
          headers: { Authorization: `Bearer ${token}`, Connection: "close" },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Host identity returned ${response.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 65_536) {
              request.destroy(new Error("Host identity response too large"));
              return;
            }
            chunks.push(chunk);
          });
          response.once("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
              reject(error);
            }
          });
          response.once("error", reject);
        },
      );
      request.once("timeout", () => request.destroy(new Error("Host identity probe timed out")));
      request.once("error", reject);
    });
    if (
      identity.role !== record.role ||
      identity.pid !== record.pid ||
      identity.createTime !== record.createTime ||
      path.resolve(identity.home || "") !== path.resolve(record.home) ||
      identity.gatewayPort !== record.gatewayPort
    ) {
      return undefined;
    }
    return {
      pid: record.pid,
      home: record.home,
      port: record.gatewayPort,
      profiles: identity.ready ? (identity.profiles ?? []) : [],
      servedKnown: identity.ready === true,
      standalone: true,
    };
  } catch {
    return undefined;
  }
}

async function waitForHostOwner(env: NodeJS.ProcessEnv): Promise<HostGateway | undefined> {
  const deadline = Date.now() + ATTACH_CHANNEL_WAIT_MS;
  do {
    const record = await readHostRecord(env);
    if (record) {
      const owner = await probeHostOwner(record, env);
      if (owner?.servedKnown) {
        return owner;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  const record = await readHostRecord(env);
  return record ? await probeHostOwner(record, env) : undefined;
}

async function publishRecord(record: HostRecord, token: string, env: NodeJS.ProcessEnv): Promise<void> {
  const rootDir = resolveHostStateDir(env);
  await fs.mkdir(rootDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await fs.chmod(rootDir, 0o700);
  }
  await writeHostPrivateFile(rootDir, hostTokenPath(env), token);
  await writeHostPrivateFile(rootDir, hostRecordPath(env), JSON.stringify(record) + "\n");
}

async function writeHostPrivateFile(rootDir: string, filePath: string, content: string): Promise<void> {
  if (process.platform !== "win32") {
    await writePrivateSecretFileAtomic({ rootDir, filePath, content });
    return;
  }
  // Node's 0o600 mode does not set a Windows DACL. Create the replacement with
  // Branch's protected owner/SYSTEM ACL before its name becomes visible.
  const temporary = path.join(rootDir, `.host-${randomUUID()}.tmp`);
  const descriptor = createPrivateWindowsFile(temporary);
  let writeError: unknown;
  try {
    fsSync.writeFileSync(descriptor, content, "utf8");
  } catch (error) {
    writeError = error;
  } finally {
    fsSync.closeSync(descriptor);
  }
  if (writeError) {
    await fs.rm(temporary, { force: true });
    throw writeError;
  }
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function clearOwnRecord(record: HostRecord, env: NodeJS.ProcessEnv): Promise<void> {
  const current = await readHostRecord(env, true);
  if (current?.pid !== record.pid || current.createTime !== record.createTime) {
    return;
  }
  await Promise.allSettled([fs.unlink(hostRecordPath(env)), fs.unlink(hostTokenPath(env))]);
}

function lockHeldByOther(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "file_lock_timeout" || code === "file_lock_stale";
}

/** Claim the host before starting the gateway's state lock; retain it through shutdown. */
export async function prepareHostRendezvous(params: {
  env?: NodeJS.ProcessEnv;
  profile: string;
  home: string;
  gatewayPort: number;
  force?: boolean;
  replace?: boolean;
  allowInTests?: boolean;
}): Promise<HostRendezvous> {
  // Gateway bootstrap may rebuild process.env after the early host claim.
  const env = { ...(params.env ?? process.env) };
  if (params.force || (!params.allowInTests && (env.VITEST || env.NODE_ENV === "test"))) {
    return { decision: { outcome: "start", message: "" } };
  }
  const existing = await readHostRecord(env);
  const live = existing ? await probeHostOwner(existing, env) : undefined;
  const decide = async (owner: HostGateway | undefined) =>
    await decideHostAttach({
      profile: params.profile,
      owner,
      replace: params.replace,
      waitForOwner: () => waitForHostOwner(env),
    });
  if (live) {
    const decision = await decide(live);
    if (decision.outcome === "start") {
      return { decision };
    }
    if (decision.outcome !== "replace-host") {
      return { decision };
    }
    // The owner identity has been authenticated, and --replace was explicit.
    process.kill(live.pid, "SIGTERM");
    const deadline = Date.now() + ATTACH_CHANNEL_WAIT_MS;
    while (Date.now() < deadline && sameProcess(existing!)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const dir = resolveHostStateDir(env);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    await fs.chmod(dir, 0o700);
  }
  const lockPath = hostLockPath(env);
  let lock: ReturnType<typeof acquireFileLockSync>;
  try {
    lock = acquireFileLockSync(lockPath, {
      lockPath,
      timeoutMs: 0,
      retry: { retries: 0 },
      staleRecovery: "remove-if-unchanged",
      payload: () => ({ pid: process.pid, createTime: processStart(process.pid) }),
      parsePayload: parseHostLockOwner,
      shouldReclaim: ({ payload }) =>
        Boolean(isHostLockOwner(payload) && !sameProcess(payload)),
      shouldRemoveStaleLock: ({ payload }) =>
        Boolean(isHostLockOwner(payload) && !sameProcess(payload)),
    });
  } catch (error) {
    if (!lockHeldByOther(error)) {
      throw error;
    }
    const owner = await waitForHostOwner(env);
    return {
      decision: owner
        ? await decide(owner)
        : {
            outcome: "refuse",
            message: "A gateway already owns this host but has not answered its control endpoint; retry shortly.",
            transient: true,
          },
    };
  }
  const token = randomBytes(32).toString("hex");
  const record: HostRecord = {
    role: "gateway",
    pid: process.pid,
    createTime: processStart(process.pid),
    host: "127.0.0.1",
    port: 0,
    gatewayPort: params.gatewayPort,
    protocolVersion: HOST_PROTOCOL_VERSION,
    tokenFingerprint: fingerprint(token),
    profiles: [],
    updatedAt: new Date().toISOString(),
    home: path.resolve(params.home),
  };
  let ready = false;
  const server = http.createServer((request, response) => {
    if (!sameToken(request.headers.authorization?.replace(/^Bearer /, "") ?? "", token)) {
      response.writeHead(401).end();
      return;
    }
    if (request.method === "GET" && request.url === HOST_IDENTITY_PATH) {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ...record, ready }));
      return;
    }
    response.writeHead(404).end();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Host rendezvous listener did not bind");
    }
    record.port = address.port;
    await publishRecord(record, token, env);
  } catch (error) {
    server.close();
    lock.release();
    throw error;
  }
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await clearOwnRecord(record, env);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      lock.release();
    })());
  const onExit = () => {
    try {
      const current = parseHostRecord(JSON.parse(fsSync.readFileSync(hostRecordPath(env), "utf8")));
      if (current?.pid === record.pid && current.createTime === record.createTime) {
        fsSync.unlinkSync(hostRecordPath(env));
        fsSync.unlinkSync(hostTokenPath(env));
      }
    } catch {
      // The normal async close may already have removed the record.
    }
  };
  process.once("exit", onExit);
  return {
    decision: { outcome: "start", message: "" },
    markStarting: async () => {
      ready = false;
      record.profiles = [];
      record.updatedAt = new Date().toISOString();
      await publishRecord(record, token, env);
    },
    markReady: async (gatewayPort) => {
      ready = true;
      if (gatewayPort !== undefined) {
        record.gatewayPort = gatewayPort;
      }
      record.profiles = [params.profile];
      record.updatedAt = new Date().toISOString();
      await publishRecord(record, token, env);
    },
    close: async () => {
      await close();
      process.removeListener("exit", onExit);
    },
  };
}
