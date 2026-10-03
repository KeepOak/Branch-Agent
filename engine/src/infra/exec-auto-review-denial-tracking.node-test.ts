// Native offline fixtures for the pinned Qwen AUTO denial state machine.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUTO_MODE_DENIAL_LIMITS,
  consumePendingManualRetry,
  createDenialState,
  recordAllow,
  recordBlock,
  recordFallbackApprove,
  recordUnavailable,
  resetDenialState,
  shouldFallback,
} from "./exec-auto-review-denial-tracking.ts";

test("the source thresholds select manual fallback, never execution caps", () => {
  assert.deepEqual(AUTO_MODE_DENIAL_LIMITS, {
    maxConsecutiveBlock: 3, maxConsecutiveUnavailable: 2, maxTotalDenials: 20,
  });
  let state = createDenialState();
  state = recordBlock(state, "action-a");
  assert.deepEqual(shouldFallback(state, "action-a"), {
    fallback: true, reason: "classifier_blocked_retry",
  });
  assert.deepEqual(shouldFallback(state, "action-b"), { fallback: false });
  state = consumePendingManualRetry(state);
  assert.deepEqual(shouldFallback(state, "action-a"), { fallback: false });
  state = recordBlock(recordBlock(state));
  assert.deepEqual(shouldFallback(state), { fallback: true, reason: "consecutive_block" });
});

test("alternating failures and allowed calls retain cumulative denial history", () => {
  let state = createDenialState();
  for (let denial = 0; denial < AUTO_MODE_DENIAL_LIMITS.maxTotalDenials; denial++) {
    state = denial % 2 === 0 ? recordBlock(state) : recordUnavailable(state);
    state = recordAllow(state);
  }
  assert.equal(state.consecutiveBlock, 0);
  assert.equal(state.consecutiveUnavailable, 0);
  assert.deepEqual(shouldFallback(state), { fallback: true, reason: "total_denial" });
  assert.deepEqual(recordFallbackApprove(state), createDenialState());
});

test("manual approval recovers the reviewer after unavailability", () => {
  const state = recordUnavailable(recordUnavailable(createDenialState()));
  assert.deepEqual(shouldFallback(state), { fallback: true, reason: "consecutive_unavailable" });
  const recovered = recordFallbackApprove(state);
  assert.deepEqual(shouldFallback(recovered), { fallback: false });
  assert.equal(recovered.totalUnavailable, 2);
  assert.equal(recordUnavailable(recovered).consecutiveUnavailable, 1);
});

test("allowing a different action does not consume the blocked action's one-shot retry", () => {
  const state = recordBlock(createDenialState(), "blocked");
  const allowedOther = recordAllow(state, "other");
  assert.deepEqual(shouldFallback(allowedOther, "blocked"), {
    fallback: true, reason: "classifier_blocked_retry",
  });
  assert.deepEqual(shouldFallback(recordAllow(allowedOther, "blocked"), "blocked"), {
    fallback: false,
  });
});

test("block and unavailable signals cross-reset and mode changes clear all history", () => {
  const state = recordUnavailable(recordBlock(createDenialState(), "action"));
  assert.equal(state.consecutiveBlock, 0);
  assert.equal(state.consecutiveUnavailable, 1);
  const blocked = recordBlock(state);
  assert.equal(blocked.consecutiveUnavailable, 0);
  assert.equal(blocked.totalUnavailable, 1);
  assert.deepEqual(resetDenialState(), createDenialState());
});
