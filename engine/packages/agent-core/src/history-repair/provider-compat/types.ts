// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/processors/provider-history-compat.ts (atlas AGENT-LOOP-0095). Adapted to Branch typed history bridge; assertions preserved.
export type ProviderMetadata = Record<string, Record<string, unknown>>;
interface Metadata {
  providerOptions?: ProviderMetadata;
  providerMetadata?: ProviderMetadata;
}
export interface ToolInvocation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  state: "call" | "result" | "partial-call";
  result?: unknown;
}
export type MastraToolInvocationPart = Metadata & {
  type: "tool-invocation";
  toolInvocation: ToolInvocation;
};
export type MastraMessagePart =
  | MastraToolInvocationPart
  | (Metadata & { type: "text"; text: string })
  | (Metadata & {
      type: "reasoning";
      reasoning?: string;
      text?: string;
      details?: Array<{ type: "text"; text: string; signature?: string }>;
    })
  | { type: "step-start" };
export interface MastraDBMessage {
  id: string;
  role: "assistant" | "user" | "system" | "tool";
  createdAt: Date;
  content: {
    format: 2;
    parts: MastraMessagePart[];
    metadata?: Record<string, unknown>;
    toolInvocations?: ToolInvocation[];
  };
}
export type PromptPart = Metadata &
  (
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string }
    | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerExecuted?: boolean;
      }
    | {
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: { type: "text" | "json"; value: unknown };
      }
    | { type: "file"; data: string; mediaType: string }
  );
export type LanguageModelV2Prompt = Array<
  | { role: "system"; content: string }
  | { role: "user"; content: PromptPart[] }
  | { role: "assistant"; content: PromptPart[] }
  | { role: "tool"; content: Array<Extract<PromptPart, { type: "tool-result" }>> }
>;
export interface MessageList {
  get: { all: { db(): MastraDBMessage[] } };
}
export interface ProcessLLMRequestArgs {
  prompt: LanguageModelV2Prompt;
  model: unknown;
  messageList?: MessageList;
  stepNumber?: number;
  steps?: unknown[];
  state?: Record<string, unknown>;
  retryCount?: number;
  abort?: () => never;
}
export type ProcessLLMRequestResult = { prompt: LanguageModelV2Prompt } | undefined;
export interface ProcessAPIErrorArgs {
  error: unknown;
  messageList: MessageList;
  messages?: MastraDBMessage[];
  retryCount: number;
  stepNumber?: number;
  steps?: unknown[];
  state?: Record<string, unknown>;
  abort?: () => never;
}
export type ProcessAPIErrorResult = { retry: true } | undefined;
/** Carries the raw provider error body through Branch's compatibility boundary. */
export class APICallError extends Error {
  readonly responseBody?: string;
  readonly statusCode: number;
  constructor(args: {
    message: string;
    responseBody?: string;
    statusCode: number;
    url: string;
    requestBodyValues: unknown;
    isRetryable: boolean;
  }) {
    super(args.message);
    this.name = "APICallError";
    this.responseBody = args.responseBody;
    this.statusCode = args.statusCode;
  }
  static isInstance(error: unknown): error is APICallError {
    return error instanceof APICallError;
  }
}
export const RESPONSE_ITEM_ID_PROVIDERS = ["openai", "azure"] as const;
export const RESPONSE_RESULT_ITEM_ID_KEY = "resultItemId";
export function getResponseProviderItemIdFromPart(part: MastraMessagePart): string | undefined {
  if (part.type === "step-start") return undefined;
  for (const container of [part.providerMetadata, part.providerOptions]) {
    for (const provider of RESPONSE_ITEM_ID_PROVIDERS) {
      const id = container?.[provider]?.itemId;
      if (typeof id === "string") return id;
    }
  }
  return undefined;
}
