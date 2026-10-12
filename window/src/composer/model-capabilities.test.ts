import { describe, expect, it } from "vitest";
import { readModel, readModels } from "./model";

describe("native model metadata projection", () => {
  it("keeps the advertised native runtime and independent alternative capabilities", () => {
    const model = readModel({
      id: "test-model", provider: "test-provider", available: true,
      agentRuntime: { id: "codex", source: "session" },
      runtimeChoices: [{
        agentRuntime: { id: "branch", source: "implicit" }, available: false,
        unavailableReason: "missing-auth", thinkingLevels: [{ id: "low", label: "Low" }],
        contextWindow: 8000, supportsFastMode: false, serviceTiers: ["standard"],
      }],
    });
    expect(model?.ref).toBe("test-provider/test-model");
    expect(model?.runtimeMetadata).toMatchObject({
      agentRuntime: { id: "codex", source: "session" }, available: true,
      runtimeChoices: [{ agentRuntime: { id: "branch", source: "implicit" }, available: false,
        unavailableReason: "missing-auth", contextWindow: 8000, supportsFastMode: false,
        thinkingLevels: [{ id: "low", label: "Low" }], serviceTiers: ["standard"] }],
    });
    expect(model?.levels).toEqual([]);
    expect(model?.supportsFastMode).toBe(false);
  });

  it("keeps unknown availability unknown without changing legacy selection states", () => {
    const model = readModel({ id: "test-model", provider: "test-provider" });
    expect(model?.runtimeMetadata?.available).toBeUndefined();
    expect(model?.runtimeMetadata?.agentRuntime).toBeUndefined();
    expect(model?.available).toBe(true);
  });

  it("does not treat truthy strings or malformed runtime objects as native capabilities", () => {
    const model = readModel({ id: "test-model", provider: "test-provider", available: "true",
      agentRuntime: { id: "codex", source: "invented" }, runtimeChoices: [null, "codex", { agentRuntime: { id: "codex" } }] });
    expect(model?.runtimeMetadata).toEqual({ thinkingLevels: [], contextWindows: [], serviceTiers: [], runtimeChoices: [] });
  });

  it("retains exact cooldown metadata and leaves manual selection policy intact", () => {
    const model = readModels({ models: [
      { id: "test-model", provider: "test-provider", available: false, unavailableReason: "cooldown", unavailableUntil: 123456 },
      { id: "hidden", provider: "test-provider", manualSelectionAllowed: false },
    ] });
    expect(model).toHaveLength(1);
    expect(model[0].runtimeMetadata).toMatchObject({ available: false, unavailableReason: "cooldown", unavailableUntil: 123456 });
    expect(model[0].available).toBe(false);
  });

  it("keeps native efforts, context choices and service tiers separate from another runtime", () => {
    const model = readModel({ id: "test-model", provider: "test-provider",
      agentRuntime: { id: "codex", source: "provider" }, supportsTools: true, supportsFastMode: false,
      thinkingLevels: [{ id: "xhigh", label: "Extra high" }], contextWindows: [{ id: "long", label: "Long", contextWindow: 120000 }],
      contextWindowDefault: "long", serviceTiers: ["standard"],
      runtimeChoices: [{ agentRuntime: { id: "branch", source: "implicit" }, supportsFastMode: true, serviceTiers: ["ultrafast"] }],
    });
    expect(model?.runtimeMetadata).toMatchObject({ supportsFastMode: false, thinkingLevels: [{ id: "xhigh", label: "Extra high" }],
      contextWindows: [{ id: "long", label: "Long", contextWindow: 120000 }], contextWindowDefault: "long", serviceTiers: ["standard"] });
    expect(model?.serviceTiers).toEqual(["standard"]);
  });
});
