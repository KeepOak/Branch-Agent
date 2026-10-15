// The model menu names an account once, not on every row, and never shows the engine's raw provider id.
import { describe, expect, it } from "vitest";
import type { ModelChoice } from "./model";
import { modelLine } from "./ModelMenu";

const model = (patch: Partial<ModelChoice>): ModelChoice => ({
  ref: "openai/gpt-6.1", id: "gpt-6.1", name: "GPT-6.1 Sol", provider: "openai", available: true, local: false, ...patch,
} as unknown as ModelChoice);

describe("a model row's line", () => {
  it("shows nothing for a usable hosted model, so the account email is not repeated on every row", () => {
    expect(modelLine(model({}))).toBeUndefined();
  });

  it("explains a problem in plain words", () => {
    expect(modelLine(model({ available: false, runtimeMetadata: { available: false, unavailableReason: "missing-auth" } } as Partial<ModelChoice>))).toBe("sign-in needed");
    expect(modelLine(model({ available: false }))).toBe("Unavailable");
  });

  it("names this computer for a local model", () => {
    expect(modelLine(model({ local: true }))).toBe("On this computer · free · private");
  });
});
