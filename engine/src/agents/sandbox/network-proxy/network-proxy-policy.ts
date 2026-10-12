// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/community/aio_sandbox/network_proxy.py (atlas SAFETY-0044)
/**
 * Sandbox network policy store for the proxy sidecar: allowlist matching, public-address
 * checks, denial events, and temporary or sandbox-lifetime grants. Node builtins only.
 */
import { randomUUID } from "node:crypto";
import net from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { domainToASCII } from "node:url";

export const NETWORK_PROXY_ENV = {
  policyDb: "BRANCH_POLICY_DB",
  mode: "BRANCH_NETWORK_MODE",
  allowDomainsJson: "BRANCH_ALLOW_DOMAINS_JSON",
  recordDenials: "BRANCH_RECORD_DENIALS",
  allowSyntheticDns: "BRANCH_ALLOW_SYNTHETIC_DNS",
} as const;
export const NETWORK_POLICY_DECISIONS = ["deny", "allow_temporary", "allow_sandbox"] as const;
export type NetworkPolicyDecision = (typeof NETWORK_POLICY_DECISIONS)[number];

const DEFAULT_POLICY_DB = "/tmp/branch-network-policy.sqlite3";

export type NetworkPolicyEvent = {
  request_id: string;
  host: string;
  port: number;
  method: string;
  created_at: number;
};

/** Wall clock in seconds; mutable so tests can pin time like the upstream monkeypatch. */
export const policyClock = { now: (): number => Date.now() / 1000 };

