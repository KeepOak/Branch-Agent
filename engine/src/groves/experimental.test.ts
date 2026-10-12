import { describe, expect, it } from "vitest";
import { assertExperimentalGrovesEnabled, isExperimentalGrovesEnabled } from "./experimental.js";

describe("experimental Groves gate", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(isExperimentalGrovesEnabled({})).toBe(false);
    expect(isExperimentalGrovesEnabled({ BRANCH_EXPERIMENTAL_GROVES: "0" })).toBe(false);
    expect(isExperimentalGrovesEnabled({ BRANCH_EXPERIMENTAL_GROVES: "false" })).toBe(false);
  });

  it("accepts explicit process opt-ins", () => {
    expect(isExperimentalGrovesEnabled({ BRANCH_EXPERIMENTAL_GROVES: "1" })).toBe(true);
    expect(isExperimentalGrovesEnabled({ BRANCH_EXPERIMENTAL_GROVES: "TRUE" })).toBe(true);
  });

  it("rejects direct handler access when disabled", () => {
    expect(() => assertExperimentalGrovesEnabled({})).toThrow("BRANCH_EXPERIMENTAL_GROVES=1");
  });
});
