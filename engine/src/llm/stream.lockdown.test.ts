import { createApiRegistry, createLlmRuntime } from "@branch/ai";
import type { AssistantMessageEventStreamContract, Model } from "@branch/llm-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LockdownError } from "../config/lockdown.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import { bindModelLlmRuntime } from "./model-runtime-binding.js";
import { complete, completeSimple, stream, streamSimple } from "./stream.js";
import { createAssistantMessageEventStream } from "./utils/event-stream.js";

function lockedRuntime() {
  const registry = createApiRegistry();
  const model = {
    api: "test-lockdown-api",
    provider: "test-lockdown",
    id: "test-lockdown-model",
    name: "Test Lockdown Model",
    baseUrl: "https://example.test",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1024,
    maxTokens: 512,
  } satisfies Model;
  const provider = vi.fn((): AssistantMessageEventStreamContract => {
    const output = createAssistantMessageEventStream();
    output.end();
    return output;
  });
  registry.registerApiProvider({ api: model.api, stream: provider, streamSimple: provider });
  setRuntimeConfigSnapshot({ security: { lockdown: true } });
  return { model: bindModelLlmRuntime(model, createLlmRuntime(registry)), provider };
}

describe("model calls under Lockdown", () => {
  afterEach(() => clearRuntimeConfigSnapshot());

  it("rejects completions without calling the provider", async () => {
    const { model, provider } = lockedRuntime();
    await expect(complete(model, { messages: [] })).rejects.toBeInstanceOf(LockdownError);
    await expect(completeSimple(model, { messages: [] })).rejects.toBeInstanceOf(LockdownError);
    expect(provider).not.toHaveBeenCalled();
  });

  it("ends streams with one error event and no provider call", async () => {
    const { model, provider } = lockedRuntime();
    for (const open of [stream, streamSimple]) {
      const events = [];
      for await (const event of open(model, { messages: [] })) events.push(event);
      expect(events).toMatchObject([{ type: "error", error: { errorMessage: "Lockdown is on: Trunks cannot run or send anything." } }]);
    }
    expect(provider).not.toHaveBeenCalled();
  });
});
