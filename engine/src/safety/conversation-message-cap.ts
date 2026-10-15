// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:api/server/middleware/limiters/messageLimiters.js (atlas SAFETY-0098)
// getRateLimitReset from packages/api/src/utils/limiter.ts at the same commit.
/**
 * Per-conversation hourly message cap for work nobody typed: schedules,
 * triggers, chat apps and agents answering agents. The owner's own messages
 * count toward the window but are never refused (never stricter for the owner).
 * Gateway write RPCs and auth attempts keep their own limiters in
 * gateway/control-plane-rate-limit.ts and gateway/auth-rate-limit.ts.
 */
import { pruneMapToMaxSize } from "../infra/map-size.js";

export const DEFAULT_CONVERSATION_MESSAGES_PER_HOUR = 60;
export const CONVERSATION_MESSAGE_CAP_WINDOW_MS = 60 * 60_000;
const CONVERSATION_MESSAGE_CAP_MAX_CONVERSATIONS = 10_000;

/** Who produced a message. Only "owner" is exempt from refusal. */
export type ConversationMessageOrigin = "owner" | "schedule" | "trigger" | "channel" | "agent";

export type RateLimitReset = {
  /** Epoch milliseconds at which the window reopens. */
  resetAt: number;
  /** Whole seconds until resetAt, never below one, as Retry-After expects. */
  retryAfterSeconds: number;
};

export type MessageLimitViolation = RateLimitReset & {
  type: "message_limit";
  max: number;
  limiter: string;
  windowInMinutes: number;
};

export type ConversationMessageCapDecision =
  | { allowed: true; count: number; remaining: number }
  | { allowed: false; count: number; violation: MessageLimitViolation };

export type ConversationMessageCap = {
  admit: (params: {
    conversationKey: string;
    origin: ConversationMessageOrigin;
  }) => ConversationMessageCapDecision;
  count: (conversationKey: string) => number;
  reset: (conversationKey?: string) => void;
};

/**
 * When a limited caller may retry. Without a reported reset the window is
 * assumed to reopen one full window from now, the latest its count can apply.
 */
export function getRateLimitReset(
  resetTimeMs: number | undefined,
  windowMs: number,
  now: number = Date.now(),
): RateLimitReset {
  const resetAt =
    resetTimeMs !== undefined && Number.isFinite(resetTimeMs) ? resetTimeMs : now + windowMs;
  return { resetAt, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
}

/** The refusal payload: the limit it hit and when the window reopens. */
export function buildMessageLimitViolation(params: {
  max: number;
  limiter: string;
  windowMs: number;
  resetTimeMs?: number;
  now?: number;
}): MessageLimitViolation {
  return {
    type: "message_limit",
    max: params.max,
    limiter: params.limiter,
    windowInMinutes: params.windowMs / 60_000,
    ...getRateLimitReset(params.resetTimeMs, params.windowMs, params.now),
  };
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** Sliding-window cap keyed by conversation; process-local like the gateway limiters. */
export function createConversationMessageCap(
  params: {
    maxPerWindow?: number;
    windowMs?: number;
    maxConversations?: number;
    now?: () => number;
  } = {},
): ConversationMessageCap {
  const max = resolvePositiveInteger(params.maxPerWindow, DEFAULT_CONVERSATION_MESSAGES_PER_HOUR);
  const windowMs = resolvePositiveInteger(params.windowMs, CONVERSATION_MESSAGE_CAP_WINDOW_MS);
  const maxConversations = resolvePositiveInteger(
    params.maxConversations,
    CONVERSATION_MESSAGE_CAP_MAX_CONVERSATIONS,
  );
  const now = params.now ?? Date.now;
  const windows = new Map<string, number[]>();

  const liveStamps = (key: string, nowMs: number): number[] => {
    const stamps = (windows.get(key) ?? []).filter((stamp) => nowMs - stamp < windowMs);
    if (stamps.length === 0) {
      windows.delete(key);
    }
    return stamps;
  };

  const record = (key: string, stamps: number[], nowMs: number): number => {
    stamps.push(nowMs);
    // Only the newest max stamps decide when the window reopens.
    const kept = stamps.length > max ? stamps.slice(stamps.length - max) : stamps;
    if (!windows.has(key) && windows.size >= maxConversations) {
      pruneMapToMaxSize(windows, maxConversations - 1);
    }
    windows.set(key, kept);
    return kept.length;
  };

  return {
    admit({ conversationKey, origin }) {
      const nowMs = now();
      const stamps = liveStamps(conversationKey, nowMs);
      const oldest = stamps[0];
      if (origin !== "owner" && oldest !== undefined && stamps.length >= max) {
        const violation = buildMessageLimitViolation({
          max,
          limiter: "conversation",
          windowMs,
          resetTimeMs: oldest + windowMs,
          now: nowMs,
        });
        return { allowed: false, count: stamps.length, violation };
      }
      const count = record(conversationKey, stamps, nowMs);
      return { allowed: true, count, remaining: Math.max(0, max - count) };
    },
    count: (conversationKey) => liveStamps(conversationKey, now()).length,
    reset(conversationKey) {
      if (conversationKey === undefined) {
        windows.clear();
      } else {
        windows.delete(conversationKey);
      }
    },
  };
}
