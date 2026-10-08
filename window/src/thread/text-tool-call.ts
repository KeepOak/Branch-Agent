// A small local model sometimes writes a tool call as its whole reply:
// `{"name": "sessions_spawn", "arguments": {…}}`, optionally inside a json fence.
// The thread treats that as a step (preview AGENT-LOOP-0088 / stepRowPB18), never as the reply text.
import { describeToolCall, readFileChanges, recordedAt, toolInput, type Block } from "./model";

export type TextToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

type Step = Extract<Block, { kind: "step" }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The inner JSON when the whole trimmed text is one markdown fence (`json` or no language). */
function unwrapJsonFence(text: string): string {
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  return fenced ? fenced[1].trim() : text;
}

/** A reply whose whole trimmed text is one tool-call JSON object, or null. Never throws. */
export function readTextToolCall(text: string): TextToolCall | null {
  try {
    if (typeof text !== "string") {
      return null;
    }
    const body = unwrapJsonFence(text.trim());
    if (!body.startsWith("{") || !body.endsWith("}")) {
      return null;
    }
    const parsed = asRecord(JSON.parse(body) as unknown);
    if (!parsed) {
      return null;
    }
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const args = asRecord(parsed.arguments);
    if (!name || !args) {
      return null;
    }
    return { name, arguments: args };
  } catch {
    return null;
  }
}

/** The step the thread shows for a text-channel tool call: plain words, title as the detail. */
export function stepFromTextToolCall(
  call: TextToolCall,
  key: string,
  extra: { outputKey?: string; at?: number } = {},
): Step {
  return {
    kind: "step",
    key,
    ...(extra.outputKey ? { outputKey: extra.outputKey } : {}),
    tool: call.name,
    title: describeToolCall(call.name, call.arguments),
    detail: "",
    status: "ok",
    input: toolInput(call.arguments),
    changes: readFileChanges(call.arguments),
    ...recordedAt(extra.at),
  };
}
