// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/tool_call_args.py (atlas AGENT-LOOP-0097). Converted to TypeScript; also handles Branch canonical toolCall blocks and replay checkpoints.
import { isRecord } from "@branch/normalization-core/record-coerce";

type Args = Record<string, unknown>;
type Replacements = ReadonlyMap<string, Args>;
type Selector = (message: Record<string, unknown>, call: Args) => Args | undefined;

function replacement(id: unknown, replacements: Replacements): Args | undefined {
  return typeof id === "string" ? replacements.get(id) : undefined;
}

function rewriteRawCall(entry: unknown, replacements: Replacements): unknown {
  if (!isRecord(entry)) return entry;
  const args = replacement(entry.id, replacements);
  if (!args) return entry;
  if (isRecord(entry.function)) {
    return { ...entry, function: { ...entry.function, arguments: JSON.stringify(args) } };
  }
  if (typeof entry.arguments === "string") return { ...entry, arguments: JSON.stringify(args) };
  if (isRecord(entry.args)) return { ...entry, args };
  return entry;
}

function rewriteContentBlock(block: unknown, replacements: Replacements): unknown {
  if (!isRecord(block)) return block;
  const args = replacement(block.type === "function_call" ? block.call_id : block.id, replacements);
  if (!args) return block;
  if (block.type === "tool_use") {
    const { partial_json: _partial, ...rest } = block;
    return { ...rest, input: args };
  }
  if (block.type === "function_call") return { ...block, arguments: JSON.stringify(args) };
  if (block.type === "tool_call" || block.type === "tool_call_chunk") {
    const next = { ...block, args: block.type === "tool_call" ? args : JSON.stringify(args) };
    return isRecord(block.extras) && "arguments" in block.extras
      ? { ...next, extras: { ...block.extras, arguments: JSON.stringify(args) } }
      : next;
  }
  if (block.type === "toolCall") {
    const { partialJson: _partial, ...rest } = block;
    return { ...rest, arguments: args };
  }
  return block;
}

/** Rewrite every provider argument surface without mutating durable transcript state. */
export function rewriteToolCallArgs<T>(message: T, replacements: Replacements): T {
  if (!isRecord(message) || replacements.size === 0) return message;
  const update: Record<string, unknown> = {};
  const mapSurface = (key: string, rewrite: (entry: unknown) => unknown) => {
    const source = message[key];
    if (!Array.isArray(source)) return;
    const next = source.map(rewrite);
    if (next.some((entry, index) => entry !== source[index])) update[key] = next;
  };
  mapSurface("tool_calls", (call) => {
    const args = isRecord(call) ? replacement(call.id, replacements) : undefined;
    return args ? { ...(call as Args), args } : call;
  });
  mapSurface("tool_call_chunks", (chunk) => {
    const args = isRecord(chunk) ? replacement(chunk.id, replacements) : undefined;
    return args ? { ...(chunk as Args), args: JSON.stringify(args) } : chunk;
  });
  const kwargs = message.additional_kwargs;
  if (isRecord(kwargs) && Array.isArray(kwargs.tool_calls)) {
    const raw = kwargs.tool_calls.map((call) => rewriteRawCall(call, replacements));
    if (raw.some((call, index) => call !== (kwargs.tool_calls as unknown[])[index])) {
      update.additional_kwargs = { ...kwargs, tool_calls: raw };
    }
  }
  mapSurface("content", (block) => rewriteContentBlock(block, replacements));
  return Object.keys(update).length ? { ...message, ...update } : message;
}

function isAssistant(message: unknown): message is Args {
  return isRecord(message) && (message.role === "assistant" || message.type === "ai");
}

function callsOf(message: Args): unknown[] {
  if (Array.isArray(message.tool_calls)) return message.tool_calls;
  return Array.isArray(message.content)
    ? message.content.filter((block) => isRecord(block) && block.type === "toolCall")
    : [];
}

