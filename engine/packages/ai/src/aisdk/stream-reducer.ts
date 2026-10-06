// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/model.loop.ts (atlas AGENT-LOOP-0026). Adapted SDK stream output to Branch events; tool execution remains in Branch's admitted loop.
import { calculateCost } from "../model-utils.js";
import type {
  AssistantMessage,
  AssistantMessageEventStreamContract,
  Model,
  ToolCall,
} from "../types.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import type { AiSdkStreamPart } from "./generate-to-stream.js";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function number(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function applySdkFinish(
  output: AssistantMessage,
  model: Model,
  part: AiSdkStreamPart,
): void {
  const usage = record(part.usage);
  const input = record(usage.inputTokens);
  const tokens = record(usage.outputTokens);
  const totalInput =
    typeof usage.inputTokens === "number"
      ? usage.inputTokens
      : number(input.total ?? usage.promptTokens);
  output.usage.output =
    typeof usage.outputTokens === "number"
      ? usage.outputTokens
      : number(tokens.total ?? usage.completionTokens);
  output.usage.cacheRead = number(input.cacheRead ?? usage.cachedInputTokens);
  output.usage.cacheWrite = number(input.cacheWrite);
  output.usage.input =
    typeof input.noCache === "number"
      ? input.noCache
      : Math.max(0, totalInput - output.usage.cacheRead - output.usage.cacheWrite);
  output.usage.totalTokens = totalInput + output.usage.output;
  calculateCost(model, output.usage);
  const reason =
    typeof part.finishReason === "string" ? part.finishReason : record(part.finishReason).unified;
  output.stopReason =
    reason === "length"
      ? "length"
      : reason === "tool-calls" && output.content.some((p) => p.type === "toolCall")
        ? "toolUse"
        : "stop";
  if (reason === "error") throw new Error("AI SDK provider finished with an error");
  output.providerMetadata = { ...output.providerMetadata, ...record(part.providerMetadata) };
}

class SdkStreamReducer {
  private readonly indexes = new Map<string, number>();
  private readonly toolInputs = new Map<string, string>();
  private readonly rawParts: AiSdkStreamPart[] = [];
  private readonly providerTools = new Set<string>();
  private readonly ended = new Set<number>();
  private finished = false;
  constructor(
    private readonly output: AssistantMessage,
    private readonly stream: AssistantMessageEventStreamContract,
    private readonly model: Model,
  ) {}

  retain(part: AiSdkStreamPart): void {
    this.rawParts.push(part);
    this.output.providerMetadata = {
      ...this.output.providerMetadata,
      aiSdkRawParts: this.rawParts,
    };
  }
  startText(part: AiSdkStreamPart, thinking: boolean): number {
    const id = text(part.id) || (thinking ? "legacy-reasoning" : "legacy-text");
    const existing = this.indexes.get(id);
    if (existing !== undefined) return existing;
    const index = this.output.content.length;
    this.indexes.set(id, index);
    this.output.content.push(
      thinking ? { type: "thinking", thinking: "" } : { type: "text", text: "" },
    );
    if (thinking)
      this.stream.push({ type: "thinking_start", contentIndex: index, partial: this.output });
    else this.stream.push({ type: "text_start", contentIndex: index, partial: this.output });
    return index;
  }
  appendText(part: AiSdkStreamPart, thinking: boolean): void {
    const index = this.startText(part, thinking);
    const block = this.output.content[index]!;
    const delta = text(part.delta ?? part.textDelta);
    if (block.type === "thinking") {
      block.thinking += delta;
      this.stream.push({
        type: "thinking_delta",
        contentIndex: index,
        delta,
        partial: this.output,
      });
    } else if (block.type === "text") {
      block.text += delta;
      this.stream.push({ type: "text_delta", contentIndex: index, delta, partial: this.output });
    }
  }
  startTool(part: AiSdkStreamPart): number {
    const id = text(part.toolCallId ?? part.id);
    const existing = this.indexes.get(id);
    if (existing !== undefined) return existing;
    const index = this.output.content.length;
    this.indexes.set(id, index);
    this.output.content.push({ type: "toolCall", id, name: text(part.toolName), arguments: {} });
    this.stream.push({ type: "toolcall_start", contentIndex: index, partial: this.output });
    return index;
  }
  appendTool(part: AiSdkStreamPart): void {
    const id = text(part.toolCallId ?? part.id);
    if (part.providerExecuted === true) this.providerTools.add(id);
    if (this.providerTools.has(id)) return;
    const index = this.startTool(part);
    const block = this.output.content[index] as ToolCall;
    if (part.type === "tool-call") {
      const input = part.input ?? part.args;
      block.name = text(part.toolName) || block.name;
      block.arguments = typeof input === "string" ? record(JSON.parse(input)) : record(input);
      this.stream.push({
        type: "toolcall_end",
        contentIndex: index,
        toolCall: block,
        partial: this.output,
      });
    } else if (part.type === "tool-input-delta" || part.type === "tool-call-delta") {
      const delta = text(part.delta ?? part.argsTextDelta);
      const accumulated = (this.toolInputs.get(block.id) ?? "") + delta;
      this.toolInputs.set(block.id, accumulated);
      block.arguments = parseStreamingJson(accumulated);
      this.stream.push({
        type: "toolcall_delta",
        contentIndex: index,
        delta,
        partial: this.output,
      });
    }
  }
  endText(part: AiSdkStreamPart, thinking: boolean): void {
    const index = this.startText(part, thinking);
    const block = this.output.content[index]!;
    if (this.ended.has(index)) return;
    this.ended.add(index);
    if (block.type === "thinking")
      this.stream.push({
        type: "thinking_end",
        contentIndex: index,
        content: block.thinking,
        partial: this.output,
      });
    else if (block.type === "text")
      this.stream.push({
        type: "text_end",
        contentIndex: index,
        content: block.text,
        partial: this.output,
      });
  }
  consume(part: AiSdkStreamPart): void {
    if (part.type === "error") throw part.error;
    this.retain(part);
    switch (part.type) {
      case "text-start":
        this.startText(part, false);
        break;
      case "text-delta":
        this.appendText(part, false);
        break;
      case "text-end":
        this.endText(part, false);
        break;
      case "reasoning-start":
        this.startText(part, true);
        break;
      case "reasoning":
      case "reasoning-delta":
        this.appendText(part, true);
        break;
      case "reasoning-end":
        this.endText(part, true);
        break;
      case "tool-input-start":
      case "tool-input-delta":
      case "tool-call-delta":
      case "tool-call":
        this.appendTool(part);
        break;
      case "response-metadata":
        if (typeof part.id === "string") this.output.responseId = part.id;
        if (typeof part.modelId === "string") this.output.responseModel = part.modelId;
        break;
      case "finish":
        for (const [id, index] of this.indexes) {
          const block = this.output.content[index]!;
          if (block.type === "text" || block.type === "thinking")
            this.endText({ type: "end", id }, block.type === "thinking");
        }
        applySdkFinish(this.output, this.model, part);
        this.finished = true;
        break;
    }
  }
  assertFinished(): void {
    if (!this.finished) throw new Error("AI SDK stream ended without a finish event");
  }
}

export function createSdkStreamReducer(
  output: AssistantMessage,
  stream: AssistantMessageEventStreamContract,
  model: Model,
) {
  return new SdkStreamReducer(output, stream, model);
}
