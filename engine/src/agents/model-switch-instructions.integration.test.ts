// From openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:codex-rs/core/tests/suite/model_switching.rs (atlas AGENT-LOOP-0098). Ported model-instruction request assertions to Branch's real Responses projection; service-tier and generated-media fixtures are not included here.
import type { AssistantMessage, Model, Context } from "@branch/llm-core";
import { describe, expect, it } from "vitest";
import { convertResponsesMessages } from "../../packages/ai/src/transports/openai-responses-replay-messages-internal.js";
import { createZeroUsage } from "../../packages/ai/src/usage.test-support.js";
import { wrapStreamFnModelSwitchInstructions } from "./model-switch-instructions.js";
const target: Model<"openai-responses"> = {
  id: "gpt-new",
  name: "new",
  provider: "openai",
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};
const prior: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "existing work" }],
  provider: "openai",
  api: target.api,
  model: "gpt-old",
  timestamp: 0,
  stopReason: "stop",
  usage: createZeroUsage(),
};
function project(context: Context, model: Model = target) {
  let projected: Context | undefined;
  const wrapper = wrapStreamFnModelSwitchInstructions((_model, next) => {
    projected = next;
    throw new Error("captured at provider boundary");
  });
  expect(() => wrapper(model, context)).toThrow("captured at provider boundary");
  if (!projected) throw Error("missing projection");
  return {
    context: projected,
    input: convertResponsesMessages(model, projected, new Set(["openai"])),
  };
}
describe("model switch request continuity", () => {
  it.each([undefined, "friendly", "pragmatic"])(
    "first_turn_model_change_appends_model_instructions_developer_message (%s)",
    () => {
      const source: Context = {
        systemPrompt: "target instructions",
        messages: [prior, { role: "user", content: "switch models", timestamp: 1 }],
      };
      const { input, context } = project(source);
      const developer = input.filter((i) => i.type === "message" && i.role === "developer");
      expect(developer.some((i) => JSON.stringify(i).includes("<model_switch>"))).toBe(true);
      expect(JSON.stringify(developer)).toContain("target instructions");
      expect(JSON.stringify(developer)).not.toContain("<personality_spec>");
      expect(context.messages[0]).toBe(prior);
      expect(source.messages).toHaveLength(2);
    },
  );
  it("model_change_appends_model_instructions_developer_message", () => {
    const { input } = project({ systemPrompt: "new instructions", messages: [prior] });
    expect(JSON.stringify(input)).toContain("The user was previously using a different model.");
    expect(JSON.stringify(input)).toContain("<model_switch>");
  });
  it("model_change_with_legacy_personality_override_only_appends_model_instructions", () => {
    const { input } = project({ systemPrompt: "new instructions", messages: [prior] });
    expect(JSON.stringify(input)).toContain("<model_switch>");
    expect(JSON.stringify(input)).not.toContain("<personality_spec>");
  });
  it.each(["inherited custom base instructions", "model-generated base instructions"])(
    "first_turn_after_empty_prefix_fork_preserves_inherited_base_instructions (%s)",
    (systemPrompt) => {
      const source: Context = { systemPrompt, messages: [] };
      const { context } = project(source);
      expect(context).toBe(source);
      expect(context.systemPrompt).toBe(systemPrompt);
    },
  );
  it("same-model follow-ups preserve the original request and reasoning-only changes", () => {
    const source: Context = {
      systemPrompt: "instructions",
      messages: [{ ...prior, model: target.id }],
    };
    expect(project(source).context).toBe(source);
  });
  it("model_switch_to_smaller_model_updates_token_context_window", () => {
    const source: Context = { systemPrompt: "instructions", messages: [prior] };
    let actual: Model | undefined;
    const wrapper = wrapStreamFnModelSwitchInstructions((m) => {
      actual = m;
      throw Error("capture");
    });
    expect(() => wrapper({ ...target, contextWindow: 32000 }, source)).toThrow("capture");
    expect(actual?.contextWindow).toBe(32000);
    expect(source.messages[0]).toBe(prior);
  });
});