function withoutResponseChain<T>(message: T): T {
  if (!isAssistant(message)) return message;
  const metadata = message.response_metadata;
  const responseId = isRecord(metadata) ? metadata.id : undefined;
  const update: Args = {};
  if (typeof responseId === "string" && responseId.startsWith("resp_")) {
    const { id: _id, ...rest } = metadata as Args;
    update.response_metadata = rest;
  }
  // Branch checkpoints also refer to the original provider-owned history.
  if (message.providerReplay !== undefined) update.providerReplay = undefined;
  if (message.branchResponsesInputReplay !== undefined)
    update.branchResponsesInputReplay = undefined;
  return Object.keys(update).length ? { ...message, ...update } : message;
}

/** Duplicate ids within a turn are ambiguous; ids reused across turns are independent. */
export function rewriteMessagesToolCallArgs<T>(messages: T[], selector: Selector): T[] | undefined {
  let changed = false;
  const updated = messages.map((message) => {
    if (!isAssistant(message)) return message;
    const calls = callsOf(message);
    const counts = new Map<string, number>();
    for (const call of calls) {
      if (isRecord(call) && typeof call.id === "string" && call.id) {
        counts.set(call.id, (counts.get(call.id) ?? 0) + 1);
      }
    }
    const replacements = new Map<string, Args>();
    for (const call of calls) {
      if (!isRecord(call) || typeof call.id !== "string" || !call.id || counts.get(call.id) !== 1)
        continue;
      const args = selector(message, call);
      if (args !== undefined) replacements.set(call.id, args);
    }
    const next = rewriteToolCallArgs(message, replacements);
    changed ||= next !== message;
    return next;
  });
  return changed ? updated.map(withoutResponseChain) : undefined;
}

export type ToolCallOccurrence = {
  index: number;
  message: Args;
  toolCall: Args;
  result: Args | undefined;
  callId: string;
  name: string;
  args: Args;
};

/** A result answers only an open call in the most recent assistant turn. */
export function pairToolCallResults(messages: readonly unknown[]): ToolCallOccurrence[] {
  const occurrences: ToolCallOccurrence[] = [];
  let open = new Map<string, number[]>();
  for (const [index, message] of messages.entries()) {
    if (isAssistant(message)) {
      open = new Map();
      for (const call of callsOf(message)) {
        if (!isRecord(call) || typeof call.id !== "string" || !call.id) continue;
        const positions = open.get(call.id) ?? [];
        positions.push(occurrences.length);
        open.set(call.id, positions);
        occurrences.push({
          index,
          message,
          toolCall: call,
          result: undefined,
          callId: call.id,
          name: typeof call.name === "string" ? call.name : "",
          args: isRecord(call.args) ? call.args : isRecord(call.arguments) ? call.arguments : {},
        });
      }
    } else if (isRecord(message) && (message.role === "toolResult" || message.type === "tool")) {
      const id = message.tool_call_id ?? message.toolCallId;
      const position = typeof id === "string" ? open.get(id)?.shift() : undefined;
      if (position !== undefined) occurrences[position].result = message;
    }
  }
  return occurrences;
}

/** Repair mirrors only when they disagree with Branch's canonical argument object. */
export function synchronizeHistoricalToolCallArgs<T>(messages: T[]): T[] {
  return (
    rewriteMessagesToolCallArgs(messages, (message, call) => {
      const canonical = Array.isArray(message.content)
        ? message.content.find(
            (block) => isRecord(block) && block.type === "toolCall" && block.id === call.id,
          )
        : undefined;
      if (!isRecord(canonical) || !isRecord(canonical.arguments)) return undefined;
      const replacements = new Map([[String(call.id), canonical.arguments]]);
      const patched = rewriteToolCallArgs(message, replacements);
      return JSON.stringify(patched) !== JSON.stringify(message) ? canonical.arguments : undefined;
    }) ?? messages
  );
}
