// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_error_handling_subagent_stamp.py (atlas AGENT-LOOP-0090). Converted to Vitest using Branch tool-result details.
import { expect, it } from "vitest";
import { execute } from "./tool-error-handling.test-support.js";
for (const asynchronous of [false, true]) {
  it(asynchronous ? "test_async_task_tool_exception_returns_failed_metadata" : "test_task_tool_exception_returns_failed_metadata", async () => {
    const error = new Error(asynchronous ? "async boom" : "blew up during execution"); error.name = "RuntimeError";
    const result = await execute("task", error, asynchronous);
    expect(result.details).toMatchObject({ subagent_status: "failed", subagent_error: expect.stringContaining("RuntimeError") });
  });
}
it("test_successful_plain_task_tool_message_is_not_stamped_from_content", async () => {
  const result = await execute("task"); expect(result.details).not.toHaveProperty("subagent_status");
});
it("test_does_not_stamp_non_task_tool_exception", async () => {
  const result = await execute("bash", new Error("command failed")); expect(result.details).not.toHaveProperty("subagent_status");
});
it("test_additional_kwargs_round_trip_via_json", async () => {
  const result = await execute("task", new Error("failure"));
  expect(JSON.parse(JSON.stringify(result)).details).toEqual(result.details);
});
