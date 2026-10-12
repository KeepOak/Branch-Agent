// AstrBotDevs/AstrBot@9d4f523464644554e0e8e50fa2a65f146e320cd1:astrbot/dashboard/services/api_key_service.py (atlas SAFETY-0099)
// Digest storage and the generic failure surface follow
// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/app/gateway/auth/pat.py.
/**
 * Scoped API keys for paired devices, agents, the SDK, widget and extension.
 *
 * A raw key is returned exactly once, from mint. Records keep only a SHA-256
 * digest and a short display prefix, so a stored record can never be turned
 * back into a working key. Keys can only carry scopes from the caller's
 * allow-list, may expire, and can be revoked one by one or for a whole
 * subject (a removed device loses every key it held).
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const SCOPED_API_KEY_PREFIX = "bak_";
const SCOPED_API_KEY_RANDOM_BYTES = 32;
const SCOPED_API_KEY_DISPLAY_PREFIX_LENGTH = 12;

export class ScopedApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedApiKeyError";
  }
}

/** Which scopes a key may hold, which scopes they pull in, and which need a parent. */
export type ScopedApiKeyPolicy = {
  allowed: readonly string[];
  defaults?: readonly string[];
  includes?: Readonly<Record<string, readonly string[]>>;
  requires?: Readonly<Record<string, string>>;
};

/** The only form a key is stored in. It never holds the raw key. */
export type ScopedApiKeyRecord = {
  keyId: string;
  name: string;
  subject: string;
  keyPrefix: string;
  digest: string;
  scopes: string[];
  createdAtMs: number;
  expiresAtMs?: number;
  revokedAtMs?: number;
};

export type ScopedApiKeyView = Omit<ScopedApiKeyRecord, "digest"> & {
  isRevoked: boolean;
  isExpired: boolean;
};

export type ScopedApiKeyVerdict =
  | { ok: true; record: ScopedApiKeyRecord }
  | { ok: false; status: 401; reason: "invalid" }
  | { ok: false; status: 403; reason: "scope"; missingScope: string };

