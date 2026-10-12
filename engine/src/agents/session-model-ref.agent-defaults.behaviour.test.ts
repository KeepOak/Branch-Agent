// Behaviour tests derived from zhayujie/CowAgent@986f44a19508b572d15d40dcb8bd5b2796559ec7:tests/test_agent_model_defaults.py (atlas MODELS-ACCOUNTS-0104)
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveSessionModelRef } from "./session-model-ref.js";

type SessionModelEntry = NonNullable<Parameters<typeof resolveSessionModelRef>[1]>;

const GLOBAL = "openai/global-model";

function config(agentModel?: string): BranchConfig {
  return {
    agents: {
      defaults: { model: { primary: GLOBAL } },
      entries: { research: agentModel === undefined ? {} : { model: agentModel } },
    },
  } as BranchConfig;
}

function pinned(provider: string, model: string): SessionModelEntry {
  return { providerOverride: provider, modelOverride: model };
}

describe("which model answers: the conversation's choice, the agent's, or the global one", () => {
  it("uses the global one when nothing else is set", () => {
    expect(resolveSessionModelRef(config(), {}, "research")).toEqual({
      provider: "openai",
      model: "global-model",
    });
  });

  it("lets the agent's own beat the global one", () => {
    expect(resolveSessionModelRef(config("anthropic/agent-model"), {}, "research")).toEqual({
      provider: "anthropic",
      model: "agent-model",
    });
  });

  it("lets the conversation's choice beat the agent's own", () => {
    const cfg = config("anthropic/agent-model");
    expect(resolveSessionModelRef(cfg, pinned("deepseek", "pinned-model"), "research")).toEqual({
      provider: "deepseek",
      model: "pinned-model",
    });
  });

  it("falls back to the agent, not the global one, when the conversation pin is cleared", () => {
    const cfg = config("anthropic/agent-model");
    // The pin is gone; only the previous run's identity remains on the entry.
    const cleared: SessionModelEntry = {
      modelProvider: "deepseek",
      model: "pinned-model",
    };
    expect(resolveSessionModelRef(cfg, cleared, "research")).toEqual({
      provider: "anthropic",
      model: "agent-model",
    });
  });

  it("treats a blank agent default the same as none", () => {
    expect(resolveSessionModelRef(config("  "), { modelOverride: "  " }, "research")).toEqual({
      provider: "openai",
      model: "global-model",
    });
  });
});

describe("routing a model to its provider", () => {
  it("routes the agent's model through the agent's provider", () => {
    expect(resolveSessionModelRef(config("anthropic/some-model"), {}, "research").provider).toBe(
      "anthropic",
    );
  });

  it("keeps the conversation's provider when the conversation pins one", () => {
    const cfg = config("anthropic/some-model");
    expect(
      resolveSessionModelRef(cfg, pinned("deepseek", "other-model"), "research").provider,
    ).toBe("deepseek");
  });
});
