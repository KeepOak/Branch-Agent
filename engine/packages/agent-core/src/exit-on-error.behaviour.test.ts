// Written by Branch for aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:crates/goose/src/agents/state_machine/ops_exit_on_error.rs (atlas AGENT-LOOP-0091). The cited pipeline.rs is a fixture with no test cases.
import { expect, it, vi } from "vitest";
import { captureAgentLoop, config, makeAssistantMessage, makeCall, makeTool, reply, user } from "./agent-loop.test-support.js";
for (const stopReason of ["error", "aborted"] as const) {
  it(`exits on trailing ${stopReason} before continuation or tool execution`, async () => {
    const executed: string[] = [];
    const prepareNextTurn = vi.fn();
    const stream = vi.fn(() => reply({ ...makeAssistantMessage([makeCall("read")]), stopReason, errorMessage: "unrecoverable error" }));
    const run = captureAgentLoop([user()], { systemPrompt: "", messages: [], tools: [makeTool("read", executed)] }, { ...config, prepareNextTurn }, undefined, stream);
    const messages = await run.result;
    expect(stream).toHaveBeenCalledOnce(); expect(prepareNextTurn).not.toHaveBeenCalled(); expect(executed).toEqual([]);
    expect(messages.at(-1)).toMatchObject({ role: "assistant", stopReason, errorMessage: "unrecoverable error" });
    expect(run.events.at(-1)).toMatchObject({ type: "agent_end", messages });
  });
}
it("does not treat a recoverable tool-result error as a trailing provider error", async () => {
  const { execute } = await import("./tool-error-handling.test-support.js");
  expect(await execute("read", new Error("try again"))).toMatchObject({ role: "toolResult", isError: true });
});
