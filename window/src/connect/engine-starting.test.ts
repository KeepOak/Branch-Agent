import { describe, expect, it } from "vitest";
import { isEngineStarting } from "./gateway";

describe("isEngineStarting", () => {
  it("recognises the engine's startup refusal so the window retries quickly", () => {
    expect(isEngineStarting({ reason: "startup-sidecars" })).toBe(true);
  });

  it("does not treat other connect failures as startup", () => {
    expect(isEngineStarting({ code: "PAIRING_REQUIRED" })).toBe(false);
    expect(isEngineStarting(undefined)).toBe(false);
    expect(isEngineStarting("startup-sidecars")).toBe(false);
  });
});
