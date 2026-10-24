import { describe, expect, it } from "vitest";
import {
  isMemoryEmbeddingAccountFailure,
  MEMORY_EMBEDDING_ACCOUNT_BACKOFF_INITIAL_MS,
  MEMORY_EMBEDDING_ACCOUNT_BACKOFF_MAX_MS,
  MemoryEmbeddingAccountBackoff,
} from "./manager-embedding-account-backoff.js";
import { createMemoryEmbeddingOperationError } from "./manager-embedding-errors.js";

const QUOTA_MESSAGE =
  "openai embeddings failed (429): You have no credits remaining. Add credits to continue using the API. [type=insufficient_quota, code=credit_balance_exhausted]";

function quotaError() {
  return createMemoryEmbeddingOperationError({
    operation: "batch",
    providerId: "openai",
    cause: Object.assign(new Error(QUOTA_MESSAGE), { status: 429 }),
  });
}

function clock(start = 1_000_000) {
  const state = { now: start };
  return { state, now: () => state.now };
}

describe("memory embedding account backoff", () => {
  it.each([
    ["the live OpenAI no-credits message", new Error(QUOTA_MESSAGE)],
    ["a wrapped embedding operation error", quotaError()],
    ["an insufficient_quota code", Object.assign(new Error("429"), { code: "insufficient_quota" })],
    ["a 401 status", Object.assign(new Error("Unauthorized"), { status: 401 })],
    [
      "an invalid key message",
      new Error("openai embeddings failed (401): Incorrect API key provided"),
    ],
  ])("classifies %s as an account failure", (_name, error) => {
    expect(isMemoryEmbeddingAccountFailure(error)).toBe(true);
  });

  it.each([
    ["a rate limit", Object.assign(new Error("429 Too Many Requests"), { status: 429 })],
    ["a server error", Object.assign(new Error("HTTP 503"), { status: 503 })],
    ["a network failure", new Error("fetch failed: ECONNRESET")],
  ])("does not classify %s as an account failure", (_name, error) => {
    expect(isMemoryEmbeddingAccountFailure(error)).toBe(false);
  });

  it("logs one line per backoff window while the quota stays exhausted", () => {
    const { state, now } = clock();
    const backoff = new MemoryEmbeddingAccountBackoff(now);
    const logged: number[] = [];
    const first = MEMORY_EMBEDDING_ACCOUNT_BACKOFF_INITIAL_MS;
    const windows = [first, first * 2, first * 4];
    for (const windowMs of windows) {
      const windowStart = state.now;
      // A failure every 5 seconds, matching a busy session transcript.
      for (let elapsed = 0; elapsed < windowMs; elapsed += 5_000) {
        state.now = windowStart + elapsed;
        if (backoff.claimLog(quotaError())) {
          logged.push(state.now);
        }
        expect(backoff.isActive()).toBe(true);
      }
      state.now = windowStart + windowMs;
      expect(backoff.isActive()).toBe(false);
    }
    expect(logged).toEqual([1_000_000, 1_000_000 + first, 1_000_000 + first * 3]);
  });

  it("caps the window and resets after an embedding succeeds", () => {
    const { state, now } = clock();
    const backoff = new MemoryEmbeddingAccountBackoff(now);
    for (let i = 0; i < 10; i += 1) {
      backoff.recordFailure(quotaError());
      state.now += MEMORY_EMBEDDING_ACCOUNT_BACKOFF_MAX_MS;
    }
    backoff.recordFailure(quotaError());
    state.now += MEMORY_EMBEDDING_ACCOUNT_BACKOFF_MAX_MS - 1;
    expect(backoff.isActive()).toBe(true);
    state.now += 1;
    expect(backoff.isActive()).toBe(false);

    backoff.recordFailure(quotaError());
    backoff.recordSuccess();
    expect(backoff.isActive()).toBe(false);
    expect(backoff.claimLog(quotaError())).toBe(true);
    state.now += MEMORY_EMBEDDING_ACCOUNT_BACKOFF_INITIAL_MS - 1;
    expect(backoff.isActive()).toBe(true);
    state.now += 1;
    expect(backoff.isActive()).toBe(false);
  });

  it("always logs failures that are not account failures", () => {
    const backoff = new MemoryEmbeddingAccountBackoff(clock().now);
    const transient = Object.assign(new Error("HTTP 503"), { status: 503 });
    expect(backoff.claimLog(transient)).toBe(true);
    expect(backoff.claimLog(transient)).toBe(true);
    expect(backoff.isActive()).toBe(false);
  });
});
