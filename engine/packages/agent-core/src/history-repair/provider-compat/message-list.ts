// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/agent/message-list/adapters/AIV5Adapter.ts (atlas AGENT-LOOP-0095). Adapted to Branch typed history bridge; assertions preserved.
import type {
  LanguageModelV2Prompt,
  MastraDBMessage,
  MastraMessagePart,
  PromptPart,
} from "./types.js";
export type { MastraDBMessage } from "./types.js";
/** In-memory compatibility view. Only the native Branch bridge commits repairs back to its transcript. */
export class MessageList {
  private messages: MastraDBMessage[] = [];
  constructor(_options: { threadId: string }) {}
  add(messages: MastraDBMessage[], _source: "input" | "response" | "memory") {
    this.messages.push(...messages);
    return this;
  }
  readonly get = {
    all: {
      db: () => this.messages,
      aiV5: { prompt: (): LanguageModelV2Prompt => this.messages.flatMap(toPrompt) },
    },
  };
}
function convertPart(part: MastraMessagePart): PromptPart | undefined {
  if (part.type === "step-start") return undefined;
  const providerOptions = part.providerOptions ?? part.providerMetadata;
  if (part.type === "reasoning")
    return {
      type: "reasoning",
      text: part.reasoning || part.text || part.details?.map((d) => d.text).join("") || "",
      providerOptions,
    };
  if (part.type === "text") return { type: "text", text: part.text, providerOptions };
  return {
    type: "tool-call",
    toolCallId: part.toolInvocation.toolCallId,
    toolName: part.toolInvocation.toolName,
    input: part.toolInvocation.args,
    providerOptions,
  };
}
function toPrompt(message: MastraDBMessage): LanguageModelV2Prompt {
  if (message.role === "system")
    return [
      {
        role: "system",
        content: message.content.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join(""),
      },
    ];
  if (message.role === "tool") return [];
  if (message.role === "user")
    return [
      {
        role: "user",
        content: message.content.parts.flatMap((p) => {
          const part = convertPart(p);
          return part ? [part] : [];
        }),
      },
    ];
  const output: LanguageModelV2Prompt = [];
  let parts: PromptPart[] = [];
  let results: Extract<PromptPart, { type: "tool-result" }>[] = [];
  const flush = () => {
    if (parts.length) output.push({ role: "assistant", content: parts });
    if (results.length) output.push({ role: "tool", content: results });
    parts = [];
    results = [];
  };
  message.content.parts.forEach((part, index) => {
    if (
      part.type === "step-start" ||
      (message.content.parts[index - 1]?.type === "tool-invocation" &&
        part.type !== "tool-invocation")
    )
      flush();
    const converted = convertPart(part);
    if (converted) parts.push(converted);
    if (part.type === "tool-invocation" && part.toolInvocation.state === "result") {
      const inv = part.toolInvocation;
      results.push({
        type: "tool-result",
        toolCallId: inv.toolCallId,
        toolName: inv.toolName,
        output: { type: typeof inv.result === "string" ? "text" : "json", value: inv.result },
      });
    }
  });
  flush();
  return output;
}
