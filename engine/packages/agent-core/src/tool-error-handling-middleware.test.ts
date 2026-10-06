// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_error_handling_middleware.py (atlas AGENT-LOOP-0090). Converted tool exception contracts to Branch agent events; runtime-chain tests remain unported.
import { expect, it } from "vitest";
import { captureAgentLoop, config, createTurnSequenceStream, makeCall, makeTool, user } from "./agent-loop.test-support.js";
import { toolExceptionResult } from "./tool-error-feedback.js";

import { execute } from "./tool-error-handling.test-support.js";
it("test_wrap_tool_call_passthrough_on_success", async () => {
  expect(await execute("web_search")).toMatchObject({ isError: false, content: [{ type: "text", text: "ok" }], details: {} });
});
it("test_wrap_tool_call_returns_error_tool_message_on_exception", async () => {
  const result = await execute("web_search", new Error("network down"));
  expect(result).toMatchObject({ toolCallId: "tc-42", toolName: "web_search", isError: true });
  expect(JSON.stringify(result.content)).toContain("Tool 'web_search' failed"); expect(JSON.stringify(result.content)).toContain("network down");
});
it("test_wrap_tool_call_stamps_tool_meta_on_exception", async () => {
  const error = new Error("connection refused"); error.name = "ConnectionError";
  expect(await execute("web_search", error)).toMatchObject({ details: { tool_meta: { status: "error", source: "exception", error_type: "transient" } } });
});
it("test_task_exception_wrapper_uses_subagent_result_formatter", async () => {
  const error = new Error("network down"); error.name = "RuntimeError";
  expect(await execute("task", error, false, "tc-task")).toMatchObject({ toolCallId: "tc-task", toolName: "task", isError: true, content: [{ type: "text", text: "Task failed. Error: RuntimeError: network down. Continue with available context, or choose an alternative tool." }], details: { subagent_status: "failed", subagent_error: "RuntimeError: network down" } });
});
it("test_awrap_tool_call_returns_error_tool_message_on_exception", async () => {
  const result = await execute("mcp_tool", new Error("request timed out"), true, "tc-async");
  expect(result).toMatchObject({ toolCallId: "tc-async", toolName: "mcp_tool", isError: true }); expect(JSON.stringify(result.content)).toContain("request timed out");
});
it("bounds exception details to the upstream 500 characters", () => {
  const result = toolExceptionResult("web_search", new Error("x".repeat(600)));
  expect(result.content).toEqual([{ type: "text", text: `Error: Tool 'web_search' failed with Error: ${"x".repeat(497)}.... Continue with available context, or choose an alternative tool.` }]);
});
