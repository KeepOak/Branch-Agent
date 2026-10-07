// Written by Branch for AGENT-LOOP-0104 from OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py. Behaviour tests cover source retry bounds and R-1541; the cited live-model c02 integration is not represented as passing by these fixtures.

import type { AgentMessage, StreamFn } from "branch/plugin-sdk/agent-core";
import { createAssistantMessageEventStream, type Model } from "branch/plugin-sdk/llm";
import { expect, it, vi } from "vitest";
import {
  hardContextReset,
  maybeTruncate,
  summarizeWithCompactionOverflowRetry,
} from "./compaction-overflow-retry.js";
import { summarizeInStages } from "./compaction.js";
import { makeAgentAssistantMessage } from "./test-helpers/agent-message-fixtures.js";
const signal = () => new AbortController().signal;
const messages: AgentMessage[] = [
  { role: "user", content: "FOLDED-START " + "x".repeat(1000) + " FOLDED-END", timestamp: 1 },
  { role: "user", content: "most recent owner turn", timestamp: 2 },
];
it("tries full input then drops the oldest folded item, preserving canonical history", async () => {
  const snapshot = structuredClone(messages),
    calls: AgentMessage[][] = [];
  const result = await summarizeWithCompactionOverflowRetry(
    messages,
    async (input) => {
      calls.push(input);
      if (calls.length === 1) throw Error("context length exceeded");
      return "checkpoint";
    },
    { signal: signal() },
  );
  expect(calls[0]).toBe(messages);
  expect(calls[1]).toEqual([messages[1]]);
  expect(calls[1][0]).toBe(messages[1]);
  expect(result).toContain("Uncertain: overflow recovery omitted 1 oldest");
  expect(result).toContain("checkpoint");
  expect(messages).toEqual(snapshot);
});
it("hardContextReset uses five bounded attempts and source 0.8 scaling", async () => {
  const calls: AgentMessage[][] = [];
  const result = await hardContextReset(
    messages,
    async (input) => {
      calls.push(input);
      throw Error("context length exceeded");
    },
    { signal: signal() },
  );
  expect(result).toBeUndefined();
  expect(calls).toHaveLength(5);
  expect(calls[0]).toBe(messages);
  const projected = calls[1][0].content;
  expect(typeof projected).toBe("string");
  expect(projected).toContain("FOLDED-START");
  expect(projected).toContain("FOLDED-END");
  for (let i = 2; i < calls.length; i++) {
    expect(String(calls[i][0].content).length).toBeLessThan(String(calls[i - 1][0].content).length);
    expect(String(calls[i][0].content)).toContain("FOLDED-END");
  }
});
it("propagates failure after bounded dropping and hard reset, rather than a fake summary", async () => {
  const complete = vi.fn().mockRejectedValue(Error("context length exceeded"));
  await expect(
    summarizeWithCompactionOverflowRetry(messages, complete, { signal: signal() }),
  ).rejects.toThrow("context length exceeded");
  expect(complete).toHaveBeenCalledTimes(2 + 5);
  expect(messages).toHaveLength(2);
});
it("preserves cancellation and does not retry access failures", async () => {
  const denied = vi.fn().mockRejectedValue(Error("403 permission denied"));
  await expect(
    summarizeWithCompactionOverflowRetry(messages, denied, { signal: signal() }),
  ).rejects.toThrow("permission denied");
  expect(denied).toHaveBeenCalledOnce();
  const controller = new AbortController();
  const cancelled = vi.fn().mockImplementation(async () => {
    controller.abort(Error("owner cancelled"));
    throw Error("context length exceeded");
  });
  await expect(
    summarizeWithCompactionOverflowRetry(messages, cancelled, { signal: controller.signal }),
  ).rejects.toThrow("owner cancelled");
  expect(cancelled).toHaveBeenCalledOnce();
});
it("middle clipping preserves both ends without adding a default length cap", () => {
  const content = "START" + "x".repeat(80_000) + "END";
  expect(maybeTruncate(content)).toBe(content);
  expect(maybeTruncate(content, 0)).toBe(content);
  const clipped = maybeTruncate(content, 1000);
  expect(clipped).toHaveLength(1000);
  expect(clipped.startsWith("START")).toBe(true);
  expect(clipped.endsWith("END")).toBe(true);
});
it("real staged summarization recovers injected overflow with a reduced request", async () => {
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
  const requests: string[] = [];
  const streamFn: StreamFn = (_model, context) => {
    requests.push(JSON.stringify(context));
    if (requests.length === 1) throw Error("context length exceeded");
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: "stop",
      message: makeAgentAssistantMessage({
        content: [{ type: "text", text: "recovered checkpoint" }],
      }),
    });
    stream.end();
    return stream;
  };
  const snapshot = structuredClone(messages);
  const result = await summarizeInStages({
    messages,
    model,
    apiKey: "test-key",
    signal: signal(),
    reserveTokens: 1000,
    maxChunkTokens: 50_000,
    contextWindow: 200_000,
    streamFn,
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]).toContain("FOLDED-START");
  expect(requests[0]).toContain("FOLDED-END");
  expect(requests[1]).not.toContain("FOLDED-START");
  expect(requests[1]).toContain("most recent owner turn");
  expect(result).toContain("recovered checkpoint");
  expect(result).toContain("Uncertain");
  expect(messages).toEqual(snapshot);
});
