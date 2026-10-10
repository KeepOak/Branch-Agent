import { expect, it } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { onAgentEventForRun, type AgentEventPayload } from "../../infra/agent-events.js";
import { buildPreparedCliRunContext } from "../cli-runner.test-helpers.js";
import { executePreparedCliRun } from "./execute.js";
import { wrapPreparedCliRunWithTestAdmission } from "./execute.test-support.js";

it("routes Claude plugin steps to their session before the final result without duplicates", async () => {
  const context = buildPreparedCliRunContext({
    runId: "claude-live-steps",
    sessionKey: "agent:main:claude-live",
    agentId: "main",
    config: { plugins: { enabled: false } },
    backend: { command: process.execPath, sessionMode: "none" },
  });
  context.backendResolved.bundleMcp = false;
  const paused = createDeferred();
  const finish = createDeferred();
  const received: AgentEventPayload[] = [];
  const dispose = onAgentEventForRun(context.params.runId, (event) => received.push(event));
  context.executionTarget = {
    kind: "plugin",
    async *execute() {
      yield { type: "stream_event", event: { type: "content_block_start", index: 0,
        content_block: { type: "tool_use", id: "read-1", name: "Read", input: {} } } };
      yield { type: "stream_event", event: { type: "content_block_delta", index: 0,
        delta: { type: "input_json_delta", partial_json: '{"file_path":"example.txt"}' } } };
      yield { type: "stream_event", event: { type: "content_block_stop", index: 0 } };
      yield { type: "assistant", message: { content: [
        { type: "tool_use", id: "read-1", name: "Read", input: { file_path: "example.txt" } },
      ] } };
      yield { type: "user", message: { content: [
        { type: "tool_result", tool_use_id: "read-1", is_error: true, content: "Not found" },
      ] } };
      paused.resolve();
      await finish.promise;
      yield { type: "result", subtype: "success", result: "Finished checking." };
    },
  };
  let settled = false;
  const run = wrapPreparedCliRunWithTestAdmission(executePreparedCliRun)(context).finally(() => {
    settled = true;
  });
  try {
    await paused.promise;
    expect(settled).toBe(false);
    const tools = received.filter((event) => event.stream === "tool");
    expect(tools.map((event) => event.data.phase)).toEqual(["start", "result"]);
    expect(tools[1]?.data.isError).toBe(true);
    expect(received.filter((event) => event.stream === "item").map((event) => event.data.phase))
      .toEqual(["start", "end"]);
    expect(received.every((event) => event.sessionKey === context.params.sessionKey)).toBe(true);
    const beforeFinal = received.length;
    finish.resolve();
    await expect(run).resolves.toMatchObject({ text: "Finished checking." });
    expect(received.filter((event) => event.stream === "tool")).toHaveLength(2);
    expect(received.slice(beforeFinal).filter((event) => event.stream === "assistant"))
      .toHaveLength(1);
  } finally {
    finish.resolve();
    await Promise.allSettled([run]);
    dispose();
  }
});
