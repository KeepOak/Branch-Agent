// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/processors/provider-history-compat.ts (atlas AGENT-LOOP-0095). Branch native transcript adapter; outgoing rewrites retain source payloads and repairs are confined to the request history.
import { replaceCompactionReplayOwnerContent } from "@branch/ai/transports";
import type { Context, Message, Model, AssistantMessage } from "@branch/llm-core";
import { copyInternalToolResultState } from "../../internal-hooks.js";
import { ProviderHistoryCompat } from "./provider-history-compat.js";
import { ProcessorRunner } from "./runner.js";
import {
  APICallError,
  type LanguageModelV2Prompt,
  type MastraDBMessage,
  type PromptPart,
  type MastraMessagePart,
} from "./types.js";
const SOURCE_MESSAGE = Symbol("branch-message");
const SOURCE_PART = Symbol("branch-part");
type LinkedDbPart = MastraMessagePart & { [SOURCE_PART]?: LinkedPart };
type NativePart = AssistantMessage["content"][number];
type LinkedPart = PromptPart & { [SOURCE_PART]?: NativePart };
type LinkedMessage = LanguageModelV2Prompt[number] & { [SOURCE_MESSAGE]?: Message };
function providerId(provider: string, api: string): string {
  if (provider === "anthropic" && api === "anthropic-messages") return "anthropic.messages";
  if (provider === "openai") return api === "openai-responses" ? "openai.responses" : "openai.chat";
  if (provider === "azure-openai") return "azure.responses";
  if (provider === "google") return "google.generative-ai";
  return provider;
}
function nativePart(part: NativePart, message: AssistantMessage): LinkedPart {
  if (part.type === "toolCall")
    return {
      type: "tool-call",
      toolCallId: part.id,
      toolName: part.name,
      input: part.arguments,
      ...(message.api.includes("responses") && part.id.includes("|")
        ? {
            providerOptions: {
              [message.api.startsWith("azure") ? "azure" : "openai"]: {
                itemId: part.id.split("|")[1],
              },
            },
          }
        : {}),
      [SOURCE_PART]: part,
    };
  if (part.type === "text") return textNativePart(part, message);
  return {
    type: "reasoning",
    text: part.thinking,
    ...(message.api === "anthropic-messages"
      ? {
          providerOptions: {
            anthropic: { ...(part.thinkingSignature ? { signature: part.thinkingSignature } : {}) },
          },
        }
      : {}),
    [SOURCE_PART]: part,
  };
}
function textNativePart(
  part: Extract<NativePart, { type: "text" }>,
  message: AssistantMessage,
): LinkedPart {
  let id = part.textSignature;
  if (id?.startsWith("{")) {
    try {
      const value: unknown = JSON.parse(id);
      id =
        value && typeof value === "object" && "id" in value && typeof value.id === "string"
          ? value.id
          : undefined;
    } catch {
      /* Legacy opaque IDs stay unchanged. */
    }
  }
  return {
    type: "text",
    text: part.text,
    ...(id && message.api.includes("responses")
      ? {
          providerOptions: {
            [message.api.startsWith("azure") ? "azure" : "openai"]: { itemId: id },
          },
        }
      : {}),
    [SOURCE_PART]: part,
  };
}

