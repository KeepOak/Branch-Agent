// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/agent/test_tool_validation_error_message.py (atlas AGENT-LOOP-0089). Converted to Vitest; confirmation uses Branch's shared beforeToolCall hook.
import { Type } from "typebox";
import { expect, it, vi } from "vitest";
import { captureAgentLoop, config, createTurnSequenceStream, makeCall, makeTool, user } from "./agent-loop.test-support.js";
import type { AgentLoopConfig } from "./types.js";

async function validation(args: Record<string, unknown>, overrides: Partial<AgentLoopConfig> = {}) {
  const tool = { ...makeTool("validation_test_tool"), parameters: Type.Object({ command: Type.String(), path: Type.String(), old_str: Type.Optional(Type.String()), security_risk: Type.Optional(Type.Union([Type.Literal("UNKNOWN"), Type.Literal("LOW")])) }), execute: vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} })) };
  const call = { ...makeCall(tool.name, "call_1"), arguments: args };
  const run = captureAgentLoop([user()], { systemPrompt: "", messages: [], tools: [tool] }, { ...config, ...overrides }, undefined, createTurnSequenceStream([[call], [{ type: "text", text: "done" }]]));
  const messages = await run.result;
  const errors = messages.filter(m => m.role === "toolResult" && m.isError);
  return { tool, errors, messages, run };
}
it("test_validation_error_shows_keys_not_values", async () => {
  const large = "x".repeat(1000);
  const { errors, tool } = await validation({ command: "view", path: "/test", old_str: large, security_risk: "INVALID" });
  expect(errors).toHaveLength(1); expect(tool.execute).not.toHaveBeenCalled();
  const text = JSON.stringify(errors[0]);
  for (const key of ["validation_test_tool", "Parameters provided:", "command", "path", "old_str"]) expect(text).toContain(key);
  expect(text).not.toContain(large);
});
it("test_unparseable_json_error_message", async () => {
  const { errors, messages, tool } = await validation("{invalid json syntax" as unknown as Record<string, unknown>);
  expect(errors).toHaveLength(1); expect(tool.execute).not.toHaveBeenCalled();
  const error = errors[0];
  const text = error?.role === "toolResult" && error.content[0]?.type === "text" ? error.content[0].text : "";
  expect(text).toContain("validation_test_tool"); expect(text).toContain("unparseable JSON");
  const actions = messages.filter(m => m.role === "assistant" && m.stopReason === "toolUse");
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ content: [{ arguments: { _branch_malformed_tool_call: true, error: text } }] });
});
it("test_tool_call_without_security_risk_succeeds", async () => {
  const { errors, tool } = await validation({ command: "view", path: "/test" });
  expect(errors).toEqual([]); expect(tool.execute).toHaveBeenCalledOnce();
});
it("test_omitted_security_risk_still_requires_confirmation", async () => {
  const beforeToolCall = vi.fn(({ args }: { args: unknown }) => {
    expect(args).toMatchObject({ command: "view", path: "/test" });
    return { block: true, reason: "UNKNOWN risk awaits confirmation" };
  });
  const { tool, errors } = await validation({ command: "view", path: "/test" }, { beforeToolCall });
  expect(beforeToolCall).toHaveBeenCalledOnce(); expect(tool.execute).not.toHaveBeenCalled();
  expect(errors).toHaveLength(1); expect(JSON.stringify(errors[0])).toContain("awaits confirmation");
});
