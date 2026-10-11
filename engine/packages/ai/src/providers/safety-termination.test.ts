// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_safety_termination_detectors.py (atlas AGENT-LOOP-0076)
import { describe, expect, it } from "vitest";
import type { AssistantMessageDiagnostic } from "../types.js";
import {
  detectOpenAICompatibleContentFilter,
  OPENAI_COMPATIBLE_CONTENT_FILTER_DETECTOR,
  recordSafetyTermination,
} from "./safety-termination.js";

// Ported from TestOpenAICompatibleContentFilterDetector. The upstream cases that read
// LangChain additional_kwargs and Azure content_filter_results are not ported: Branch
// streams finish_reason as a plain string and has no such metadata containers.
describe("TestOpenAICompatibleContentFilterDetector", () => {
  it("default matches content filter", () => {
    const hit = detectOpenAICompatibleContentFilter("content_filter");
    expect(hit).toBeDefined();
    expect(hit?.detector).toBe("openai_compatible_content_filter");
    expect(hit?.reasonField).toBe("finish_reason");
    expect(hit?.reasonValue).toBe("content_filter");
    expect(OPENAI_COMPATIBLE_CONTENT_FILTER_DETECTOR).toBe("openai_compatible_content_filter");
  });

  it("case insensitive match", () => {
    expect(detectOpenAICompatibleContentFilter("CONTENT_FILTER")).toBeDefined();
  });

  it("other finish reasons pass through", () => {
    expect(detectOpenAICompatibleContentFilter("stop")).toBeUndefined();
    expect(detectOpenAICompatibleContentFilter("tool_calls")).toBeUndefined();
    expect(detectOpenAICompatibleContentFilter("length")).toBeUndefined();
  });

  it("missing metadata passes through", () => {
    expect(detectOpenAICompatibleContentFilter(undefined)).toBeUndefined();
    expect(detectOpenAICompatibleContentFilter(null)).toBeUndefined();
    expect(detectOpenAICompatibleContentFilter("")).toBeUndefined();
  });

  it("non-string finish reason passes through", () => {
    // Some adapters may stash an enum or dict; detection must not raise.
    expect(detectOpenAICompatibleContentFilter(42)).toBeUndefined();
    expect(detectOpenAICompatibleContentFilter({ value: "content_filter" })).toBeUndefined();
  });

  it("configurable extra values", () => {
    const finishReasons = ["content_filter", "sensitive", "violation"];
    expect(detectOpenAICompatibleContentFilter("sensitive", finishReasons)).toBeDefined();
    expect(detectOpenAICompatibleContentFilter("violation", finishReasons)).toBeDefined();
    expect(detectOpenAICompatibleContentFilter("content_filter", finishReasons)).toBeDefined();
  });
});

// Branch-written: the refusal path that the detector feeds.
describe("recordSafetyTermination (branch-written)", () => {
  const termination = {
    detector: OPENAI_COMPATIBLE_CONTENT_FILTER_DETECTOR,
    reasonField: "finish_reason" as const,
    reasonValue: "content_filter",
  };

  it("records a provider_refusal diagnostic and keeps the raw errorMessage", () => {
    const message: { diagnostics?: AssistantMessageDiagnostic[]; errorMessage?: string } = {
      errorMessage: "Provider finish_reason: content_filter",
    };
    recordSafetyTermination(message, termination, "openai");

    expect(message.errorMessage).toBe("Provider finish_reason: content_filter");
    expect(message.diagnostics).toHaveLength(1);
    expect(message.diagnostics?.[0]).toMatchObject({
      type: "provider_refusal",
      details: {
        provider: "openai",
        category: "content_filter",
        detector: "openai_compatible_content_filter",
      },
    });
  });

  it("does not add a second refusal diagnostic to a message that already has one", () => {
    const message: { diagnostics?: AssistantMessageDiagnostic[]; errorMessage?: string } = {
      diagnostics: [{ type: "provider_refusal", timestamp: 0 }],
    };
    recordSafetyTermination(message, termination, "openai");

    expect(message.diagnostics).toHaveLength(1);
    expect(message.errorMessage).toBeUndefined();
  });

});
