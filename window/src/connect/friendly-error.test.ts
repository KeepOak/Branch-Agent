import { describe, expect, it } from "vitest";
import { FRIENDLY_ERROR, friendlyError } from "./friendly-error";
import { failedAck } from "./send-errors";

const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

function assertSafe(text: string): void {
  expect(text).toBe(text.trim());
  expect(text).toMatch(/[.!?]$/);
  expect(text).toMatch(/\b(?:Retry|Try again|Start a new|Sign in|Open diagnostics|Choose another)\b/);
  expect(text).not.toMatch(/Error:/);
  expect(text).not.toMatch(/^\s*[{[]/);
  expect(text).not.toMatch(/\bHTTP\s*[1-5]\d{2}\b/i);
  expect(text).not.toMatch(/\n\s*at\s+/);
  expect(text).not.toMatch(/:\d+:\d+/);
  expect(text).not.toMatch(new RegExp(SAMPLE_ID, "i"));
  expect(text).not.toMatch(/\bchat\.send\b/);
  expect(text).not.toMatch(/\bECONNREFUSED\b/);
  expect(text).not.toMatch(/the engine answered/i);
  expect(text).not.toContain("\u2014");
}

describe("friendlyError", () => {
  it("turns an empty or unknown value into one sentence with Retry", () => {
    expect(friendlyError(undefined)).toBe(FRIENDLY_ERROR);
    expect(friendlyError(null)).toBe(FRIENDLY_ERROR);
    expect(friendlyError("")).toBe(FRIENDLY_ERROR);
    expect(friendlyError(500)).toBe(FRIENDLY_ERROR);
    expect(friendlyError({})).toBe(FRIENDLY_ERROR);
    assertSafe(friendlyError(undefined));
  });

  it("replaces a stack, an Error: prefix, JSON, a status, an id, and a method name", () => {
    const stack = "Error: boom\n    at send (connect/session.ts:12:3)";
    const json = '{"type":"error","error":{"message":"boom","type":"server_error"}}';
    for (const value of [
      stack,
      new Error("Error: boom"),
      json,
      "HTTP 500: Internal Server Error",
      "Authentication failed (provider returned HTTP 401).",
      `run ${SAMPLE_ID} failed`,
      "unknown method: chat.send",
      "ECONNREFUSED",
      "PLUGIN_STATE_READ_FAILED",
      'The engine answered "error".',
      "error",
      "failed",
    ]) {
      expect(friendlyError(value)).toBe(FRIENDLY_ERROR);
    }
  });

  it("keeps a short plain sentence and adds Retry when it has no next step", () => {
    expect(friendlyError("Couldn't send this message.")).toBe("Couldn't send this message. Retry.");
    expect(friendlyError("Couldn't send this message. Retry.")).toBe("Couldn't send this message. Retry.");
    expect(friendlyError("This conversation is full. Start a new one.")).toBe("This conversation is full. Start a new one.");
    expect(friendlyError(new Error("Couldn't reach the engine"))).toBe("Couldn't reach the engine. Retry.");
    expect(friendlyError({ message: "The model is busy. Try again." })).toBe("The model is busy. Try again.");
    assertSafe(friendlyError("Couldn't send this message."));
  });

  it("strips an Error: prefix from an otherwise plain sentence", () => {
    expect(friendlyError("Error: Couldn't send this message.")).toBe("Couldn't send this message. Retry.");
    expect(friendlyError(new Error("Error: Couldn't send this message."))).toBe("Couldn't send this message. Retry.");
  });
});

describe("failedAck", () => {
  it("leaves started, in_flight, and ok without a reason", () => {
    expect(failedAck({ status: "started" })).toBeNull();
    expect(failedAck({ status: "in_flight" })).toBeNull();
    expect(failedAck({ status: "ok" })).toBeNull();
    expect(failedAck({ status: "" })).toBeNull();
  });

  it("does not quote the status when the engine gives no summary", () => {
    expect(failedAck({ status: "error" })).toBe(FRIENDLY_ERROR);
    expect(failedAck({ status: "failed" })).toBe(FRIENDLY_ERROR);
    expect(failedAck({ status: "error" })).not.toContain("The engine answered");
    assertSafe(failedAck({ status: "error" })!);
  });

  it("rewrites a raw summary or error through the helper", () => {
    expect(failedAck({ status: "error", error: '{"type":"error"}' })).toBe(FRIENDLY_ERROR);
    expect(failedAck({ status: "error", summary: "HTTP 503" })).toBe(FRIENDLY_ERROR);
    expect(failedAck({ status: "error", summary: "Couldn't send this message." })).toBe("Couldn't send this message. Retry.");
  });
});
