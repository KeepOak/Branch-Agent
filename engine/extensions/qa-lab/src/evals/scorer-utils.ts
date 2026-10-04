// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 packages/evals/src/scorers/utils.ts
// and packages/core/src/evals/types.ts (scorer message model and helpers, without Mastra's message list).
import { randomUUID } from "node:crypto";

export type ToolInvocationState =
  | "call"
  | "partial-call"
  | "result"
  | "output-error"
  | "error"
  | "output-denied";

export type EvalToolInvocation = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  state: ToolInvocationState;
  errorText?: string;
  isError?: boolean;
  /** Structured tool result details Branch records beside the text (e.g. exec exitCode). */
  details?: unknown;
};

export type EvalMessagePart =
  | { type: "text"; text: string }
  | { type: "tool-invocation"; toolInvocation: EvalToolInvocation }
  | { type: "reasoning"; text: string };

export type EvalMessageRole = "user" | "assistant" | "system";

/** Scorer message shape (Mastra's format-2 message, reduced to what scorers read). */
export type EvalMessage = {
  id: string;
  role: EvalMessageRole;
  createdAt: Date;
  content: {
    format: 2;
    parts: EvalMessagePart[];
    content?: string;
    reasoning?: string;
    toolInvocations?: EvalToolInvocation[];
  };
};

export type ScorerRunInputForAgent = {
  inputMessages: EvalMessage[];
  rememberedMessages: EvalMessage[];
  systemMessages: Array<{ role: "system"; content: string }>;
  taggedSystemMessages: Record<string, Array<{ role: "system"; content: string }>>;
};

export type ScorerRunOutputForAgent = EvalMessage[];

export type AgentScorerRun = {
  runId?: string;
  input: ScorerRunInputForAgent;
  output: ScorerRunOutputForAgent;
  groundTruth?: unknown;
  requestContext?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Returns the last text part of a message (AI SDK behaviour), or the plain content string. */
export function getTextContentFromMessage(message: EvalMessage | undefined): string {
  const content: unknown = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const textParts = content.filter((part) => isRecord(part) && part.type === "text");
    const last = textParts.at(-1) as { text?: unknown } | undefined;
    return typeof last?.text === "string" ? last.text : "";
  }
  if (!isRecord(content)) {
    return "";
  }
  if (typeof content.content === "string" && content.content !== "") {
    return content.content;
  }
  if (typeof content.text === "string" && content.text !== "") {
    return content.text;
  }
  if (Array.isArray(content.parts)) {
    const textParts = content.parts.filter((part) => isRecord(part) && part.type === "text");
    const last = textParts.at(-1) as { text?: unknown } | undefined;
    return typeof last?.text === "string" ? last.text : "";
  }
  return "";
}

const getTextFromValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value === "" ? undefined : value;
  }
  if (Array.isArray(value)) {
    const textParts = value
      .filter((part) => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map((part) => (part as { text: string }).text);
    return textParts.length > 0 ? textParts[textParts.length - 1] : undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const fromParts = Array.isArray(value.parts) ? getTextFromValue(value.parts) : undefined;
  return (
    getTextFromValue(value.content) ??
    (typeof value.text === "string" && value.text !== "" ? value.text : undefined) ??
    (typeof value.body === "string" && value.body !== "" ? value.body : undefined) ??
    fromParts
  );
};

const getTextFromMessages = (messages: unknown, role: string): string | undefined => {
  if (!Array.isArray(messages)) {
    return undefined;
  }
  const message = messages.find((entry) => isRecord(entry) && entry.role === role);
  return message ? getTextFromValue(message) : undefined;
};

export const roundToTwoDecimals = (num: number): number =>
  Math.round((num + Number.EPSILON) * 100) / 100;

export function isCloserTo(value: number, target1: number, target2: number): boolean {
  return Math.abs(value - target1) < Math.abs(value - target2);
}

/** Text of the first user message of a run input (agent run, string, or prompt object). */
export const getUserMessageFromRunInput = (input?: unknown): string | undefined => {
  if (typeof input === "string") {
    return input;
  }
  if (!isRecord(input)) {
    return undefined;
  }
  return (
    getTextFromMessages(input.inputMessages, "user") ??
    getTextFromMessages(input.messages, "user") ??
    (typeof input.prompt === "string" ? input.prompt : undefined) ??
    (typeof input.text === "string" ? input.text : undefined) ??
    getTextFromValue(input.content) ??
    getTextFromValue(input.input) ??
    getTextFromValue(input.user)
  );
};

/** Text of the last assistant message that carries text. */
export const getAssistantMessageFromRunOutput = (output?: unknown): string | undefined => {
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    const assistantMessages = output.filter(
      (message) => isRecord(message) && message.role === "assistant",
    );
    for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
      const text = getTextFromValue(assistantMessages[index]);
      if (text) {
        return text;
      }
    }
    return undefined;
  }
  if (!isRecord(output)) {
    return undefined;
  }
  const isAssistantOutput = output.role === undefined || output.role === "assistant";
  if (isAssistantOutput && typeof output.text === "string") {
    return output.text;
  }
  if (isAssistantOutput && typeof output.content === "string") {
    return output.content;
  }
  if (isAssistantOutput && (isRecord(output.content) || Array.isArray(output.content))) {
    return (
      getTextContentFromMessage(output as unknown as EvalMessage) ||
      getTextContentFromMessage(output.content as unknown as EvalMessage) ||
      undefined
    );
  }
  return undefined;
};

