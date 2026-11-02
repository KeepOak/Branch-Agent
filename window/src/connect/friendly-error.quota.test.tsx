// @vitest-environment jsdom
// Quota text without a 429 (#1814): a raw quota dump reads as one plain sentence with a next step. Plain sentences,
// one-word states and other raw dumps keep their current reading.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { FRIENDLY_ERROR, QUOTA_ERROR, friendlyError, friendlyFailure } from "./friendly-error";
import { failedAck } from "./send-errors";
import { plainError } from "../shell/plain-error";
import { NotSent } from "../thread/blocks";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const OPENAI_JSON =
  '{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}}';
const OPENAI_LINE =
  "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors.";
const ANTHROPIC_JSON =
  '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';

describe("friendlyFailure quota text", () => {
  it("is one plain sentence with a next step", () => {
    expect(QUOTA_ERROR).toMatch(/[.]$/);
    expect(QUOTA_ERROR).toMatch(/\bAdd credits\b/);
    expect(QUOTA_ERROR).not.toMatch(/quota_|[{}]|\u2014/);
  });

  it("maps raw quota dumps that carry no 429", () => {
    for (const value of [
      "insufficient_quota",
      OPENAI_JSON,
      OPENAI_LINE,
      ANTHROPIC_JSON,
      new Error("Error: quota_exceeded"),
      { error: "billing_hard_limit_reached" },
    ]) {
      expect(friendlyFailure(value)).toBe(QUOTA_ERROR);
    }
  });

  it("maps a failed send ack that only says insufficient_quota", () => {
    expect(failedAck({ status: "error", error: "insufficient_quota" })).toBe(QUOTA_ERROR);
    expect(failedAck({ status: "error", summary: OPENAI_JSON })).toBe(QUOTA_ERROR);
  });

  it("leaves already-plain sentences and one-word states alone", () => {
    expect(friendlyFailure("Model quota exceeded. Retry after 2 minutes.")).toBe("Model quota exceeded. Retry after 2 minutes.");
    expect(friendlyFailure("Saved 250 files.")).toBe("Saved 250 files.");
    expect(friendlyFailure("Disconnected")).toBe("Disconnected");
    expect(friendlyFailure(QUOTA_ERROR)).toBe(QUOTA_ERROR);
  });

  it("keeps other raw dumps, and browser storage quota, on the generic line", () => {
    expect(friendlyFailure("HTTP 500: Internal Server Error")).toBe(FRIENDLY_ERROR);
    expect(friendlyFailure("QuotaExceededError")).toBe(FRIENDLY_ERROR);
    expect(friendlyFailure("DOMException QuotaExceededError")).toBe(FRIENDLY_ERROR);
    expect(friendlyFailure(undefined)).toBe(FRIENDLY_ERROR);
  });

  it("does not change friendlyError, so plainError still replaces a bare quota code", () => {
    expect(friendlyError("insufficient_quota")).toBe(FRIENDLY_ERROR);
    expect(plainError("insufficient_quota", true)).not.toContain("insufficient_quota");
    expect(plainError(QUOTA_ERROR, true)).toBe(QUOTA_ERROR);
  });
});

describe("Not sent reason", () => {
  it("reads a refusal that only says insufficient_quota as the quota sentence", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<NotSent text="hi" reason="insufficient_quota" onRetry={() => {}} onDiscard={() => {}} />));
    expect(host.querySelector(".send-why")?.textContent).toBe(QUOTA_ERROR);
    await act(async () => root.unmount());
    host.remove();
  });
});
