import { describe, expect, it } from "vitest";
import { isPreparationPending } from "./preparation-status";

describe("isPreparationPending", () => {
  it("treats engine startup gates as preparation, so the window retries and says the Trunk is getting ready", () => {
    expect(isPreparationPending(new Error("models.list unavailable during gateway startup"))).toBe(true);
    expect(isPreparationPending(new Error("chat.send unavailable during gateway startup"))).toBe(true);
    expect(isPreparationPending("Model catalog is not ready yet; retry shortly")).toBe(true);
    expect(isPreparationPending(new Error("agent main has not completed startup inspection and preparation"))).toBe(true);
    expect(isPreparationPending(new Error("PluginInstanceUnavailableError: Plugin openai was reloaded or disabled; use its current tools."))).toBe(true);
  });

  it("leaves real failures as errors", () => {
    expect(isPreparationPending(new Error("unknown method: models.lists"))).toBe(false);
    expect(isPreparationPending(new Error("model not found"))).toBe(false);
    expect(isPreparationPending(null)).toBe(false);
  });
});