export const createToolInvocation = (params: {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  state?: ToolInvocationState;
  errorText?: string;
  isError?: boolean;
}): EvalToolInvocation => ({
  toolCallId: params.toolCallId,
  toolName: params.toolName,
  args: params.args,
  result: params.result,
  state: params.state ?? "result",
  ...(params.errorText !== undefined ? { errorText: params.errorText } : {}),
  ...(params.isError !== undefined ? { isError: params.isError } : {}),
});

export function createTestMessage(params: {
  content: string;
  role: EvalMessageRole;
  id?: string;
  toolInvocations?: EvalToolInvocation[];
  parts?: EvalMessagePart[];
}): EvalMessage {
  const toolInvocations = params.toolInvocations ?? [];
  return {
    id: params.id ?? "test-message",
    role: params.role,
    content: {
      format: 2,
      parts: params.parts ?? [{ type: "text", text: params.content }],
      content: params.content,
      ...(toolInvocations.length > 0
        ? {
            toolInvocations: toolInvocations.map((invocation) => ({
              toolCallId: invocation.toolCallId,
              toolName: invocation.toolName,
              args: invocation.args,
              result: invocation.result,
              state: invocation.state,
            })),
          }
        : {}),
    },
    createdAt: new Date(),
  };
}

export const createAgentTestRun = (params: {
  inputMessages?: EvalMessage[];
  output: ScorerRunOutputForAgent;
  rememberedMessages?: EvalMessage[];
  systemMessages?: ScorerRunInputForAgent["systemMessages"];
  runId?: string;
}): AgentScorerRun & { runId: string } => ({
  input: {
    inputMessages: params.inputMessages ?? [],
    rememberedMessages: params.rememberedMessages ?? [],
    systemMessages: params.systemMessages ?? [],
    taggedSystemMessages: {},
  },
  output: params.output,
  runId: params.runId ?? randomUUID(),
});

export type ToolCallInfo = {
  toolName: string;
  toolCallId: string;
  messageIndex: number;
  invocationIndex: number;
};

/**
 * Merges parts tool invocations and the legacy toolInvocations array. Parts win on a shared
 * toolCallId (they hold the terminal state); legacy-only calls keep their relative order.
 */
export function mergeToolInvocations(message: EvalMessage | undefined): EvalToolInvocation[] {
  const legacyInvocations = message?.content?.toolInvocations ?? [];
  const fromParts = (message?.content?.parts ?? []).flatMap((part) =>
    part.type === "tool-invocation" && part.toolInvocation ? [part.toolInvocation] : [],
  );
  const partCallIds = new Set(fromParts.map((invocation) => invocation.toolCallId).filter(Boolean));
  const legacyPositions = new Map(
    legacyInvocations.map((invocation, index) => [invocation?.toolCallId, index]),
  );
  const toolInvocations: EvalToolInvocation[] = [];
  let legacyIndex = 0;
  for (const invocation of fromParts) {
    const sharedIndex = invocation.toolCallId
      ? legacyPositions.get(invocation.toolCallId)
      : undefined;
    if (sharedIndex !== undefined && sharedIndex >= legacyIndex) {
      for (; legacyIndex < sharedIndex; legacyIndex += 1) {
        const previous = legacyInvocations[legacyIndex];
        if (previous && !partCallIds.has(previous.toolCallId)) {
          toolInvocations.push(previous);
        }
      }
      legacyIndex += 1;
    }
    toolInvocations.push(invocation);
  }
  for (; legacyIndex < legacyInvocations.length; legacyIndex += 1) {
    const invocation = legacyInvocations[legacyIndex];
    if (invocation && !partCallIds.has(invocation.toolCallId)) {
      toolInvocations.push(invocation);
    }
  }
  return toolInvocations;
}

/** Tool calls of a run in order; thrown (output-error) calls count, partial calls do not. */
export function extractToolCalls(output: ScorerRunOutputForAgent): {
  tools: string[];
  toolCallInfos: ToolCallInfo[];
} {
  const tools: string[] = [];
  const toolCallInfos: ToolCallInfo[] = [];
  for (let messageIndex = 0; messageIndex < output.length; messageIndex += 1) {
    const invocations = mergeToolInvocations(output[messageIndex]);
    for (let invocationIndex = 0; invocationIndex < invocations.length; invocationIndex += 1) {
      const invocation = invocations[invocationIndex];
      if (
        invocation?.toolName &&
        (invocation.state === "result" ||
          invocation.state === "call" ||
          invocation.state === "output-error")
      ) {
        tools.push(invocation.toolName);
        toolCallInfos.push({
          toolName: invocation.toolName,
          toolCallId: invocation.toolCallId || `${messageIndex}-${invocationIndex}`,
          messageIndex,
          invocationIndex,
        });
      }
    }
  }
  return { tools, toolCallInfos };
}

export const extractInputMessages = (runInput: ScorerRunInputForAgent | undefined): string[] =>
  runInput?.inputMessages?.map((message) => getTextContentFromMessage(message)) ?? [];

export const extractAgentResponseMessages = (runOutput: ScorerRunOutputForAgent): string[] =>
  runOutput
    .filter((message) => message.role === "assistant")
    .map((message) => getTextContentFromMessage(message));

export type ToolResultInfo = {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result: unknown;
};

/** Successful tool results of a run (a thrown call carries errorText, not a result). */
export function extractToolResults(output: ScorerRunOutputForAgent): ToolResultInfo[] {
  const results: ToolResultInfo[] = [];
  for (const message of output) {
    for (const invocation of mergeToolInvocations(message)) {
      if (invocation.state === "result" && invocation.result !== undefined) {
        results.push({
          toolName: invocation.toolName,
          toolCallId: invocation.toolCallId || "",
          args: invocation.args || {},
          result: invocation.result,
        });
      }
    }
  }
  return results;
}
