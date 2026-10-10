import { sanitizeForLog } from "../../../../packages/terminal-core/src/ansi.js";
import { sleepWithAbort } from "../../../infra/backoff.js";
import { emitDiagnosticsTimelineEvent } from "../../../infra/diagnostics-timeline.js";
import {
  type AuthProfileFailureReason,
  isProfileInCooldown,
  markAuthProfileBlockedUntil,
  markAuthProfileFailure,
  markInlineProviderApiKeyFailure,
} from "../../auth-profiles.js";
import { revokeRuntimeAuthMaterializations } from "../../auth-profiles/runtime-materializations.js";
import {
  FailoverError,
  resolveFailoverReasonFromError,
  resolveFailoverStatus,
} from "../../failover-error.js";
import { hasLongWindowRateLimitEvidence } from "../../failover/retry-evidence.js";
import type { FailoverReason } from "../../failover/signal.js";
import { isConfigBackedInlineProviderApiKey, type ResolvedProviderAuth } from "../../model-auth.js";
import { log } from "../logger.js";
import type { TraceAttempt } from "../types.js";
import { resolveAuthProfileFailureReason } from "./auth-profile-failure-policy.js";
import type { PreparedEmbeddedRunInput } from "./execution-context.js";
import type { prepareEmbeddedRunRuntime } from "./runtime-preparation.js";
import type { EmbeddedRunAttemptResult } from "./types.js";

const MAX_TRANSIENT_RETRIES = 8;
const MAX_OUTPUT_LIMIT_RETRIES = 1;
const MAX_TRANSIENT_RETRY_TIME_MS = 90_000;
const TRANSIENT_RETRY_BASE_DELAY_MS = 1_000;
const TRANSIENT_RETRY_MAX_DELAY_MS = 30_000;

function resolveTransientRetryDelayMs(params: {
  retryNumber: number;
  retryAfterMs?: number;
  elapsedMs?: number;
}): number | undefined {
  const remainingMs =
    params.elapsedMs === undefined
      ? Infinity
      : MAX_TRANSIENT_RETRY_TIME_MS - Math.max(0, params.elapsedMs);
  // The header parser uses Infinity for a floor too large to represent safely.
  if (remainingMs <= 0 || params.retryAfterMs === Infinity) {
    return undefined;
  }
  const exponentialMs = Math.min(
    TRANSIENT_RETRY_MAX_DELAY_MS,
    TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, params.retryNumber - 1),
  );
  const jitteredMs = Math.min(
    TRANSIENT_RETRY_MAX_DELAY_MS,
    Math.round(exponentialMs * (0.5 + Math.random())),
  );
  const retryAfterMs = Number.isFinite(params.retryAfterMs)
    ? Math.max(0, Math.ceil(params.retryAfterMs ?? 0))
    : 0;
  const delayMs = Math.max(jitteredMs, retryAfterMs);
  return delayMs <= remainingMs ? delayMs : undefined;
}

const MAX_RATE_LIMIT_ATTEMPTS = 10;
const MAX_OVERLOAD_PROFILE_ROTATIONS = 1;
const MAX_RATE_LIMIT_PROFILE_ROTATIONS = 1;
const RETRY_SLEEP_CHUNK_MS = 24 * 60 * 60 * 1000;
/** A rate or usage limit that resets further away than this moves the run to the next free
 *  subscription instead of waiting. Shorter waits keep the same-account retry. */
export const RATE_LIMIT_ACCOUNT_SWITCH_AFTER_MS = 5 * 60 * 1000;

/** Why a long rate limit waits on the same account instead of switching. */
export type RateLimitWaitReason = "pinned" | "no_other_subscription";
export type RateLimitAccount = { profileId: string; label: string };
export type RateLimitAccountSwitch = {
  from: RateLimitAccount;
  to: RateLimitAccount;
  /** When the limited account resets; absent when the provider's floor is unrepresentable. */
  resetAt?: number;
};
export type RateLimitAccountWait = {
  account?: RateLimitAccount;
  resetAt?: number;
  reason: RateLimitWaitReason;
};

