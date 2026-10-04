// Ported from google-gemini/gemini-cli packages/core/src/context/processors/rollingSummaryProcessor.test.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
import { describe, it, expect, vi } from "vitest";
import type { SideQuery } from "./agent-loop-side-query.js";
import { createRollingSummaryProcessor, isRollingSummaryMessage } from "./rolling-summary.js";
import type { AgentMessage } from "./runtime/index.js";
import {
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "./test-helpers/agent-message-fixtures.js";

/** Mirrors createMockEnvironment: charsPerToken = 1. */
function createMockEnvironment() {
  return {
    sideQuery: vi.fn<SideQuery>().mockResolvedValue("Mock rolling summary"),
    getTokenCost: (message: AgentMessage) => {
      const content = (message as { content?: unknown }).content;
      return Array.isArray(content)
        ? content.reduce(
            (sum: number, block: { text?: unknown }) =>
              sum + (typeof block.text === "string" ? block.text.length : 0),
            0,
          )
        : 0;
    },
  };
}

const user = (text: string) => makeAgentUserMessage({ content: [{ type: "text", text }] });
const model = (text: string) => makeAgentAssistantMessage({ content: [{ type: "text", text }] });

describe("RollingSummaryProcessor", () => {
  it("should initialize with correct default options", () => {
    const env = createMockEnvironment();
    const processor = createRollingSummaryProcessor("RollingSummaryProcessor", env, {
      target: "incremental",
    });
    expect(processor.id).toBe("RollingSummaryProcessor");
  });

  it("should summarize older nodes when the deficit exceeds the threshold", async () => {
    // getTokenCost uses charsPerToken=1 like createMockEnvironment
    const env = createMockEnvironment();

    // We want to free exactly 100 tokens. We supply nodes that cost 50 tokens each.
    const processor = createRollingSummaryProcessor("RollingSummaryProcessor", env, {
      target: "freeNTokens",
      freeTokensTarget: 100,
    });

    const text50 = "A".repeat(50);
    const targets = [user(text50), model(text50), model(text50)];

    const result = await processor.process({ targets });

    // The first node (the initial user prompt) is always skipped. Nodes 2 and 3
    // add 100 deficit, which hits the target break point, so they fold into a
    // new rolling summary node.
    expect(result.length).toBe(2);
    expect(result[0]).toBe(targets[0]);
    expect(isRollingSummaryMessage(result[1] as AgentMessage)).toBe(true);
    expect(env.sideQuery).toHaveBeenCalledTimes(1);
  });

  it("should preserve targets if deficit does not trigger summary", async () => {
    const env = createMockEnvironment();

    // We want to free 100 tokens, but our nodes will only cost 10 tokens each.
    const processor = createRollingSummaryProcessor("RollingSummaryProcessor", env, {
      target: "freeNTokens",
      freeTokensTarget: 100,
    });

    const text10 = "A".repeat(10);
    const targets = [user(text10), model(text10)];

    const result = await processor.process({ targets });

    // Deficit accumulator reaches 10, and total summarizable nodes < 2 anyway.
    expect(result.length).toBe(2);
    expect(result[0]).toBe(targets[0]);
    expect(result[1]).toBe(targets[1]);
    expect(env.sideQuery).not.toHaveBeenCalled();
  });

  it("keeps the targets when the side call fails", async () => {
    const env = { ...createMockEnvironment(), onError: vi.fn() };
    env.sideQuery.mockRejectedValue(new Error("offline"));
    const processor = createRollingSummaryProcessor("RollingSummaryProcessor", env, {});
    const targets = [user("a"), model("b"), model("c")];

    const result = await processor.process({ targets });

    expect(result).toEqual(targets);
    expect(env.onError).toHaveBeenCalledWith(
      "RollingSummaryProcessor failed sync backstop",
      expect.any(Error),
    );
  });
});
