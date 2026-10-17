import { isActiveUnusableWindow } from "../agents/auth-profiles/usage-state.js";
import type { ProfileUsageStats } from "../agents/auth-profiles/types.js";
import type { ProviderUsageSnapshot, UsageSummary } from "./provider-usage.types.js";

const AUTH_USAGE_ERROR =
  /\b401\b|\b403\b|unauthori[sz]ed|forbidden|invalid.?grant|token expired|auth failed|login rejected/i;
const USAGE_ENDPOINT_RATE_LIMIT = /^HTTP 429\b|rate.?limit/i;
const SIGN_IN_REASONS = new Set(["auth_permanent", "auth", "session_expired"]);
const RATE_LIMIT_REASONS = new Set(["rate_limit", "overloaded"]);

/** Auth failures on a usage probe or stored profile: the account must be signed in again. */
export function isAuthUsageError(error: string | undefined): boolean {
  return Boolean(error && AUTH_USAGE_ERROR.test(error));
}

/**
 * A 429 from the usage-check endpoint is not the account's model/subscription limit.
 * The meter must not treat it as "this account is rate limited".
 */
export function isUsageEndpointRateLimit(error: string | undefined): boolean {
  return Boolean(error) && USAGE_ENDPOINT_RATE_LIMIT.test(error ?? "") && !isAuthUsageError(error);
}

function profileSignInNeeded(stats: ProfileUsageStats | undefined, now: number): boolean {
  return Boolean(
    stats &&
      isActiveUnusableWindow(stats.disabledUntil, now) &&
      stats.disabledReason &&
      SIGN_IN_REASONS.has(stats.disabledReason),
  );
}

function profileRateLimitedUntil(stats: ProfileUsageStats | undefined, now: number): number | undefined {
  if (!stats) {
    return undefined;
  }
  if (isActiveUnusableWindow(stats.blockedUntil, now)) {
    return stats.blockedUntil;
  }
  if (
    isActiveUnusableWindow(stats.cooldownUntil, now) &&
    stats.cooldownReason &&
    RATE_LIMIT_REASONS.has(stats.cooldownReason)
  ) {
    return stats.cooldownUntil;
  }
  return undefined;
}

function withoutLiveFlags(snapshot: ProviderUsageSnapshot): ProviderUsageSnapshot {
  const next = { ...snapshot };
  delete next.signInNeeded;
  delete next.rateLimitedUntil;
  delete next.ready;
  return next;
}

/** Maps one usage snapshot to the account's live state. Usage-endpoint 429 never wins. */
export function applyAccountLiveState(
  snapshot: ProviderUsageSnapshot,
  stats: ProfileUsageStats | undefined,
  now: number,
): ProviderUsageSnapshot {
  const base = withoutLiveFlags(snapshot);
  if (snapshot.signInNeeded === true || isAuthUsageError(snapshot.error) || profileSignInNeeded(stats, now)) {
    return { ...base, signInNeeded: true };
  }
  const rateLimitedUntil = profileRateLimitedUntil(stats, now);
  if (rateLimitedUntil !== undefined) {
    return { ...base, rateLimitedUntil };
  }
  if (isUsageEndpointRateLimit(snapshot.error)) {
    return { ...base, ready: true };
  }
  return base;
}

/** Overlays stored auth-profile failures onto each usage.status row. */
export function overlayAccountLiveState(
  summary: UsageSummary,
  usageStats: Record<string, ProfileUsageStats> | undefined,
  now = Date.now(),
): UsageSummary {
  return {
    ...summary,
    providers: summary.providers.map((snapshot) =>
      applyAccountLiveState(
        snapshot,
        snapshot.authProfileId ? usageStats?.[snapshot.authProfileId] : undefined,
        now,
      ),
    ),
  };
}