const SERVICE_NAMES: Record<string, string> = {
  anthropic: "Claude",
  "claude-cli": "Claude",
  openai: "ChatGPT",
  "openai-codex": "ChatGPT",
};

/** A subscription sign-in (OAuth or pasted token). API keys are never switched to. */
function isSubscriptionProfile(
  store: PreparedRuntime["profileFailureStore"],
  profileId: string | undefined,
): profileId is string {
  const type = profileId ? store.profiles[profileId]?.type : undefined;
  return type !== undefined && type !== "api_key";
}

/** "Claude account 2": the service and the account's place among this run's subscriptions. */
function describeAccount(
  store: PreparedRuntime["profileFailureStore"],
  provider: string,
  candidates: readonly (string | undefined)[],
  profileId: string,
): RateLimitAccount {
  const service =
    SERVICE_NAMES[store.profiles[profileId]?.provider ?? provider] ??
    SERVICE_NAMES[provider] ??
    provider;
  const subscriptions = [...new Set(candidates)].filter((id) => isSubscriptionProfile(store, id));
  const place = subscriptions.indexOf(profileId);
  return {
    profileId,
    label: `${service} account ${place < 0 ? subscriptions.length + 1 : place + 1}`,
  };
}

type PreparedRuntime = Awaited<ReturnType<typeof prepareEmbeddedRunRuntime>>;
export type EmbeddedRunFailoverRetryController = ReturnType<
  typeof createEmbeddedRunFailoverRetryController
>;
type AuthRetryTrace = TraceAttempt & { reason: FailoverReason };
type TransientRetryReason = FailoverReason | "output_limit";

type RateLimitAuthProfileContext = {
  failoverProvider: string;
  failoverModel: string;
  logFallbackDecision: (decision: "fallback_model", extra?: { status?: number }) => void;
};

