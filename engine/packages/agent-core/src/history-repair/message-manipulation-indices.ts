// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/view.py (atlas AGENT-LOOP-0093). Branch message adapter for production compaction and trimming.
import type { AgentMessage } from "../types.js";
import { View } from "./view.js";
import type { ViewEvent } from "./view-types.js";
/** Return message boundaries that keep batches and signed thinking tool loops intact. */
export function messageManipulationIndices(messages: Array<AgentMessage | undefined>): Set<number> {
  const events: ViewEvent[] = []; const offsets: number[] = [];
  for (const [index, message] of messages.entries()) {
    offsets.push(events.length);
    if (!message) continue;
    const id = `message_${index}`;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      const calls = message.content.filter(c => c.type === "toolCall");
      if (calls.length) {
        const thinking = message.content.some(c => c.type === "thinking");
        for (const [position, call] of calls.entries()) events.push({ id: `${id}_${position}`, kind: "action", convertible: true, toolCallId: call.id, llmResponseId: id, thinking: thinking && position === 0 });
        continue;
      }
    }
    if (message?.role === "toolResult") events.push({ id, kind: "observation", convertible: true, toolCallId: message.toolCallId });
    else events.push({ id, kind: "message", convertible: true });
  }
  offsets.push(events.length);
  const safe = new View(events).manipulationIndices;
  return new Set(offsets.flatMap((offset, index) => safe.has(offset) ? [index] : []));
}
/** Retain more history when the desired trimming boundary would split an atomic group. */
export function safeHistoryStart(messages: Array<AgentMessage | undefined>, desired: number): number {
  return Math.max(0, ...[...messageManipulationIndices(messages)].filter(i => i <= desired));
}
