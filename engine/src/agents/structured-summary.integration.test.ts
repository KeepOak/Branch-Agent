// Branch behaviour test for AGENT-LOOP-0100, derived from aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:crates/goose-context-management/src/structured.rs and summarize.rs. Exercises the production summary pipeline and R-1696.

import type { StreamFn } from "branch/plugin-sdk/agent-core";
import { createAssistantMessageEventStream, type Model } from "branch/plugin-sdk/llm";
import { expect, it } from "vitest";
import { summarizeInStages } from "./compaction.js";
import { makeAgentAssistantMessage } from "./test-helpers/agent-message-fixtures.js";
const model: Model = {
  id: "test",
  name: "test",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 1000,
};
it("renders structured provider output with provenance and uncertainty first", async () => {
  const requests: string[] = [];
  const streamFn: StreamFn = (_model, context) => {
    requests.push(JSON.stringify(context));
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: "stop",
      message: makeAgentAssistantMessage({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              provenance: ["owner turn 1"],
              uncertain: ["unverified deployment"],
              user_intent: ["ship fix"],
              pending_tasks: ["verify deployment"],
            }),
          },
        ],
      }),
    });
    stream.end();
    return stream;
  };
  const result = await summarizeInStages({
    messages: [{ role: "user", content: "ship fix", timestamp: 1 }],
    model,
    apiKey: "test-key",
    signal: new AbortController().signal,
    reserveTokens: 1000,
    maxChunkTokens: 10000,
    contextWindow: 200_000,
    streamFn,
  });
  expect(result.indexOf("## Provenance")).toBeLessThan(result.indexOf("## Uncertain"));
  expect(result.indexOf("## Uncertain")).toBeLessThan(result.indexOf("## User Intent"));
  expect(result).toContain("verify deployment");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("Put provenance and uncertainty before other summary content");
  expect(requests[0]).toContain("user_intent");
});
