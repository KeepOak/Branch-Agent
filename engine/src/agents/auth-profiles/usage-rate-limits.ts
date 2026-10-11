/**
 * Claude subscription usage read from the `anthropic-ratelimit-unified-*` headers.
 *
 * Every Anthropic Messages response to a subscription credential (setup-token or
 * Claude sign-in) carries the account's 5-hour and 7-day utilization, reset time and
 * status. Setup-tokens lack the `user:profile` scope that /api/oauth/usage needs, so
 * these headers are their only usage source. Readings are kept per auth profile for
 * this process; a missing or old reading is refreshed by the usage fetch.
 */
import { createHash } from "node:crypto";
import type { UsageWindow } from "../../infra/provider-usage.types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("auth-profiles/usage-rate-limits");

const UNIFIED_HEADER_PREFIX = "anthropic-ratelimit-unified-";
/** A reading older than this is refreshed, and one profile is refreshed at most this often. */
export const ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS = 30 * 60_000;

export type AnthropicUnifiedWindow = {
  /** Share of the window used, 0-100. */
  usedPercent: number;
  /** Window reset, ms since epoch. */
  resetAt?: number;
  /** `allowed`, `allowed_warning` or `rejected`. */
  status?: string;
};

export type AnthropicUnifiedRateLimits = {
  observedAt: number;
  status?: string;
  representativeClaim?: string;
  fiveHour?: AnthropicUnifiedWindow;
  sevenDay?: AnthropicUnifiedWindow;
};

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

type RateLimitState = {
  byKey: Map<string, AnthropicUnifiedRateLimits>;
  refreshClaims: Map<string, number>;
  logged: boolean;
};

const STATE_KEY = Symbol.for("branch.anthropicUnifiedRateLimits");

function state(): RateLimitState {
  const holder = globalThis as Record<PropertyKey, unknown>;
  const existing = holder[STATE_KEY] as RateLimitState | undefined;
  if (existing) {
    return existing;
  }
  const created: RateLimitState = { byKey: new Map(), refreshClaims: new Map(), logged: false };
  holder[STATE_KEY] = created;
  return created;
}

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name)?.trim() || undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      const text = Array.isArray(value) ? value[0] : value;
      return text?.trim() || undefined;
    }
  }
  return undefined;
}

function readNumber(headers: HeaderSource, name: string): number | undefined {
  const raw = readHeader(headers, name);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readWindow(headers: HeaderSource, key: "5h" | "7d"): AnthropicUnifiedWindow | undefined {
  const utilization = readNumber(headers, `${UNIFIED_HEADER_PREFIX}${key}-utilization`);
  if (utilization === undefined || utilization < 0) {
    return undefined;
  }
  // Utilization is a 0-1 fraction; reset is Unix seconds.
  const resetSeconds = readNumber(headers, `${UNIFIED_HEADER_PREFIX}${key}-reset`);
  const status = readHeader(headers, `${UNIFIED_HEADER_PREFIX}${key}-status`);
  return {
    usedPercent: Math.min(100, Math.max(0, utilization * 100)),
    ...(resetSeconds !== undefined && resetSeconds > 0 ? { resetAt: resetSeconds * 1000 } : {}),
    ...(status ? { status } : {}),
  };
}

/** The unified rate-limit reading in one Anthropic response, or undefined when it carries none. */
export function parseAnthropicUnifiedRateLimitHeaders(
  headers: HeaderSource,
  now: number = Date.now(),
): AnthropicUnifiedRateLimits | undefined {
  const fiveHour = readWindow(headers, "5h");
  const sevenDay = readWindow(headers, "7d");
  if (!fiveHour && !sevenDay) {
    return undefined;
  }
  const status = readHeader(headers, `${UNIFIED_HEADER_PREFIX}status`);
  const representativeClaim = readHeader(headers, `${UNIFIED_HEADER_PREFIX}representative-claim`);
  return {
    observedAt: now,
    ...(status ? { status } : {}),
    ...(representativeClaim ? { representativeClaim } : {}),
    ...(fiveHour ? { fiveHour } : {}),
    ...(sevenDay ? { sevenDay } : {}),
  };
}

/** The reading as the usage windows every account surface shows: "5h" and "Week". */
export function anthropicUnifiedUsageWindows(
  limits: AnthropicUnifiedRateLimits | undefined,
): UsageWindow[] {
  if (!limits) {
    return [];
  }
  const windows: UsageWindow[] = [];
  for (const [label, window] of [
    ["5h", limits.fiveHour],
    ["Week", limits.sevenDay],
  ] as const) {
    if (window) {
      windows.push({
        label,
        usedPercent: window.usedPercent,
        ...(window.resetAt !== undefined ? { resetAt: window.resetAt } : {}),
      });
    }
  }
  return windows;
}

/** Readings are kept under the auth profile id and, for callers without one, the token. */
function keysFor(params: { profileId?: string; token?: string }): string[] {
  const keys: string[] = [];
  const profileId = params.profileId?.trim();
  if (profileId) {
    keys.push(`profile:${profileId}`);
  }
  if (params.token) {
    keys.push(`token:${createHash("sha256").update(params.token).digest("hex")}`);
  }
  return keys;
}

/** Keep the reading from one Anthropic response. Returns true when it carried one. */
export function recordAnthropicUnifiedRateLimits(params: {
  profileId?: string;
  token?: string;
  headers: HeaderSource;
  now?: number;
}): boolean {
  const keys = keysFor(params);
  if (keys.length === 0) {
    return false;
  }
  const limits = parseAnthropicUnifiedRateLimitHeaders(params.headers, params.now);
  if (!limits) {
    return false;
  }
  const current = state();
  if (!current.logged) {
    current.logged = true;
    log.debug(`anthropic unified rate-limit headers seen: ${JSON.stringify(limits)}`);
  }
  for (const key of keys) {
    const previous = current.byKey.get(key);
    // Concurrent responses can land out of order; the newest observation wins.
    if (!previous || previous.observedAt <= limits.observedAt) {
      current.byKey.set(key, limits);
    }
  }
  return true;
}

/** The newest kept reading for a profile (or token). */
export function readAnthropicUnifiedRateLimits(params: {
  profileId?: string;
  token?: string;
}): AnthropicUnifiedRateLimits | undefined {
  let newest: AnthropicUnifiedRateLimits | undefined;
  for (const key of keysFor(params)) {
    const limits = state().byKey.get(key);
    if (limits && (!newest || limits.observedAt > newest.observedAt)) {
      newest = limits;
    }
  }
  return newest;
}

/**
 * Claim the one refresh call a profile may make per interval. Returns false when the
 * profile (or token) was refreshed less than ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS ago.
 */
export function claimAnthropicUnifiedRefresh(
  params: { profileId?: string; token?: string },
  now: number = Date.now(),
): boolean {
  const keys = keysFor(params);
  const claims = state().refreshClaims;
  if (keys.length === 0) {
    return false;
  }
  if (
    keys.some((key) => now - (claims.get(key) ?? -Infinity) < ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS)
  ) {
    return false;
  }
  for (const key of keys) {
    claims.set(key, now);
  }
  return true;
}

export function resetAnthropicUnifiedRateLimitsForTest(): void {
  const current = state();
  current.byKey.clear();
  current.refreshClaims.clear();
  current.logged = false;
}
