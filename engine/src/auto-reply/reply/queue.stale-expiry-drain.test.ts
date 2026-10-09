// A stale-expired reply owner must not retry follow-up drain forever.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAbortError } from "../../infra/abort-signal.js";
import { defaultRuntime } from "../../runtime.js";
import { enqueueFollowupRun, scheduleFollowupDrain } from "./queue.js";
import { createQueueTestRun as createRun } from "./queue.test-helpers.js";
import { clearFollowupDrainCallback } from "./queue/drain.js";
import { clearFollowupQueue, getExistingFollowupQueue } from "./queue/state.js";
import { forceClearReplyOperation, replyRunRegistry } from "./reply-run-registry.js";
import { expireStaleReplyOperation } from "./reply-run-registry.state.js";
import { createTestReplyOperation } from "./reply-run-registry.test-helpers.js";
import { testing } from "./reply-run-registry.test-support.js";

const STALE_EXPIRED = "Reply operation expired as stale";
const defaults = { mode: "followup" as const, debounceMs: 0, cap: 50 };
let key: string;

beforeEach(() => {
  key = "agent:main:stale-expiry-drain";
});

afterEach(() => {
  clearFollowupQueue(key);
  clearFollowupDrainCallback(key);
  testing.resetReplyRunRegistry();
});

describe("followup queue drain stale-expired owner", () => {
  it("drops a stale-expired owner after a bounded retry instead of looping", async () => {
    const operation = createTestReplyOperation({
      sessionKey: key,
      sessionId: "session-stale-expiry-drain",
    });
    operation.setPhase("running");
    operation.attachBackend({
      kind: "embedded",
      cancel: () => {},
      isStreaming: () => true,
    });
    expect(expireStaleReplyOperation(operation, "no_activity")).toBe(false);
    expect(replyRunRegistry.get(key)).toBe(operation);

    const errors: string[] = [];
    const previousError = defaultRuntime.error;
    defaultRuntime.error = ((message?: unknown) => {
      errors.push(String(message));
    }) as typeof defaultRuntime.error;
    let attempts = 0;
    try {
      enqueueFollowupRun(key, createRun({ prompt: "retry stale owner" }), defaults);
      scheduleFollowupDrain(key, async () => {
        attempts += 1;
        throw createAbortError(STALE_EXPIRED);
      });

      await vi.waitFor(() => expect(getExistingFollowupQueue(key)).toBeUndefined(), {
        timeout: 2_000,
      });
      const attemptsAfterDrop = attempts;
      expect(attemptsAfterDrop).toBeGreaterThanOrEqual(1);
      expect(attemptsAfterDrop).toBeLessThanOrEqual(2);
      expect(errors.filter((line) => line.includes("followup queue drain failed"))).toHaveLength(0);
      expect(errors.filter((line) => line.includes("dropped stale-expired owner"))).toHaveLength(1);
      expect(replyRunRegistry.get(key)).toBeUndefined();

      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      expect(attempts).toBe(attemptsAfterDrop);
    } finally {
      defaultRuntime.error = previousError;
      forceClearReplyOperation(operation);
    }
  });

  it("keeps the follow-up queue when a live successor owns the key", async () => {
    key = "agent:main:stale-expiry-successor";
    const operation = createTestReplyOperation({
      sessionKey: key,
      sessionId: "session-stale-expiry-predecessor",
    });
    operation.setPhase("running");
    operation.attachBackend({
      kind: "embedded",
      cancel: () => {},
      isStreaming: () => true,
    });
    expect(expireStaleReplyOperation(operation, "no_activity")).toBe(false);
    expect(replyRunRegistry.get(key)).toBe(operation);

    const errors: string[] = [];
    const previousError = defaultRuntime.error;
    defaultRuntime.error = ((message?: unknown) => {
      errors.push(String(message));
    }) as typeof defaultRuntime.error;
    let attempts = 0;
    let successor: ReturnType<typeof createTestReplyOperation> | undefined;
    try {
      enqueueFollowupRun(key, createRun({ prompt: "keep successor queue" }), defaults);
      scheduleFollowupDrain(key, async () => {
        attempts += 1;
        if (attempts === 1) {
          throw createAbortError(STALE_EXPIRED);
        }
        if (!successor) {
          successor = createTestReplyOperation({
            sessionKey: key,
            sessionId: "session-stale-expiry-successor",
          });
          successor.setPhase("running");
        }
        if (attempts === 2) {
          throw createAbortError(STALE_EXPIRED);
        }
      });

      await vi.waitFor(() => expect(attempts).toBeGreaterThanOrEqual(3), {
        timeout: 2_000,
      });
      await vi.waitFor(() => expect(getExistingFollowupQueue(key)).toBeUndefined(), {
        timeout: 2_000,
      });
      expect(errors.filter((line) => line.includes("dropped stale-expired owner"))).toHaveLength(0);
      expect(replyRunRegistry.get(key)).toBe(successor);
    } finally {
      defaultRuntime.error = previousError;
      forceClearReplyOperation(operation);
      if (successor) {
        forceClearReplyOperation(successor);
      }
    }
  });
});