function openPolicyDb(): DatabaseSync {
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const path = process.env[NETWORK_PROXY_ENV.policyDb] ?? DEFAULT_POLICY_DB;
  const db = new sqlite.DatabaseSync(path, { timeout: 5_000 });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    request_id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    method TEXT NOT NULL,
    created_at REAL NOT NULL,
    surfaced INTEGER NOT NULL DEFAULT 0,
    decision TEXT
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS grants (
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    expires_at REAL,
    PRIMARY KEY (host, port)
  )`);
  return db;
}

/** Runs one policy-store transaction; immediate transactions serialize read-before-write. */
export function withPolicyDb<T>(run: (db: DatabaseSync) => T, immediate = false): T {
  const db = openPolicyDb();
  try {
    db.exec(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
    try {
      const result = run(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

function encodeIdna(host: string): string | null {
  // Python's idna codec keeps ASCII labels and rejects empty or over-long labels.
  // oxlint-disable-next-line no-control-regex -- the ASCII range is the codec boundary.
  const ascii = /^[\x00-\x7f]*$/u.test(host) ? host : domainToASCII(host);
  if (!ascii) {
    return null;
  }
  const labels = ascii.split(".");
  return labels.some((label) => label.length === 0 || label.length > 63) ? null : ascii;
}

export function normalizeHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.+$/u, "");
  // oxlint-disable-next-line no-control-regex -- NUL and line breaks are rejected outright.
  if (!host || host.length > 253 || /[/\\\0\r\n]/u.test(host)) {
    return null;
  }
  return encodeIdna(host);
}

export function domainMatches(host: string, rule: string): boolean {
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(2);
    return host.endsWith(`.${suffix}`) && host !== suffix;
  }
  return host === rule;
}

function parseIpv4(text: string): number | null {
  if (!net.isIPv4(text)) {
    return null;
  }
  return text.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

function parseHextetList(part: string): number[] {
  return part ? part.split(":").map((hex) => Number.parseInt(hex, 16)) : [];
}

function parseIpv6Hextets(text: string): number[] | null {
  if (!net.isIPv6(text)) {
    return null;
  }
  let body = text;
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/u.exec(body)?.[1];
  if (dotted) {
    const v4 = parseIpv4(dotted) ?? 0;
    tail.push(Math.floor(v4 / 65_536), v4 % 65_536);
    body = body.slice(0, -dotted.length);
    body = body.endsWith("::") ? body : body.replace(/:$/u, "");
  }
  const parts = body.split("::");
  const left = parseHextetList(parts[0] ?? "");
  const right = [...parseHextetList(parts[1] ?? ""), ...tail];
  const fillLength = parts.length === 2 ? 8 - left.length - right.length : 0;
  const hextets = [...left, ...Array<number>(Math.max(fillLength, 0)).fill(0), ...right];
  return hextets.length === 8 ? hextets : null;
}

function inIpv4Cidr(ip: number, base: string, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(ip / size) === Math.floor((parseIpv4(base) ?? 0) / size);
}

function inIpv6Cidr(ip: readonly number[], base: string, prefix: number): boolean {
  const network = parseIpv6Hextets(base) ?? [];
  for (let index = 0; index < 8; index += 1) {
    const bits = Math.max(0, Math.min(16, prefix - index * 16));
    const mask = bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff;
    if (((ip[index] ?? 0) & mask) !== ((network[index] ?? 0) & mask)) {
      return false;
    }
  }
  return true;
}

// Python ipaddress non-global registries plus multicast and deprecated site-local space.
const NON_PUBLIC_IPV4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];
const NON_PUBLIC_IPV6: ReadonlyArray<readonly [string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

export function addressIsPublic(
  address: string,
  options: { allowSyntheticDns?: boolean } = {},
): boolean {
  const text = address.split("%", 1)[0] ?? "";
  const v4 = parseIpv4(text);
  if (v4 !== null) {
    if (!NON_PUBLIC_IPV4.some(([base, prefix]) => inIpv4Cidr(v4, base, prefix))) {
      return true;
    }
    // Docker Desktop's DNS inhibition layer maps public names into the
    // benchmarking-only 198.18.0.0/15 range. Accept it only when the host
    // backend explicitly identifies Desktop; native Linux keeps rejecting it.
    return options.allowSyntheticDns === true && inIpv4Cidr(v4, "198.18.0.0", 15);
  }
  const v6 = parseIpv6Hextets(text);
  return v6 !== null && !NON_PUBLIC_IPV6.some(([base, prefix]) => inIpv6Cidr(v6, base, prefix));
}

function staticRules(): string[] {
  try {
    const raw: unknown = JSON.parse(process.env[NETWORK_PROXY_ENV.allowDomainsJson] ?? "[]");
    return Array.isArray(raw)
      ? raw.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function policyMode(): "isolated" | "allowlist" {
  return process.env[NETWORK_PROXY_ENV.mode] === "allowlist" ? "allowlist" : "isolated";
}

function isGranted(host: string, port: number, now: number): boolean {
  return withPolicyDb((db) => {
    const row = db
      .prepare("SELECT expires_at FROM grants WHERE host = ? AND port = ?")
      .get(host, port) as { expires_at: number | null } | undefined;
    if (row === undefined) {
      return false;
    }
    if (row.expires_at !== null && Number(row.expires_at) <= now) {
      db.prepare("DELETE FROM grants WHERE host = ? AND port = ?").run(host, port);
      return false;
    }
    return true;
  });
}

export function policyAllows(host: string, port: number, now?: number): boolean {
  const at = now ?? policyClock.now();
  if (policyMode() !== "allowlist") {
    return false;
  }
  if (staticRules().some((rule) => domainMatches(host, rule))) {
    return true;
  }
  return isGranted(host, port, at);
}

export function recordDenial(host: string, port: number, method: string): string {
  const now = policyClock.now();
  // Serialize the read-before-insert deduplication so simultaneous proxy
  // requests cannot create multiple approval cards for one destination.
  return withPolicyDb((db) => {
    const recent = db
      .prepare(
        "SELECT request_id FROM events WHERE host = ? AND port = ? AND decision IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(host, port, now - 30) as { request_id: string } | undefined;
    if (recent !== undefined) {
      return String(recent.request_id);
    }
    const requestId = randomUUID();
    db.prepare(
      "INSERT INTO events(request_id, host, port, method, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(requestId, host, port, method, now);
    return requestId;
  }, true);
}

function claimOldestUnsurfacedEvent(db: DatabaseSync): NetworkPolicyEvent | undefined {
  const claimed = db
    .prepare(
      "SELECT request_id, host, port, method, created_at FROM events WHERE surfaced = 0 AND decision IS NULL ORDER BY created_at LIMIT 1",
    )
    .get() as NetworkPolicyEvent | undefined;
  if (claimed !== undefined) {
    db.prepare("UPDATE events SET surfaced = 1 WHERE request_id = ?").run(claimed.request_id);
    // One approval makes one destination decision. Close any sibling denials
    // from the same tool call so a later retry records a fresh event instead
    // of leaving an invisible surfaced request.
    db.exec("UPDATE events SET decision = 'superseded' WHERE surfaced = 0 AND decision IS NULL");
  }
  return claimed;
}

export function pendingEvents(): NetworkPolicyEvent[] {
  // Tool execution timestamps cannot reliably delimit proxy events: a
  // background process may emit a denial after its launching tool returns,
  // and non-interactive paths must drain events without prompting.
  // Claim the oldest unsurfaced event atomically, independent of age.
  const row = withPolicyDb(claimOldestUnsurfacedEvent, true);
  if (row === undefined) {
    return [];
  }
  return [
    {
      request_id: String(row.request_id),
      host: String(row.host),
      port: Number(row.port),
      method: String(row.method),
      created_at: Number(row.created_at),
    },
  ];
}

/** Atomically deny every event that has not been surfaced to a user. */
export function denyPendingEvents(): number {
  return withPolicyDb((db) => {
    const result = db
      .prepare(
        "UPDATE events SET surfaced = 1, decision = 'deny' WHERE surfaced = 0 AND decision IS NULL",
      )
      .run();
    return Math.max(Number(result.changes), 0);
  }, true);
}

function writeGrant(db: DatabaseSync, host: string, port: number, expiresAt: number | null) {
  db.prepare(
    "INSERT INTO grants(host, port, expires_at) VALUES (?, ?, ?) ON CONFLICT(host, port) DO UPDATE SET expires_at = excluded.expires_at",
  ).run(host, port, expiresAt);
}

export function decide(requestId: string, decision: string, ttl: number): boolean {
  return withPolicyDb((db) => {
    const row = db
      .prepare("SELECT host, port, decision FROM events WHERE request_id = ?")
      .get(requestId) as { host: string; port: number; decision: string | null } | undefined;
    if (row === undefined) {
      return false;
    }
    if (row.decision !== null) {
      return String(row.decision) === decision;
    }
    if (decision === "allow_temporary") {
      writeGrant(db, String(row.host), Number(row.port), policyClock.now() + ttl);
    } else if (decision === "allow_sandbox") {
      writeGrant(db, String(row.host), Number(row.port), null);
    } else if (decision !== "deny") {
      return false;
    }
    db.prepare("UPDATE events SET decision = ? WHERE request_id = ?").run(decision, requestId);
    return true;
  });
}

export function isNetworkPolicyDecision(value: unknown): value is NetworkPolicyDecision {
  return (NETWORK_POLICY_DECISIONS as readonly unknown[]).includes(value);
}
