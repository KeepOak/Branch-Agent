// From openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:codex-rs/core/src/context/world_state/model_tests.rs (atlas AGENT-LOOP-0098). Converted to Vitest with empty-instruction and authoritative-snapshot regressions.
import { describe, expect, it } from "vitest";
import {
  renderModelInstructionsDiff,
  type PreviousModelState,
} from "./model-switch-instructions.js";
describe("ModelInstructionsState", () => {
  it("model_change_renders_when_persisted_or_inferred_from_previous_turn", () => {
    for (const previous of [
      { kind: "known", model: "gpt-old" },
      { kind: "unknown" },
      { kind: "absent" },
    ] satisfies PreviousModelState[]) {
      const result = renderModelInstructionsDiff({
        model: "gpt-new",
        previousModel: "gpt-old",
        instructions: "instructions",
        previous,
      });
      expect(result.snapshot).toBe("gpt-new");
      expect(result.fragment).toContain("<model_switch>");
      expect(result.fragment).toContain("</model_switch>");
    }
  });
  it("unchanged_model_does_not_render", () => {
    for (const previous of [
      { kind: "known", model: "gpt-test" },
      { kind: "absent" },
    ] satisfies PreviousModelState[]) {
      expect(
        renderModelInstructionsDiff({
          model: "gpt-test",
          previousModel: "gpt-test",
          instructions: "instructions",
          previous,
        }).fragment,
      ).toBeUndefined();
    }
  });
  it("empty instructions do not render a synthetic switch", () => {
    expect(
      renderModelInstructionsDiff({
        model: "new",
        previousModel: "old",
        instructions: "",
        previous: { kind: "unknown" },
      }).fragment,
    ).toBeUndefined();
  });
  it("known snapshots override a conflicting inference", () => {
    expect(
      renderModelInstructionsDiff({
        model: "new",
        previousModel: "old",
        instructions: "new instructions",
        previous: { kind: "known", model: "new" },
      }).fragment,
    ).toBeUndefined();
    expect(
      renderModelInstructionsDiff({
        model: "new",
        previousModel: "new",
        instructions: "new instructions",
        previous: { kind: "known", model: "old" },
      }).fragment,
    ).toContain("new instructions");
  });
});
