// Claude subscription usage from the unified rate-limit headers, for tokens that
// cannot read /api/oauth/usage (setup-tokens have no user:profile scope).
import { buildAnthropicClaudeCodeIdentity } from "../../packages/ai/src/providers/anthropic-model-contract.js";
import { buildAnthropicSystemBlocks } from "../../packages/ai/src/transports/anthropic-payload-policy.js";
import {
  ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS,
  anthropicUnifiedUsageWindows,
  claimAnthropicUnifiedRefresh,
  readAnthropicUnifiedRateLimits,
  recordAnthropicUnifiedRateLimits,
} from "../agents/auth-profiles/usage-rate-limits.js";
import { fetchJson } from "./provider-usage.fetch.shared.js";
import { PROVIDER_LABELS } from "./provider-usage.shared.js";
import type { ProviderUsageSnapshot } from "./provider-usage.types.js";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
// The smallest model; one output token keeps the refresh as cheap as a request can be.
const ANTHROPIC_REFRESH_MODEL = "claude-haiku-4-5";

export type ClaudeHeaderUsageOptions = {
  authProfileId?: string;
  /** The auth store owning the profile, read for its cooldown state. */
  agentDir?: string;
  /** True while the profile is cooling down after a failure; no refresh is sent then. */
  isInCooldown?: () => boolean | Promise<boolean>;
  now?: number;
};

async function isProfileCoolingDown(options: ClaudeHeaderUsageOptions): Promise<boolean> {
  if (options.isInCooldown) {
    return await options.isInCooldown();
  }
  if (!options.authProfileId) {
    return false;
  }
  try {
    const { ensureAuthProfileStoreWithoutExternalProfiles, isProfileInCooldown } =
      await import("../agents/auth-profiles.js");
    const store = ensureAuthProfileStoreWithoutExternalProfiles(options.agentDir);
    return isProfileInCooldown(store, options.authProfileId);
  } catch {
    // An unreadable store must not hide usage; treat the profile as usable.
    return false;
  }
}

/** Only subscription tokens get unified headers; an API key would be billed for nothing. */
export function isClaudeSubscriptionToken(token: string): boolean {
  return token.startsWith("sk-ant-oat");
}

/** One `max_tokens: 1` request whose response headers carry the account's usage. */
async function refreshClaudeRateLimits(params: {
  token: string;
  authProfileId?: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
}): Promise<void> {
  const identity = buildAnthropicClaudeCodeIdentity("claude-code-20250219,oauth-2025-04-20");
  const res = await fetchJson(
    ANTHROPIC_MESSAGES_URL,
    {
      method: "POST",
      headers: {
        ...identity.headers,
        Authorization: `Bearer ${params.token}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_REFRESH_MODEL,
        max_tokens: 1,
        system: buildAnthropicSystemBlocks(undefined, true, undefined, identity.version),
        messages: [{ role: "user", content: "hi" }],
      }),
    },
    params.timeoutMs,
    params.fetchFn,
  );
  // A limited account still answers with its headers (status `rejected`).
  recordAnthropicUnifiedRateLimits({
    profileId: params.authProfileId,
    token: params.token,
    headers: res.headers,
  });
  await res.body?.cancel().catch(() => undefined);
}

/**
 * The 5h and weekly windows from the newest header reading for this account. A reading
 * older than 30 minutes (or none) is refreshed with one tiny request, at most every 30
 * minutes per profile and never while the profile cools down.
 */
export async function fetchClaudeUsageFromRateLimitHeaders(
  token: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
  options: ClaudeHeaderUsageOptions = {},
): Promise<ProviderUsageSnapshot | undefined> {
  const now = options.now ?? Date.now();
  const key = { profileId: options.authProfileId, token };
  let limits = readAnthropicUnifiedRateLimits(key);
  const stale = !limits || now - limits.observedAt >= ANTHROPIC_UNIFIED_REFRESH_INTERVAL_MS;
  if (stale && isClaudeSubscriptionToken(token) && !(await isProfileCoolingDown(options))) {
    if (claimAnthropicUnifiedRefresh(key, now)) {
      try {
        await refreshClaudeRateLimits({
          token,
          authProfileId: options.authProfileId,
          timeoutMs,
          fetchFn,
        });
      } catch {
        // A failed refresh keeps the older reading, if any.
      }
      limits = readAnthropicUnifiedRateLimits(key);
    }
  }
  const windows = anthropicUnifiedUsageWindows(limits);
  if (windows.length === 0) {
    return undefined;
  }
  return { provider: "anthropic", displayName: PROVIDER_LABELS.anthropic, windows };
}
