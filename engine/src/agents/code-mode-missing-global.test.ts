import { describe, expect, it } from "vitest";
import { describeMissingCodeModeGlobal } from "./code-mode-missing-global.js";

describe("describeMissingCodeModeGlobal", () => {
  it("lists tool and helper globals for an undefined name", () => {
    const error = "ReferenceError: automations is not defined\n    at branch-code-mode:user.js:1:1";
    const described = describeMissingCodeModeGlobal(error, ["wait", "exec", "exec"]);
    expect(described.startsWith(error)).toBe(true);
    expect(described).toContain("`automations` is not a Code Mode global.");
    expect(described).toContain(
      "Tool globals: exec, wait. Find other tools with catalog.search(query).",
    );
    expect(described).toContain("atob, btoa, crypto");
  });

  it("bounds a long tool list", () => {
    const tools = Array.from(
      { length: 45 },
      (_, index) => `tool_${String(index).padStart(2, "0")}`,
    );
    expect(describeMissingCodeModeGlobal("ReferenceError: tools is not defined", tools)).toContain(
      "tool_39 (+5 more)",
    );
  });

  it("leaves other errors unchanged", () => {
    for (const error of [
      "TypeError: x is not a function",
      "Error: ReferenceError: tools is not defined",
      "ReferenceError: Cannot access 'x' before initialization",
    ]) {
      expect(describeMissingCodeModeGlobal(error, ["exec"])).toBe(error);
    }
  });
});
