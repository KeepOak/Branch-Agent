import { afterEach, describe, expect, it, vi } from "vitest";
import { failedAck, firmRefusal, isNotConnected, isRetryable, refusedOrUnsent, requestWithRetry } from "./send-errors";

/** An engine refusal, as the gateway client raises it (same shape as own-sends.test.ts). */
function refusal(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { gatewayCode: "INVALID_REQUEST", retryable: false, ...extra });
}

/** The send path marks Not sent when the engine refused or the request never left, and it is not retryable. */
function marksNotSent(error: unknown): boolean {
  return refusedOrUnsent(error) && !isRetryable(error);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connection errors", () => {
  it("isNotConnected is true only for the never-left-this-window error", () => {
    expect(isNotConnected(new Error("gateway not connected"))).toBe(true);
    expect(isNotConnected(new Error("gateway closed"))).toBe(false);
    expect(isNotConnected(new Error("gateway closed (1006)"))).toBe(false);
    expect(isNotConnected(new Error("timeout"))).toBe(false);
    expect(isNotConnected({ message: "gateway not connected" })).toBe(false);
    expect(isNotConnected("gateway not connected")).toBe(false);
    expect(isNotConnected(null)).toBe(false);
  });

  it("refusedOrUnsent is false for a connection that closed after the request left", () => {
    expect(refusedOrUnsent(refusal("busy"))).toBe(true);
    expect(refusedOrUnsent(new Error("gateway not connected"))).toBe(true);
    expect(refusedOrUnsent(new Error("gateway closed"))).toBe(false);
    expect(refusedOrUnsent(new Error("gateway closed (1006)"))).toBe(false);
    expect(refusedOrUnsent(new Error("timeout"))).toBe(false);
    expect(refusedOrUnsent({ gatewayCode: "INVALID_REQUEST" })).toBe(false);
    expect(refusedOrUnsent(null)).toBe(false);
  });
});

describe("retryable errors", () => {
  it("isRetryable is true for busy and session-handoff-lease refusals and never marks them Not sent", () => {
    const busy = refusal("busy", { retryable: true, retryAfterMs: 1 });
    const handoff = refusal("session is held by the previous engine", {
      gatewayCode: "UNAVAILABLE",
      retryable: true,
      retryAfterMs: 1,
      details: { reason: "session-handoff-lease" },
    });
    const firm = refusal("Attachments are too large.");
    const neverLeft = new Error("gateway not connected");

    expect(isRetryable(busy)).toBe(true);
    expect(isRetryable(handoff)).toBe(true);
    expect(marksNotSent(busy)).toBe(false);
    expect(marksNotSent(handoff)).toBe(false);
    expect(isRetryable(firm)).toBe(false);
    expect(marksNotSent(firm)).toBe(true);
    expect(isRetryable(neverLeft)).toBe(false);
    expect(marksNotSent(neverLeft)).toBe(true);
    expect(isRetryable({ gatewayCode: "UNAVAILABLE" })).toBe(false);
    expect(isRetryable({ retryable: true })).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });

  it("firmRefusal is a non-retryable engine no, not a connection that went or never left", () => {
    const firm = refusal("Attachments are too large.");
    const busy = refusal("busy", { retryable: true });
    const neverLeft = new Error("gateway not connected");
    const closedAfter = new Error("gateway closed (1006)");

    expect(firmRefusal(firm)).toBe(true);
    expect(firmRefusal(busy)).toBe(false);
    expect(firmRefusal(neverLeft)).toBe(false);
    expect(firmRefusal(closedAfter)).toBe(false);
    expect(firmRefusal(null)).toBe(false);
  });
});

