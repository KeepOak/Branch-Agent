import { getAiTransportHost } from "../host.js";
// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/model.loop.ts (atlas AGENT-LOOP-0026). Replaced Mastra MessageList with Branch's canonical transcript and version-specific provider prompts.
import type { Context, Message, Model, StreamOptions } from "../types.js";
import { type AiSdkLanguageModel, type AiSdkCallOptions } from "./model-adapters.js";

function projectMessage(
  message: Message,
  version: AiSdkLanguageModel["specificationVersion"],
): object {
  if (message.role === "toolResult") {
    return {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          ...(version === "v1"
            ? { result: message.content }
            : {
                output: { type: "json", value: message.content },
              }),
          isError: message.isError,
        },
      ],
    };
  }
  const content =
    typeof message.content === "string"
      ? [{ type: "text", text: message.content }]
      : message.content.map((part) => {
          if (part.type === "image")
            return {
              type: "image",
              image: Uint8Array.from(atob(part.data), (char) => char.charCodeAt(0)),
              ...(version === "v1" ? { mimeType: part.mimeType } : { mediaType: part.mimeType }),
            };
          if (part.type === "thinking") return { type: "reasoning", text: part.thinking };
          if (part.type === "toolCall")
            return {
              type: "tool-call",
              toolCallId: part.id,
              toolName: part.name,
              ...(version === "v1" ? { args: part.arguments } : { input: part.arguments }),
            };
          return { ...part };
        });
  return { role: message.role, content };
}

function responseFormat(format: StreamOptions["responseFormat"]) {
  if (!format) return undefined;
  if (format.type === "text") return { type: "text" };
  if (format.type === "json_object") return { type: "json" };
  if (format.type === "json_schema") {
    const descriptor =
      typeof format.json_schema === "object" && format.json_schema !== null
        ? (format.json_schema as Record<string, unknown>)
        : format;
    return {
      type: "json",
      schema: descriptor.schema,
      name: descriptor.name,
      description: descriptor.description,
    };
  }
  return { type: "json", schema: format };
}

export function createSdkCallOptions(
  sdk: AiSdkLanguageModel,
  model: Model,
  context: Context,
  options?: StreamOptions,
): AiSdkCallOptions {
  const messages = getAiTransportHost().transformTransportMessages(context.messages, model);
  const prompt: object[] = context.systemPrompt
    ? [{ role: "system", content: context.systemPrompt }]
    : [];
  prompt.push(...messages.map((message) => projectMessage(message, sdk.specificationVersion)));
  const tools = context.tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    ...(sdk.specificationVersion === "v1"
      ? { parameters: tool.parameters }
      : { inputSchema: tool.parameters }),
  }));
  const common = {
    prompt,
    tools,
    temperature: options?.temperature,
    abortSignal: options?.signal,
    headers: options?.headers,
    stopSequences: options?.stop,
  };
  const structured = responseFormat(options?.responseFormat);
  // The SDK prompt contracts share roles but differ in image and tool-result fields.
  // projectMessage builds those fields explicitly before this union boundary.
  return (
    sdk.specificationVersion === "v1"
      ? {
          ...common,
          inputFormat: "messages",
          maxTokens: options?.maxTokens,
          mode:
            structured?.type === "json"
              ? { ...structured, type: "object-json" }
              : { type: "regular", tools },
        }
      : {
          ...common,
          maxOutputTokens: options?.maxTokens,
          responseFormat: structured,
        }
  ) as AiSdkCallOptions;
}