export function nativePrompt(context: Context): LanguageModelV2Prompt {
  const prompt: LanguageModelV2Prompt = context.systemPrompt
    ? [{ role: "system", content: context.systemPrompt }]
    : [];
  for (const message of context.messages) {
    let item: LanguageModelV2Prompt[number];
    if (message.role === "assistant")
      item = {
        role: "assistant",
        content: message.content.map((part) => nativePart(part, message)),
      };
    else if (message.role === "user")
      item = {
        role: "user",
        content:
          typeof message.content === "string"
            ? [{ type: "text", text: message.content }]
            : message.content.map((part) =>
                part.type === "text"
                  ? { type: "text", text: part.text }
                  : { type: "file", data: part.data, mediaType: part.mimeType },
              ),
      };
    else
      item = {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName: message.toolName,
            output: { type: "json", value: message.content },
          },
        ],
      };
    (item as LinkedMessage)[SOURCE_MESSAGE] = message;
    prompt.push(item);
  }
  return prompt;
}
function dbPart(part: LinkedPart): MastraMessagePart | undefined {
  if (part.type === "text" || part.type === "reasoning")
    return { type: part.type, text: part.text, providerMetadata: part.providerOptions };
  if (part.type === "tool-call")
    return {
      type: "tool-invocation",
      toolInvocation: {
        state: "call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.input as Record<string, unknown>,
      },
      providerMetadata: part.providerOptions,
    };
  return undefined;
}
export function nativeMessageList(prompt: LanguageModelV2Prompt) {
  const messages: MastraDBMessage[] = prompt.map((item, index) => {
    const source = (item as LinkedMessage)[SOURCE_MESSAGE];
    return {
      id: String(source?.timestamp ?? index),
      role: item.role,
      createdAt: new Date(source?.timestamp ?? 0),
      content: {
        format: 2,
        metadata:
          source?.role === "assistant"
            ? { provider: providerId(source.provider, source.api) }
            : undefined,
        parts:
          typeof item.content === "string"
            ? [{ type: "text", text: item.content }]
            : item.content.flatMap((p) => {
                const part = dbPart(p);
                return part ? [Object.assign(part, { [SOURCE_PART]: p })] : [];
              }),
      },
    } satisfies MastraDBMessage;
  });
  return { get: { all: { db: () => messages } } };
}
function restorePart(part: LinkedPart): NativePart | undefined {
  const source = part[SOURCE_PART];
  if (!source) return undefined;
  if (source.type === "toolCall" && part.type === "tool-call")
    return source.id === part.toolCallId ? source : { ...source, id: part.toolCallId };
  if (source.type === "text" && part.type === "text")
    return source.text === part.text ? source : { ...source, text: part.text };
  return source;
}
export function restoreNativeContext(context: Context, prompt: LanguageModelV2Prompt): Context {
  const messages: Message[] = [];
  let systemPrompt = context.systemPrompt;
  for (const item of prompt) {
    if (item.role === "system") {
      systemPrompt = item.content;
      continue;
    }
    const source = (item as LinkedMessage)[SOURCE_MESSAGE];
    if (!source) continue;
    if (source.role === "assistant" && item.role === "assistant") {
      const content = item.content.flatMap((p) => {
        const part = restorePart(p);
        return part ? [part] : [];
      });
      if (content.length) messages.push(replaceCompactionReplayOwnerContent(source, content));
    } else if (source.role === "toolResult" && item.role === "tool")
      messages.push(
        copyInternalToolResultState(source, {
          ...source,
          toolCallId: item.content[0]?.toolCallId ?? source.toolCallId,
        }),
      );
    else if (source.role === "user" && item.role === "user") {
      const textParts = item.content.filter((p) => p.type === "text");
      let i = 0;
      messages.push({
        ...source,
        content:
          typeof source.content === "string"
            ? textParts.map((p) => p.text).join("")
            : source.content.map((p) =>
                p.type === "text" ? { ...p, text: textParts[i++]?.text ?? p.text } : p,
              ),
      });
    }
  }
  return { ...context, systemPrompt, messages };
}
export async function prepareCompatibleContext(
  context: Context,
  model: Model<string>,
): Promise<Context> {
  const prompt = nativePrompt(context);
  const runner = new ProcessorRunner({
    inputProcessors: [new ProviderHistoryCompat()],
    outputProcessors: [],
    logger: undefined,
    agentName: "Branch",
  });
  const output = await runner.runProcessLLMRequest({
    prompt,
    model: { provider: providerId(model.provider, model.api), modelId: model.id },
    messageList: nativeMessageList(prompt),
  });
  return output.prompt === prompt ? context : restoreNativeContext(context, output.prompt);
}
export async function repairRejectedContext(
  context: Context,
  error: string,
  retryCount: number,
): Promise<Context | undefined> {
  const prompt = nativePrompt(context);
  const messageList = nativeMessageList(prompt);
  const repaired = await new ProviderHistoryCompat().processAPIError({
    error: new APICallError({
      message: error,
      url: "",
      statusCode: 400,
      requestBodyValues: {},
      isRetryable: false,
    }),
    messageList,
    retryCount,
  });
  if (!repaired?.retry) return undefined;
  const repairedParts = new Map<LinkedPart, LinkedDbPart>();
  for (const message of messageList.get.all.db())
    for (const part of message.content.parts) {
      const linked = part as LinkedDbPart;
      if (linked[SOURCE_PART]) repairedParts.set(linked[SOURCE_PART], linked);
    }
  const idMap = new Map<string, string>();
  for (const item of prompt) {
    if (item.role !== "assistant") continue;
    item.content = item.content.filter(
      (part) => part.type !== "reasoning" || repairedParts.has(part),
    );
    for (const part of item.content) applyReactivePartRepair(part, repairedParts.get(part), idMap);
  }
  for (const item of prompt)
    if (item.role === "tool")
      for (const part of item.content)
        part.toolCallId = idMap.get(part.toolCallId) ?? part.toolCallId;
  return restoreNativeContext(context, prompt);
}

function applyReactivePartRepair(
  part: PromptPart,
  db: LinkedDbPart | undefined,
  idMap: Map<string, string>,
): void {
  const linked = part as LinkedPart;
  const source = linked[SOURCE_PART];
  if (db?.type === "tool-invocation" && part.type === "tool-call") {
    let id = db.toolInvocation.toolCallId;
    if (
      part.providerOptions &&
      !Object.values(db.providerMetadata ?? {}).some((m) => typeof m.itemId === "string")
    )
      id = id.split("|")[0]!;
    idMap.set(part.toolCallId, id);
    part.toolCallId = id;
  } else if (
    db?.type === "text" &&
    source?.type === "text" &&
    part.providerOptions &&
    !Object.values(db.providerMetadata ?? {}).some((m) => typeof m.itemId === "string")
  ) {
    removeResponseTextSignature(linked, source);
  }
}
function removeResponseTextSignature(
  part: LinkedPart,
  source: Extract<NativePart, { type: "text" }>,
): void {
  const { textSignature: signature, ...plain } = source;
  let phase: unknown;
  if (signature?.startsWith("{")) {
    try {
      phase = (JSON.parse(signature) as { phase?: unknown }).phase;
    } catch {
      /* No valid phase to retain. */
    }
  }
  part[SOURCE_PART] =
    phase === "commentary" || phase === "final_answer"
      ? { ...plain, textSignature: JSON.stringify({ v: 1, phase }) }
      : plain;
}