export function createEmbeddedRunFailoverRetryController(input: {
  runParams: PreparedEmbeddedRunInput["runParams"];
  provider: string;
  modelId: string;
  globalLane: string;
  agentDir: string;
  fallbackConfigured: boolean;
  profileFailureStore: PreparedRuntime["profileFailureStore"];
  getLastProfileId: () => string | undefined;
  getSessionId: () => string;
  harnessOwnsTransport: () => boolean;
  getRuntimeAuthOwnerId: () => string;
  getApiKeyInfo: () => ResolvedProviderAuth | null;
  advanceAuthProfile: PreparedRuntime["advanceAttemptAuthProfile"];
}) {
  const {
    runParams: params,
    provider,
    modelId,
    globalLane,
    agentDir,
    fallbackConfigured,
    profileFailureStore,
  } = input;
  let rateLimitProfileRotations = 0;
  let transientRetryCount = 0;
  let outputLimitRetryCount = 0;
  let rateLimitSeen = false;
  let transientRetryBudget: number | undefined;
  // Consecutive outages count failed-request time as well as backoff. A completed
  // successful model response ends the outage, but never refunds retry attempts.
  let transientRetryWindowStartMs: number | null = null;

  const resolveProfileFailureReason = (
    failoverReason: FailoverReason | null,
    opts?: { providerStarted?: boolean; transientRateLimit?: boolean },
  ) =>
    resolveAuthProfileFailureReason({
      failoverReason,
      providerStarted: opts?.providerStarted,
      transientRateLimit: opts?.transientRateLimit,
      policy: params.authProfileFailurePolicy,
    });

  const maybeMarkAuthProfileFailure = async (failure: {
    profileId?: string;
    reason?: AuthProfileFailureReason | null;
    modelId?: string;
  }) => {
    const { profileId, reason } = failure;
    if (input.harnessOwnsTransport() && (reason === "auth" || reason === "auth_permanent")) {
      revokeRuntimeAuthMaterializations({
        agentDir,
        provider,
        runtimeOwnerId: input.getRuntimeAuthOwnerId(),
      });
    }
    if (params.authProfileStateMode === "read-only" || !reason) {
      return;
    }
    if (input.harnessOwnsTransport() && reason === "timeout") {
      return;
    }
    if (profileId) {
      await markAuthProfileFailure({
        store: profileFailureStore,
        profileId,
        reason,
        cfg: params.config,
        agentDir,
        runId: params.runId,
        modelId: failure.modelId,
      });
      return;
    }
    const apiKeyInfo = input.getApiKeyInfo();
    if (
      apiKeyInfo?.mode !== "api-key" ||
      !isConfigBackedInlineProviderApiKey({
        cfg: params.config,
        provider,
        source: apiKeyInfo.source,
        store: profileFailureStore,
      })
    ) {
      return;
    }
    await markInlineProviderApiKeyFailure({
      store: profileFailureStore,
      provider,
      reason,
      cfg: params.config,
      agentDir,
      runId: params.runId,
      modelId: failure.modelId,
    });
  };

  // A long rate limit marks the limited subscription blocked until its reset (so it isn't
  // picked next anywhere) and moves this run to the next free subscription in order. The
  // caller continues the same transcript, so finished tool calls never run again.
  const switchLimitedSubscription = async (limit: {
    retryAfterMs: number;
    candidates: readonly (string | undefined)[];
  }): Promise<
    | { action: "switched"; change: RateLimitAccountSwitch }
    | { action: "wait"; wait: RateLimitAccountWait }
  > => {
    const store = profileFailureStore;
    const limitedProfileId = input.getLastProfileId();
    const resetAt = Number.isFinite(limit.retryAfterMs)
      ? Date.now() + Math.ceil(limit.retryAfterMs)
      : undefined;
    const from = limitedProfileId
      ? describeAccount(store, provider, limit.candidates, limitedProfileId)
      : undefined;
    if (limitedProfileId && resetAt !== undefined && params.authProfileStateMode !== "read-only") {
      try {
        await markAuthProfileBlockedUntil({
          store,
          profileId: limitedProfileId,
          blockedUntil: resetAt,
          source: "provider_retry_after",
          agentDir,
          runId: params.runId,
        });
      } catch (markError) {
        log.warn(`limited profile mark failed: ${String(markError)}`);
      }
    }
    if (
      limitedProfileId &&
      params.authProfileIdSource === "user" &&
      limitedProfileId === params.authProfileId
    ) {
      return { action: "wait", wait: { account: from, resetAt, reason: "pinned" } };
    }
    const position = limitedProfileId ? limit.candidates.indexOf(limitedProfileId) : -1;
    const target =
      position < 0
        ? undefined
        : limit.candidates
            .slice(position + 1)
            .find(
              (candidate) =>
                candidate !== limitedProfileId &&
                isSubscriptionProfile(store, candidate) &&
                !isProfileInCooldown(store, candidate, undefined, modelId),
            );
    if (!from || !target) {
      return { action: "wait", wait: { account: from, resetAt, reason: "no_other_subscription" } };
    }
    // Move only to another subscription: API keys are passed over without applying their
    // credentials. When no subscription signs in, the run stays on (and waits for) this one.
    const advanced = await input.advanceAuthProfile({
      accept: (candidate) =>
        candidate !== limitedProfileId && isSubscriptionProfile(store, candidate),
    });
    const current = input.getLastProfileId();
    if (advanced && current !== limitedProfileId && isSubscriptionProfile(store, current)) {
      return {
        action: "switched",
        change: {
          from,
          to: describeAccount(store, provider, limit.candidates, current),
          ...(resetAt !== undefined ? { resetAt } : {}),
        },
      };
    }
    return { action: "wait", wait: { account: from, resetAt, reason: "no_other_subscription" } };
  };

  return {
    overloadProfileRotationLimit: MAX_OVERLOAD_PROFILE_ROTATIONS,
    get transientRetryCount() {
      return transientRetryCount;
    },
    observeAttempt: (
      attempt: Pick<
        EmbeddedRunAttemptResult,
        "providerRetryMaxRetries" | "hasSuccessfulModelResponse"
      >,
    ) => {
      transientRetryBudget = attempt.providerRetryMaxRetries;
      if (attempt.hasSuccessfulModelResponse) {
        transientRetryWindowStartMs = null;
      }
    },
    advanceAuthProfile: input.advanceAuthProfile,
    advanceRateLimitAuthProfile: async (context: RateLimitAuthProfileContext): Promise<boolean> => {
      if (rateLimitProfileRotations >= MAX_RATE_LIMIT_PROFILE_ROTATIONS && fallbackConfigured) {
        const status = resolveFailoverStatus("rate_limit");
        log.warn(
          `rate-limit profile rotation cap reached for ${sanitizeForLog(provider)}/${sanitizeForLog(modelId)} after ${rateLimitProfileRotations} rotations; escalating to model fallback`,
        );
        context.logFallbackDecision("fallback_model", { status });
        throw new FailoverError(
          "The AI service is temporarily rate-limited. Please try again in a moment.",
          {
            reason: "rate_limit",
            provider: context.failoverProvider,
            model: context.failoverModel,
            profileId: input.getLastProfileId(),
            sessionId: input.getSessionId(),
            lane: globalLane,
            status,
          },
        );
      }
      const rotated = await input.advanceAuthProfile();
      if (rotated) {
        rateLimitProfileRotations += 1;
      }
      return rotated;
    },
    maybeMarkAuthProfileFailure,
    resolveAuthProfileFailureReason: resolveProfileFailureReason,
    recoverThrownHarnessAuthFailure: async (error: unknown): Promise<AuthRetryTrace | null> => {
      // Native harnesses can throw before returning a terminal result. Recover only
      // provider-auth failures here; local harness faults must keep propagating.
      if (!input.harnessOwnsTransport()) {
        return null;
      }
      const failoverReason = resolveFailoverReasonFromError(error, provider);
      if (failoverReason !== "auth" && failoverReason !== "auth_permanent") {
        return null;
      }
      const failedProfileId = input.getLastProfileId();
      const profileFailureReason = resolveProfileFailureReason(failoverReason);
      const userPinnedProfile =
        params.authProfileIdSource === "user" && failedProfileId === params.authProfileId;
      const rotated = userPinnedProfile ? false : await input.advanceAuthProfile();
      try {
        await maybeMarkAuthProfileFailure({
          profileId: failedProfileId,
          reason: profileFailureReason,
          modelId,
        });
      } catch (markError) {
        log.warn(`profile failure mark failed: ${String(markError)}`);
      }
      return rotated
        ? {
            provider,
            model: modelId,
            result: "rotate_profile",
            reason: failoverReason,
            stage: "prompt",
          }
        : null;
    },
    maybeRetryTransient: async (retry: {
      reason: TransientRetryReason;
      message?: string;
      code?: string;
      retryAfterMs?: number;
      /** Saved retry.provider.maxRetryDelayMs; undefined or 0 disables the cap. */
      maxRetryDelayMs?: number;
      /** False when the attempt cannot fail over (replay-unsafe tool activity). */
      failoverEligible?: boolean;
      onRetry?: (status: {
        attempt: number;
        maxRetries: number;
        delayMs: number;
        reason: TransientRetryReason;
        /** Set when a long rate limit waits on the same account; names it and its reset. */
        limit?: RateLimitAccountWait;
      }) => void | Promise<void>;
      /** The run's auth profile order; enables switching to another subscription on long limits. */
      profileCandidates?: readonly (string | undefined)[];
      /** Called after a long rate limit moved the run to another subscription. */
      onAccountSwitch?: (change: RateLimitAccountSwitch) => void | Promise<void>;
    }): Promise<boolean> => {
      const recordDecision = (
        decision: "accepted" | "rejected",
        reason:
          | "non_transient"
          | "connection_retry_disabled"
          | "long_window_rate_limit"
          | "retry_budget_exhausted"
          | "retry_delay_unavailable"
          | "retry_delay_exceeds_cap"
          | "account_switched"
          | "no_other_subscription"
          | "wait_interrupted"
          | "backoff_completed",
      ) =>
        emitDiagnosticsTimelineEvent(
          {
            type: "mark",
            name: "model.retry.decision",
            runId: params.runId,
            attributes: { decision, reason, retryCount: transientRetryCount },
          },
          { config: params.config },
        );
      if (
        params.retryConnectionErrors === false &&
        retry.code !== undefined &&
        ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(retry.code)
      ) {
        recordDecision("rejected", "connection_retry_disabled");
        return false;
      }
      if (
        retry.reason !== "rate_limit" &&
        retry.reason !== "overloaded" &&
        retry.reason !== "server_error" &&
        retry.reason !== "timeout" &&
        retry.reason !== "output_limit"
      ) {
        recordDecision("rejected", "non_transient");
        return false;
      }
      const rateLimit = retry.reason === "rate_limit";
      let limitWait: RateLimitAccountWait | undefined;
      // Only a subscription account switches; API-key and keyless runs keep the waits below.
      if (
        rateLimit &&
        retry.retryAfterMs !== undefined &&
        retry.retryAfterMs > RATE_LIMIT_ACCOUNT_SWITCH_AFTER_MS &&
        isSubscriptionProfile(profileFailureStore, input.getLastProfileId())
      ) {
        const switched = await switchLimitedSubscription({
          retryAfterMs: retry.retryAfterMs,
          candidates: retry.profileCandidates ?? [],
        });
        if (switched.action === "switched") {
          recordDecision("accepted", "account_switched");
          log.warn(
            `rate limit on ${sanitizeForLog(provider)}/${sanitizeForLog(modelId)} resets in ${retry.retryAfterMs === Infinity ? "an unrepresentable time" : `${retry.retryAfterMs}ms`}; moved to the next subscription`,
          );
          await retry.onAccountSwitch?.(switched.change);
          return true;
        }
        if (
          switched.wait.reason === "no_other_subscription" &&
          fallbackConfigured &&
          retry.failoverEligible !== false
        ) {
          // Hand the replay-safe attempt to the fallback chain. Profile rotation could only
          // reach an API key now, so the next rate-limit rotation escalates straight to fallback.
          rateLimitProfileRotations = MAX_RATE_LIMIT_PROFILE_ROTATIONS;
          recordDecision("rejected", "no_other_subscription");
          log.warn(
            `rate limit on ${sanitizeForLog(provider)}/${sanitizeForLog(modelId)} is long and no other subscription is free; failing over`,
          );
          return false;
        }
        limitWait = switched.wait;
      }
      // A long limit that must wait on its account (pinned, or no free subscription and not
      // replay-safe) waits even on usage-window wording; declining would end the run unnoticed.
      if (rateLimit && !limitWait && hasLongWindowRateLimitEvidence(retry.message)) {
        recordDecision("rejected", "long_window_rate_limit");
        return false;
      }
      // Honor the SDK's retry-delay cap when replay-safe fallback is available.
      // Otherwise a long Retry-After must wait: declining would end the turn.
      const retryDelayCapMs =
        retry.maxRetryDelayMs !== undefined &&
        Number.isFinite(retry.maxRetryDelayMs) &&
        retry.maxRetryDelayMs > 0
          ? retry.maxRetryDelayMs
          : undefined;
      if (
        rateLimit &&
        fallbackConfigured &&
        retry.failoverEligible !== false &&
        // A user-pinned account never leaves its account for the fallback chain.
        limitWait?.reason !== "pinned" &&
        retryDelayCapMs !== undefined &&
        retry.retryAfterMs !== undefined &&
        retry.retryAfterMs > retryDelayCapMs
      ) {
        recordDecision("rejected", "retry_delay_exceeds_cap");
        log.warn(
          `rate-limit retry floor ${retry.retryAfterMs === Infinity ? "exceeds representable time" : `${retry.retryAfterMs}ms`} exceeds retry.provider.maxRetryDelayMs=${retryDelayCapMs} for ${sanitizeForLog(provider)}/${sanitizeForLog(modelId)}; failing over`,
        );
        return false;
      }
      rateLimitSeen ||= rateLimit;
      const retryCount = transientRetryCount;
      const retryBudget = Math.min(
        transientRetryBudget ?? (rateLimit ? MAX_RATE_LIMIT_ATTEMPTS - 1 : MAX_TRANSIENT_RETRIES),
        rateLimitSeen ? MAX_RATE_LIMIT_ATTEMPTS - 1 : Infinity,
      );
      if (
        retryCount >= retryBudget ||
        (retry.reason === "output_limit" && outputLimitRetryCount >= MAX_OUTPUT_LIMIT_RETRIES)
      ) {
        recordDecision("rejected", "retry_budget_exhausted");
        return false;
      }
      const nowMs = Date.now();
      const retryWindowStartMs = transientRetryWindowStartMs ?? nowMs;
      if (retry.reason !== "output_limit") {
        transientRetryWindowStartMs = retryWindowStartMs;
      }
      const delayMs = resolveTransientRetryDelayMs({
        retryNumber: retryCount + 1,
        retryAfterMs: retry.retryAfterMs,
        // Reaching an output ceiling can take minutes of useful generation.
        // Keep its count budget and run deadline without the outage time window.
        elapsedMs:
          rateLimit || retry.reason === "output_limit" ? undefined : nowMs - retryWindowStartMs,
      });
      if (delayMs === undefined) {
        recordDecision("rejected", "retry_delay_unavailable");
        // Explain why recovery stopped before the count limit; replay safety still gates fallback.
        log.warn(
          `transient retry ${retry.retryAfterMs === Infinity ? "floor exceeds representable time" : "window elapsed"} for ${sanitizeForLog(provider)}/${sanitizeForLog(modelId)} after ${transientRetryCount}/${retryBudget} retries; stopping same-model retries`,
        );
        return false;
      }
      log.warn(
        `transient same-model retry ${retryCount + 1}/${retryBudget} for ${sanitizeForLog(provider)}/${sanitizeForLog(modelId)} reason=${retry.reason}: delayMs=${delayMs}`,
      );
      await retry.onRetry?.({
        attempt: retry.reason === "output_limit" ? outputLimitRetryCount + 1 : retryCount + 1,
        maxRetries:
          retry.reason === "output_limit"
            ? Math.min(retryBudget, MAX_OUTPUT_LIMIT_RETRIES)
            : retryBudget,
        delayMs,
        reason: retry.reason,
        ...(limitWait ? { limit: limitWait } : {}),
      });
      const closeRetryWait = params.onRetryWait?.(Date.now() + delayMs, params.abortSignal);
      let completed = false;
      try {
        // Provider floors can exceed one native timer; protect the whole wait.
        let remainingMs = delayMs;
        while (remainingMs > 0) {
          const chunkMs = Math.min(remainingMs, RETRY_SLEEP_CHUNK_MS);
          await sleepWithAbort(chunkMs, params.abortSignal);
          remainingMs -= chunkMs;
        }
        completed = true;
      } finally {
        if (!completed) {
          recordDecision("rejected", "wait_interrupted");
        }
        closeRetryWait?.(completed);
      }
      recordDecision("accepted", "backoff_completed");
      transientRetryCount += 1;
      if (retry.reason === "output_limit") {
        outputLimitRetryCount += 1;
      }
      return true;
    },
  };
}
