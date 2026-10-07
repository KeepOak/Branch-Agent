// Written by Branch for OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/view.py (atlas AGENT-LOOP-0093). Production compaction wiring for the ported safe-cut invariants.
import { expect, it } from "vitest";
import { findCutPoint } from "../harness/compaction/compaction.js";
import type { SessionTreeEntry } from "../harness/types.js";
import { makeAssistantMessage, makeCall, user } from "../agent-loop.test-support.js";
import type { AgentMessage } from "../types.js";
import { messageManipulationIndices, safeHistoryStart } from "./message-manipulation-indices.js";
const observation = (id: string): AgentMessage => ({ role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 1 });
const entry = (message: AgentMessage, i: number): SessionTreeEntry => ({ type: "message", id: `e${i}`, parentId: i ? `e${i - 1}` : null, timestamp: new Date(i).toISOString(), message });
it("protects the whole signed thinking loop across parallel calls and later batches", () => {
  const messages = [user(), makeAssistantMessage([{ type: "thinking", thinking: "plan", thinkingSignature: "sig" }, makeCall("read", "a"), makeCall("read", "b")]), observation("a"), observation("b"), makeAssistantMessage([makeCall("read", "c")]), observation("c"), user("next")];
  expect(messageManipulationIndices(messages)).toEqual(new Set([0, 1, 6, 7]));
  expect(safeHistoryStart(messages, 4)).toBe(1);
  const entries = messages.map(entry);
  const cut = findCutPoint(entries, 0, 6, 1);
  expect(cut.firstKeptEntryIndex).toBe(1);
});
it("metadata does not create a cut point inside a signed tool loop", () => {
  const messages = [makeAssistantMessage([{ type: "thinking", thinking: "plan" }, makeCall("read", "a")]), undefined, observation("a")];
  expect(messageManipulationIndices(messages)).toEqual(new Set([0, 3]));
});
it("keeps unsigned batches atomic without restricting completed separate batches", () => {
  const messages = [makeAssistantMessage([makeCall("read", "a")]), observation("a"), makeAssistantMessage([makeCall("read", "b")]), observation("b")];
  expect(messageManipulationIndices(messages)).toEqual(new Set([0, 2, 4]));
});
