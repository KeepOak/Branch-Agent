// Agent Core tests cover the result an agent gets for a tool that is not in its toolset.
import { describe, expect, it, vi } from "vitest";
import {
  captureAgentLoop,
  config,
  createTurnSequenceStream,
  makeCall,
  makeTool,
  user,
} from "./agent-loop.test-support.js";
import type { AgentLoopConfig, AgentMessage, AgentTool } from "./types.js";

async function runMissingCall(
  tools: AgentTool[],
  name: string,
  overrides: Partial<AgentLoopConfig> = {},
): Promise<{ text: string; isError: boolean | undefined }> {
  const run = captureAgentLoop(
    [user()],
    { systemPrompt: "", messages: [], tools },
    { ...config, ...overrides },
    undefined,
    createTurnSequenceStream([[makeCall(name)], [{ type: "text", text: "done" }]]),
  );
  const messages: AgentMessage[] = await run.result;
  const result = messages.find(
    (message) => message.role === "toolResult" && message.toolName === name,
  );
  if (!result || result.role !== "toolResult") {
    throw new Error("missing tool result for " + name);
  }
  const text = result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  return { text, isError: result.isError };
}

describe("missing tool result", () => {
  it("lists the tools that are available in the current turn", async () => {
    const { text, isError } = await runMissingCall([makeTool("exec"), makeTool("wait")], "write");

    expect(isError).toBe(true);
    expect(text).toBe("Tool write not found. Available tools: exec, wait.");
  });

  it("keeps the upstream message when the turn has no tools", async () => {
    const { text } = await runMissingCall([], "read");

    expect(text).toBe("Tool read not found");
  });

  it("lists every available tool without truncating", async () => {
    const tools = Array.from({ length: 45 }, (_, index) => makeTool(`tool_${index}`));

    const { text } = await runMissingCall(tools, "write");

    expect(text).toBe(
      `Tool write not found. Available tools: ${tools.map((tool) => tool.name).join(", ")}.`,
    );
  });

  it("appends runtime guidance for reaching the tool through the available ones", async () => {
    const describeMissingTool = vi.fn(({ toolCall }: { toolCall: { name: string } }) =>
      toolCall.name === "edit" ? "Call edit inside exec." : undefined,
    );

    const { text } = await runMissingCall([makeTool("exec")], "edit", { describeMissingTool });

    expect(describeMissingTool).toHaveBeenCalledTimes(1);
    expect(text).toBe("Tool edit not found. Available tools: exec. Call edit inside exec.");
  });

  it("keeps the tool list when the guidance hook throws", async () => {
    const { text } = await runMissingCall([makeTool("exec")], "write", {
      describeMissingTool: () => {
        throw new Error("hint failed");
      },
    });

    expect(text).toBe("Tool write not found. Available tools: exec.");
  });
});
