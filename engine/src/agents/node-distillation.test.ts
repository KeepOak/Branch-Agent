// Ported from google-gemini/gemini-cli packages/core/src/context/processors/nodeDistillationProcessor.test.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
import { describe, it, expect, vi } from "vitest";
import type { SideQuery } from "./agent-loop-side-query.js";
import { createNodeDistillationProcessor } from "./node-distillation.js";
import type { AgentMessage } from "./runtime/index.js";
import {
  castAgentMessage,
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "./test-helpers/agent-message-fixtures.js";

function createMockSideQuery(responses: string[]) {
  let index = 0;
  return vi.fn<SideQuery>(async () => responses[Math.min(index++, responses.length - 1)] ?? null);
}

function textOf(message: AgentMessage | undefined): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content)
    ? content.map((block: { type?: string; text?: string }) => block.text ?? "").join("")
    : String(content ?? "");
}

describe("NodeDistillationProcessor", () => {
  it("should trigger summarization via LLM for long text parts", async () => {
    const sideQuery = createMockSideQuery(["Mocked Summary!"]);

    const processor = createNodeDistillationProcessor(
      "NodeDistillationProcessor",
      { sideQuery },
      { nodeThresholdTokens: 10 },
    );

    const longText = "A".repeat(50); // 50 chars > 10 tokens * 3 chars

    const prompt = makeAgentUserMessage({ content: [{ type: "text", text: longText }] });
    const thought = makeAgentAssistantMessage({ content: [{ type: "text", text: longText }] });
    const tool = castAgentMessage({
      role: "toolResult",
      toolCallId: "tool-id",
      toolName: "dummy_tool",
      content: [{ type: "text", text: JSON.stringify({ result: "A".repeat(500) }) }],
      isError: false,
      timestamp: 0,
    });

    const targets = [prompt, thought, tool];

    const result = await processor.process({ targets });

    expect(result.length).toBe(3);

    // 1. User Prompt
    expect(result[0]).not.toBe(prompt);
    expect(textOf(result[0])).toBe("Mocked Summary!");

    // 2. Agent Thought
    expect(result[1]).not.toBe(thought);
    expect(textOf(result[1])).toBe("Mocked Summary!");

    // 3. Tool Execution
    expect(result[2]).not.toBe(tool);
    expect(textOf(result[2])).toBe("Mocked Summary!");
    expect((result[2] as { toolCallId?: string }).toolCallId).toBe("tool-id");

    expect(sideQuery).toHaveBeenCalledTimes(3);
  });

  it("should ignore nodes that are below the threshold", async () => {
    const sideQuery = createMockSideQuery(["S"]); // length = 1

    const processor = createNodeDistillationProcessor(
      "NodeDistillationProcessor",
      { sideQuery },
      { nodeThresholdTokens: 100 }, // Very high threshold
    );

    const prompt = makeAgentUserMessage({ content: [{ type: "text", text: "Short text" }] });
    const thought = makeAgentAssistantMessage({
      content: [{ type: "text", text: "Short thought" }],
    });

    const targets = [prompt, thought];

    const result = await processor.process({ targets });

    expect(result.length).toBe(2);

    // 1. User Prompt (NOT compressed)
    expect(result[0]).toBe(prompt);

    // 2. Agent Thought (NOT compressed)
    expect(result[1]).toBe(thought);

    // LLM should not have been called
    expect(sideQuery).toHaveBeenCalledTimes(0);
  });

  it("keeps the original text when the side call fails", async () => {
    const sideQuery = vi.fn<SideQuery>().mockRejectedValue(new Error("offline"));
    const processor = createNodeDistillationProcessor(
      "NodeDistillationProcessor",
      { sideQuery, onWarn: () => {} },
      { nodeThresholdTokens: 1 },
    );
    const prompt = makeAgentUserMessage({ content: [{ type: "text", text: "A".repeat(50) }] });

    const result = await processor.process({ targets: [prompt] });

    expect(result[0]).toBe(prompt);
  });
});
