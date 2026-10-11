// From janhq/jan@e0c62f863a1b930ed625085979a3d62c947635d9:src-tauri/src/core/agent/plan.rs (atlas AGENT-LOOP-0222)
// Upstream license: Apache-2.0, Copyright 2025 Menlo Research (see THIRD_PARTY_NOTICES.md).
import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_MODE, parseRunMode, type RunMode } from "./plan-mode.js";

describe("plan mode run mode", () => {
  it("run_mode_default_is_normal", () => {
    expect(DEFAULT_RUN_MODE).toBe("normal");
  });

  it("run_mode_serializes_snake_case", () => {
    const plan: RunMode = "plan";
    expect(JSON.stringify(plan)).toBe('"plan"');
    expect(parseRunMode("normal")).toBe("normal");
  });
});