/** Hex SHA-256 digest persisted in place of the raw key. */
export function scopedApiKeyDigest(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

function digestMatches(storedDigest: string, rawKey: string): boolean {
  const expected = Buffer.from(storedDigest, "hex");
  const actual = Buffer.from(scopedApiKeyDigest(rawKey), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function checkScopeParents(scopes: readonly string[], policy: ScopedApiKeyPolicy): void {
  for (const scope of scopes) {
    const parent = policy.requires?.[scope];
    if (parent && !scopes.includes(parent)) {
      throw new ScopedApiKeyError(scope + " requires the " + parent + " scope");
    }
  }
}

/** Validates requested scopes against the policy and expands included scopes. */
export function normalizeScopedApiKeyScopes(
  rawScopes: unknown,
  policy: ScopedApiKeyPolicy,
): string[] {
  const requested: unknown =
    rawScopes === undefined || rawScopes === null ? [...(policy.defaults ?? [])] : rawScopes;
  if (!Array.isArray(requested)) {
    throw new ScopedApiKeyError("Invalid scopes");
  }
  const scopes: string[] = [];
  const invalid: string[] = [];
  for (const scope of requested as unknown[]) {
    if (typeof scope === "string" && policy.allowed.includes(scope)) {
      scopes.push(scope);
    } else {
      invalid.push(String(scope));
    }
  }
  if (invalid.length > 0) {
    throw new ScopedApiKeyError("Invalid scopes: " + invalid.join(", "));
  }
  checkScopeParents(scopes, policy);
  const included = scopes.flatMap((scope) => policy.includes?.[scope] ?? []);
  const normalized = [...new Set([...scopes, ...included])];
  if (normalized.length === 0) {
    throw new ScopedApiKeyError("At least one valid scope is required");
  }
  return normalized;
}

function resolveExpiresAtMs(expiresInMs: number | undefined, nowMs: number): number | undefined {
  if (expiresInMs === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(expiresInMs) || expiresInMs <= 0) {
    throw new ScopedApiKeyError("expiresInMs must be a positive integer");
  }
  return nowMs + expiresInMs;
}

/** Mints a key. The raw key is in the result only; keep and show it once. */
export function mintScopedApiKey(params: {
  subject: string;
  name?: string;
  scopes?: unknown;
  policy: ScopedApiKeyPolicy;
  expiresInMs?: number;
  nowMs?: number;
}): { rawKey: string; record: ScopedApiKeyRecord } {
  const subject = params.subject.trim();
  if (!subject) {
    throw new ScopedApiKeyError("Missing key subject");
  }
  const nowMs = params.nowMs ?? Date.now();
  const scopes = normalizeScopedApiKeyScopes(params.scopes, params.policy);
  const expiresAtMs = resolveExpiresAtMs(params.expiresInMs, nowMs);
  const rawKey =
    SCOPED_API_KEY_PREFIX + randomBytes(SCOPED_API_KEY_RANDOM_BYTES).toString("base64url");
  const record: ScopedApiKeyRecord = {
    keyId: randomUUID(),
    name: params.name?.trim() || "Untitled API Key",
    subject,
    keyPrefix: rawKey.slice(0, SCOPED_API_KEY_DISPLAY_PREFIX_LENGTH),
    digest: scopedApiKeyDigest(rawKey),
    scopes,
    createdAtMs: nowMs,
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
  };
  return { rawKey, record };
}

function isLive(record: ScopedApiKeyRecord, nowMs: number): boolean {
  if (record.revokedAtMs !== undefined) {
    return false;
  }
  return record.expiresAtMs === undefined || record.expiresAtMs > nowMs;
}

/**
 * Checks a presented key. Malformed, unknown, revoked and expired keys share
 * one 401 verdict so a caller cannot learn which check failed; a live key
 * without the required scope gets 403.
 */
export function verifyScopedApiKey(params: {
  rawKey: string | undefined;
  records: Iterable<ScopedApiKeyRecord>;
  requiredScope?: string;
  nowMs?: number;
}): ScopedApiKeyVerdict {
  const rawKey = params.rawKey?.trim() ?? "";
  if (!rawKey.startsWith(SCOPED_API_KEY_PREFIX)) {
    return { ok: false, status: 401, reason: "invalid" };
  }
  const nowMs = params.nowMs ?? Date.now();
  let match: ScopedApiKeyRecord | undefined;
  for (const record of params.records) {
    if (digestMatches(record.digest, rawKey)) {
      match = record;
      break;
    }
  }
  if (!match || !isLive(match, nowMs)) {
    return { ok: false, status: 401, reason: "invalid" };
  }
  if (params.requiredScope && !match.scopes.includes(params.requiredScope)) {
    return { ok: false, status: 403, reason: "scope", missingScope: params.requiredScope };
  }
  return { ok: true, record: match };
}

/** Returns a revoked copy; already revoked records keep their first revocation time. */
export function revokeScopedApiKey(
  record: ScopedApiKeyRecord,
  nowMs: number = Date.now(),
): ScopedApiKeyRecord {
  if (record.revokedAtMs !== undefined) {
    return record;
  }
  return { ...record, revokedAtMs: nowMs };
}

/** Revokes every key held by one subject, for example a removed device. */
export function revokeScopedApiKeysForSubject(
  records: readonly ScopedApiKeyRecord[],
  subject: string,
  nowMs: number = Date.now(),
): ScopedApiKeyRecord[] {
  return records.map((record) =>
    record.subject === subject ? revokeScopedApiKey(record, nowMs) : record,
  );
}

/** Listing view: no digest, no raw key, with revoked and expired flags. */
export function describeScopedApiKey(
  record: ScopedApiKeyRecord,
  nowMs: number = Date.now(),
): ScopedApiKeyView {
  const { digest: _digest, ...rest } = record;
  return {
    ...rest,
    scopes: [...record.scopes],
    isRevoked: record.revokedAtMs !== undefined,
    isExpired: record.expiresAtMs !== undefined && record.expiresAtMs <= nowMs,
  };
}