describe("requestWithRetry", () => {
  it("retries a retryable refusal with back-off up to its limit and then surfaces the error", async () => {
    vi.useFakeTimers();
    const attempts: number[] = [];
    const send = vi.fn(async () => {
      attempts.push(Date.now());
      throw refusal("busy", { retryable: true, retryAfterMs: 100 });
    });

    const pending = requestWithRetry(send, 3).then(
      () => {
        throw new Error("expected a refusal");
      },
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toHaveLength(3);

    const error = await pending;
    expect(error).toMatchObject({ message: "busy", gatewayCode: "INVALID_REQUEST", retryable: true });
    expect(send).toHaveBeenCalledTimes(3);
    expect(attempts[1]! - attempts[0]!).toBe(100);
    expect(attempts[2]! - attempts[1]!).toBe(100);
    expect(isRetryable(error)).toBe(true);
    expect(marksNotSent(error)).toBe(false);
  });

  it("returns immediately on success without retry", async () => {
    const send = vi.fn(async () => ({ status: "ok" }));
    await expect(requestWithRetry(send)).resolves.toEqual({ status: "ok" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry a firm refusal or a never-left-this-window error", async () => {
    const firm = refusal("Attachments are too large.");
    const sendFirm = vi.fn(async () => {
      throw firm;
    });
    await expect(requestWithRetry(sendFirm)).rejects.toBe(firm);
    expect(sendFirm).toHaveBeenCalledTimes(1);

    const neverLeft = new Error("gateway not connected");
    const sendNeverLeft = vi.fn(async () => {
      throw neverLeft;
    });
    await expect(requestWithRetry(sendNeverLeft)).rejects.toBe(neverLeft);
    expect(sendNeverLeft).toHaveBeenCalledTimes(1);
  });

  it("caps the engine's wait at 5 s (a handoff lease) and asks again", async () => {
    vi.useFakeTimers();
    const send = vi.fn()
      .mockRejectedValueOnce(refusal("session is held by the previous engine", {
        gatewayCode: "UNAVAILABLE",
        retryable: true,
        retryAfterMs: 10_000,
        details: { reason: "session-handoff-lease" },
      }))
      .mockResolvedValueOnce({ status: "ok" });

    const promise = requestWithRetry(send);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ status: "ok" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits 250 ms when the refusal has no retryAfterMs", async () => {
    vi.useFakeTimers();
    const send = vi.fn()
      .mockRejectedValueOnce(refusal("busy", { retryable: true }))
      .mockResolvedValueOnce({ status: "ok" });

    const promise = requestWithRetry(send);
    await vi.advanceTimersByTimeAsync(249);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ status: "ok" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the last allowed attempt", async () => {
    vi.useFakeTimers();
    const send = vi.fn()
      .mockRejectedValueOnce(refusal("busy", { retryable: true }))
      .mockRejectedValueOnce(refusal("busy", { retryable: true }))
      .mockResolvedValueOnce({ status: "ok" });

    const promise = requestWithRetry(send);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toEqual({ status: "ok" });
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe("failedAck", () => {
  it("returns null for started, in_flight, ok, or a missing status", () => {
    expect(failedAck({ status: "started" })).toBeNull();
    expect(failedAck({ status: "in_flight" })).toBeNull();
    expect(failedAck({ status: "ok" })).toBeNull();
    expect(failedAck({})).toBeNull();
  });

  it("uses the engine's summary, else its error, as the words the person sees", () => {
    expect(failedAck({ status: "error", summary: "Attachments are too large." })).toBe("Attachments are too large.");
    expect(failedAck({ status: "failed", error: "Internal error" })).toBe("Internal error");
    expect(failedAck({ status: "error", summary: "Quota exceeded", error: "quota_exceeded" })).toBe("Quota exceeded");
  });

  it("falls back to The engine answered \"status\" when there is no reason", () => {
    expect(failedAck({ status: "error" })).toBe('The engine answered "error".');
    expect(failedAck({ status: "failed" })).toBe('The engine answered "failed".');
  });

  it("ignores a non-string or empty reason", () => {
    expect(failedAck({ status: "error", summary: 123 })).toBe('The engine answered "error".');
    expect(failedAck({ status: "error", error: null })).toBe('The engine answered "error".');
    expect(failedAck({ status: "error", summary: "" })).toBe('The engine answered "error".');
  });
});
