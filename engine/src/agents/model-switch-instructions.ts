// From openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:codex-rs/core/src/context/model_switch_instructions.rs and codex-rs/core/src/context/world_state/model.rs (atlas AGENT-LOOP-0098). Converted to TypeScript; Branch supplies its prepared target-model instructions.
import type { AgentMessage, StreamFn } from "./runtime/index.js";

export type PreviousModelState = { kind: "known"; model: string } | { kind: "unknown" | "absent" };

/** Known snapshots take precedence over the previous-turn inference, as in Codex. */
export function renderModelInstructionsDiff(params: {
  model: string;
  previousModel?: string;
  instructions: string;
  previous: PreviousModelState;
}): { snapshot: string; fragment?: string } {
  const prior = params.previous.kind === "known" ? params.previous.model : params.previousModel;
  const changed = prior !== undefined && prior !== params.model;
  return {
    snapshot: params.model,
    ...(changed && params.instructions.length > 0
      ? {
          fragment: `<model_switch>\nThe user was previously using a different model. Please continue the conversation according to the following instructions:\n\n${params.instructions}\n</model_switch>`,
        }
      : {}),
  };
}

function previousAssistantModel(messages: readonly AgentMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant" && message.model && message.provider) {
      return `${message.provider}/${message.model}`;
    }
  }
  return undefined;
}

/** Request-only developer context; durable user turns and inherited history stay intact. */
export function wrapStreamFnModelSwitchInstructions(baseFn: StreamFn): StreamFn {
  return (model, context, options) => {
    const { fragment } = renderModelInstructionsDiff({
      model: `${model.provider}/${model.id}`,
      previousModel: previousAssistantModel(context.messages),
      instructions: context.systemPrompt ?? "",
      previous: { kind: "unknown" },
    });
    if (!fragment) return baseFn(model, context, options);
    const message: AgentMessage = {
      role: "user",
      content: fragment,
      runtimeContext: { retained: false },
      timestamp: Date.now(),
    };
    return baseFn(model, { ...context, messages: [...context.messages, message] }, options);
  };
}
