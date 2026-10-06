// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_error_handling_middleware.py (atlas AGENT-LOOP-0090). Branch event-loop fixture.
import { expect } from "vitest";
import { captureAgentLoop, config, createTurnSequenceStream, makeCall, makeTool, user } from "./agent-loop.test-support.js";
export async function execute(name: string, failure?: Error, asynchronous = false, id = "tc-42") {
  const expected = { content: [{ type: "text" as const, text: "ok" }], details: {} };
  const tool = { ...makeTool(name), execute: () => {
    if (!failure) return Promise.resolve(expected);
    if (asynchronous) return Promise.reject(failure);
    throw failure;
  } };
  const run = captureAgentLoop([user()], { systemPrompt: "", messages: [], tools: [tool] }, config, undefined, createTurnSequenceStream([[makeCall(name, id)], [{ type: "text", text: "done" }]]));
  const messages = await run.result; const result = messages.find(m => m.role === "toolResult");
  expect(result?.role).toBe("toolResult");
  if (!result || result.role !== "toolResult") throw new Error("missing result");
  return result;
}
