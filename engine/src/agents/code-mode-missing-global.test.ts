import { describe, expect, it } from "vitest";
import { createCodeModeCatalogBindings } from "./code-mode-catalog.js";
import {
  CODE_MODE_GLOBAL_NAMES,
  CODE_MODE_RESERVED_GLOBAL_NAMES,
} from "./code-mode-global-names.js";
import { describeMissingCodeModeGlobal } from "./code-mode-missing-global.js";
import { isShellLikeCodeModeSource } from "./code-mode-shell-source.js";

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

  it("lists swarm helpers separately", () => {
    expect(describeMissingCodeModeGlobal("ReferenceError: x is not defined", [])).toContain(
      "Swarm helpers (when enabled): agents, phase, log.",
    );
  });
});

describe("Code Mode global names", () => {
  it("reserves every helper, swarm and namespace global for catalog callables", () => {
    const names = [
      ...CODE_MODE_GLOBAL_NAMES.helpers,
      ...CODE_MODE_GLOBAL_NAMES.swarm,
      ...CODE_MODE_GLOBAL_NAMES.namespaces,
    ];
    const bindings = createCodeModeCatalogBindings(
      names.map((name) => ({
        id: "branch:" + name,
        source: "branch" as const,
        name,
        description: name,
      })),
    );
    expect(bindings).toHaveLength(names.length);
    for (const binding of bindings) {
      expect(CODE_MODE_RESERVED_GLOBAL_NAMES.has(binding.callableName)).toBe(false);
      expect(binding.callableName).toMatch(/_[a-f0-9]{8,}$/u);
    }
  });

  it("treats helper globals as JavaScript, not shell commands", () => {
    expect(isShellLikeCodeModeSource("results.load(id)")).toBe(false);
    expect(isShellLikeCodeModeSource("crypto.randomUUID()")).toBe(false);
    expect(isShellLikeCodeModeSource("log show --last 1h")).toBe(true);
  });
});
