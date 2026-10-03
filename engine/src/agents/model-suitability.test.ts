import { describe, expect, it } from "vitest";
import {
  formatModelSuitabilityWarning,
  isModelRecommendedForAgenticUse,
} from "./model-suitability.js";

describe("Continue model-family recommendation", () => {
  it.each([
    "gpt-4",
    "gpt-4-turbo",
    "gpt-4-0613",
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-16k",
    "o1-preview",
    "o1-mini",
    "o3",
    "gpt-3-davinci",
    "gpt-3-curie",
    "claude-3-opus",
    "claude-3-sonnet",
    "claude-2",
    "claude-2.1",
    "claude-1",
    "gemini-pro",
    "gemini-ultra",
    "llama2-70b",
    "llama2-7b",
    "codellama-34b",
    "mistral-7b",
    "mistral-small",
    "Llama 3.3 70B",
    "Llama 3.3 Nemotron 49B",
    "nvidia/Llama-3_3-Nemotron-Super-49B-v1",
    "llama-3.1-70b",
    "nemotron-4-340b",
    "Mistral Small 24B",
    "mistral-large",
    "mistral-small-24b",
    "codellama-instruct",
    "mistral-7b-instruct",
    "qwen-turbo",
    "qwen-max",
    "kimi-8k",
    "kimi-32k",
    "GPT-4",
    "Gpt-4-Turbo",
    "CLAUDE-3-OPUS",
    "grok-3",
  ])("retains upstream recognition of %s", (name) => {
    expect(isModelRecommendedForAgenticUse(name)).toBe(true);
  });

  it.each(["palm-2-chat", "falcon-7b", "starcoder-base", "any-model", "some-model"])(
    "does not recommend %s",
    (name) => {
      expect(isModelRecommendedForAgenticUse(name)).toBe(false);
    },
  );

  it.each(["gpt-4", "claude-3-opus", "gemini-pro"])(
    "matches either display name or internal ID for %s",
    (model) => {
      expect(isModelRecommendedForAgenticUse("custom-name", model)).toBe(true);
      expect(isModelRecommendedForAgenticUse(model, "internal-id")).toBe(true);
    },
  );

  it("keeps provider identity out of the name heuristic", () => {
    expect(
      formatModelSuitabilityWarning({ provider: "gpt-provider", model: "falcon-7b" }),
    ).toContain('Model "falcon-7b"');
    expect(formatModelSuitabilityWarning({ provider: "custom", model: "gpt-4" })).toBeUndefined();
  });

  it("uses the selected catalog row, without borrowing sibling model metadata", () => {
    const catalog = [
      { provider: "custom", id: "opaque", name: "GPT-4" },
      { provider: "other", id: "opaque", name: "Falcon" },
    ];
    expect(
      formatModelSuitabilityWarning({ provider: "custom", model: "opaque" }, catalog),
    ).toBeUndefined();
    expect(
      formatModelSuitabilityWarning({ provider: "other", model: "opaque" }, catalog),
    ).toContain('Model "Falcon"');
  });
});
