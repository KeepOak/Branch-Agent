// The express-rate-limit wiring is not ported; the violation payload assertions run
// against buildMessageLimitViolation. Owner requests G-1566, G-1696, R-2377.
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_MESSAGE_CAP_WINDOW_MS,
  DEFAULT_CONVERSATION_MESSAGES_PER_HOUR,
  buildMessageLimitViolation,
  createConversationMessageCap,
} from "./conversation-message-cap.js";

function clock(startMs: number) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("message rate limiter violation payload", () => {
  /** The chat client counts down to this timestamp, so the payload has to carry it. */
  it("persists the window reset alongside the limit it hit", () => {
    const now = Date.UTC(2026, 8, 13, 12, 0, 0);
    const resetTime = now + 7 * 60 * 1000;
    expect(
      buildMessageLimitViolation({
        max: 40,
        limiter: "user",
        windowMs: 60 * 60 * 1000,
        resetTimeMs: resetTime,
        now,
      }),
    ).toEqual(
      expect.objectContaining({
        type: "message_limit",
        limiter: "user",
        windowInMinutes: 60,
        resetAt: resetTime,
        retryAfterSeconds: 420,
      }),
    );
  });

  /** Without a reported reset, the payload still has to name a reachable retry moment. */
  it("falls back to the configured window when the limiter reports no reset time", () => {
    const now = Date.UTC(2026, 8, 13, 12, 0, 0);
    expect(
      buildMessageLimitViolation({ max: 40, limiter: "ip", windowMs: 60 * 1000, now }),
    ).toEqual(
      expect.objectContaining({
        limiter: "ip",
        windowInMinutes: 1,
        resetAt: now + 60 * 1000,
        retryAfterSeconds: 60,
      }),
    );
  });
});

describe("conversation message cap", () => {
  it("refuses unattended work at the cap and reopens when the oldest message leaves the window", () => {
    const time = clock(1_000_000);
    const cap = createConversationMessageCap({ maxPerWindow: 3, now: time.now });
    for (let i = 0; i < 3; i += 1) {
      expect(cap.admit({ conversationKey: "c1", origin: "schedule" }).allowed).toBe(true);
      time.advance(60_000);
    }
    const refused = cap.admit({ conversationKey: "c1", origin: "trigger" });
    expect(refused).toMatchObject({
      allowed: false,
      count: 3,
      violation: {
        type: "message_limit",
        limiter: "conversation",
        max: 3,
        windowInMinutes: 60,
        resetAt: 1_000_000 + CONVERSATION_MESSAGE_CAP_WINDOW_MS,
        retryAfterSeconds: 57 * 60,
      },
    });
    time.advance(57 * 60_000);
    expect(cap.admit({ conversationKey: "c1", origin: "agent" }).allowed).toBe(true);
  });

  it("does not count refused messages", () => {
    const cap = createConversationMessageCap({ maxPerWindow: 1, now: () => 5 });
    cap.admit({ conversationKey: "c1", origin: "channel" });
    cap.admit({ conversationKey: "c1", origin: "channel" });
    cap.admit({ conversationKey: "c1", origin: "channel" });
    expect(cap.count("c1")).toBe(1);
  });
});

describe("owner requests", () => {
  it("G-1566: limits are per conversation, so one busy session does not block another", () => {
    const cap = createConversationMessageCap({ maxPerWindow: 2, now: () => 0 });
    cap.admit({ conversationKey: "session-a", origin: "agent" });
    cap.admit({ conversationKey: "session-a", origin: "agent" });
    expect(cap.admit({ conversationKey: "session-a", origin: "agent" }).allowed).toBe(false);
    expect(cap.admit({ conversationKey: "session-b", origin: "agent" }).allowed).toBe(true);
  });

  it("G-1696: the owner's own messages count but are never refused", () => {
    const cap = createConversationMessageCap({ maxPerWindow: 2, now: () => 0 });
    for (let i = 0; i < 5; i += 1) {
      expect(cap.admit({ conversationKey: "c1", origin: "owner" }).allowed).toBe(true);
    }
    expect(cap.count("c1")).toBe(2);
    expect(cap.admit({ conversationKey: "c1", origin: "schedule" }).allowed).toBe(false);
    expect(cap.admit({ conversationKey: "c1", origin: "owner" }).allowed).toBe(true);
  });

  it("R-2377: the default cap is 60 messages per conversation per hour", () => {
    expect(DEFAULT_CONVERSATION_MESSAGES_PER_HOUR).toBe(60);
    const time = clock(0);
    const cap = createConversationMessageCap({ now: time.now });
    for (let i = 0; i < 60; i += 1) {
      expect(cap.admit({ conversationKey: "c1", origin: "channel" }).allowed).toBe(true);
    }
    expect(cap.admit({ conversationKey: "c1", origin: "channel" })).toMatchObject({
      allowed: false,
      violation: { max: 60, windowInMinutes: 60 },
    });
    time.advance(CONVERSATION_MESSAGE_CAP_WINDOW_MS);
    expect(cap.admit({ conversationKey: "c1", origin: "channel" }).allowed).toBe(true);
  });
});
