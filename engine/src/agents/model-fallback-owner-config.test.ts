import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveModelFallbackAvailability } from "./agent-scope.js";

// The owner's config: Claude Opus/Sonnet and gpt-6-sol fall back to each other; no primary is set.
const cfg = {
  agents: {
    defaults: {
      model: {
        fallbacks: ["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5", "openai/gpt-6-sol"],
      },
    },
    entries: { tk: {}, dev: {} },
  },
} as unknown as BranchConfig;

describe("owner fallback ladder", () => {
  it("is available to a chat on the Trunk's model", () => {
    expect(
      resolveModelFallbackAvailability({ cfg, agentId: "tk", hasSessionModelOverride: false }),
    ).toMatchObject({
      kind: "active",
      models: ["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5", "openai/gpt-6-sol"],
    });
  });

  it("stays off for a chat pinned to a model the owner picked, as upstream decides", () => {
    expect(
      resolveModelFallbackAvailability({
        cfg,
        agentId: "tk",
        hasSessionModelOverride: true,
        modelOverrideSource: "user",
      }),
    ).toMatchObject({ kind: "disabled_by_model_override" });
  });
});
