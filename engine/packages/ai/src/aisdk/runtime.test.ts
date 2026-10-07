// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/model.loop.ts (atlas AGENT-LOOP-0026). Branch contract tests for the adapted versioned invocation; these do not replace upstream worker E2E tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAiTransportHost } from "../host.js";
import type { Context, Model } from "../types.js";
import type { AiSdkStreamPart } from "./generate-to-stream.js";
import type { AiSdkLanguageModel } from "./model-adapters.js";
import { createSdkCallOptions } from "./prompt.js";
import { createAiSdkModelRuntime } from "./runtime.js";

const model: Model = {
  id: "fixture",
  name: "fixture",
  api: "sdk-fixture",
  provider: "fixture",
  baseUrl: "https://fixture.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 },
  contextWindow: 1000,
  maxTokens: 100,
};
const context: Context = { messages: [{ role: "user", content: "Hello", timestamp: 0 }] };
const finish: AiSdkStreamPart = {
  type: "finish",
  finishReason: "stop",
  usage: {
    inputTokens: { total: 10, noCache: 7, cacheRead: 2, cacheWrite: 1 },
    outputTokens: { total: 4 },
  },
};

function fixture(version: "v1" | "v2" | "v3", parts: AiSdkStreamPart[]) {
  const doStream = vi.fn(async (_options: unknown) => ({
    stream: new ReadableStream<AiSdkStreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  }));
  const usage =
    version === "v1"
      ? { promptTokens: 10, completionTokens: 4 }
      : version === "v2"
        ? { inputTokens: 10, outputTokens: 4 }
        : finish.usage;
  const doGenerate = vi.fn(async () => ({
    ...(version === "v1" ? { text: "Hello" } : { content: [{ type: "text", text: "Hello" }] }),
    usage,
    finishReason: "stop",
    warnings: [],
    rawCall: { rawPrompt: null, rawSettings: {} },
  }));
  // Test fixtures implement only the invoked provider methods; no fixture is exported to production.
  const sdk = {
    specificationVersion: version,
    provider: "fixture",
    modelId: "fixture",
    supportedUrls: {},
    doStream,
    doGenerate,
  } as unknown as AiSdkLanguageModel;
  return { sdk, doStream, doGenerate };
}

describe("Branch SDK runtime (AGENT-LOOP-0026)", () => {
  afterEach(() => configureAiTransportHost({}));
  it.each(["v1", "v2", "v3"] as const)(
    "runs %s generate and stream through native events",
    async (version) => {
      const usage =
        version === "v1"
          ? { promptTokens: 10, completionTokens: 4 }
          : version === "v2"
            ? { inputTokens: 10, outputTokens: 4 }
            : finish.usage;
      const provider = fixture(version, [
        { type: "text-delta", id: "text", delta: "Hello", textDelta: "Hello" },
        { ...finish, usage },
      ]);
      const runtime = createAiSdkModelRuntime(model.api, () => provider.sdk);
      const events = [];
      const stream = runtime.stream(model, context);
      for await (const event of stream) events.push(event.type);
      expect((await stream.result()).content).toEqual([{ type: "text", text: "Hello" }]);
      expect(events).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
      expect((await runtime.complete(model, context)).content).toEqual([
        { type: "text", text: "Hello" },
      ]);
      expect(provider.doGenerate).toHaveBeenCalledOnce();
      expect(provider.doStream).toHaveBeenCalledOnce();
    },
  );
  it("accepts different SDK majors in consecutive calls to one runtime", async () => {
    const models = [fixture("v1", []), fixture("v2", []), fixture("v3", [])];
    let turn = 0;
    const runtime = createAiSdkModelRuntime(model.api, () => models[turn++]!.sdk);
    const results = [];
    for (const _provider of models) results.push(await runtime.complete(model, context));
    expect(results.map((result) => result.content)).toEqual(
      models.map(() => [{ type: "text", text: "Hello" }]),
    );
    expect(results.every((result) => result.stopReason === "stop")).toBe(true);
    for (const provider of models) expect(provider.doGenerate).toHaveBeenCalledOnce();
  });
  it("projects native JSON formats into each SDK call contract", () => {
    const formats = [
      { type: "object", properties: { answer: { type: "string" } } },
      { type: "json_schema", json_schema: { name: "answer", schema: { type: "object" } } },
      { type: "json_object" },
    ];
    for (const version of ["v1", "v2", "v3"] as const) {
      for (const format of formats) {
        const call = createSdkCallOptions(fixture(version, []).sdk, model, context, {
          responseFormat: format,
        });
        if ("mode" in call) expect(call.mode.type).toBe("object-json");
        else expect(call.responseFormat?.type).toBe("json");
      }
    }
  });
  it("accounts for cached tokens once and retains non-native content", async () => {
    const provider = fixture("v3", [{ type: "custom", data: "preserved" }, finish]);
    const result = await createAiSdkModelRuntime(model.api, () => provider.sdk).complete(
      model,
      context,
    );
    const streamed = await createAiSdkModelRuntime(model.api, () => provider.sdk)
      .stream(model, context)
      .result();
    expect(result.stopReason).toBe("stop");
    expect(streamed.usage).toMatchObject({
      input: 7,
      output: 4,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 14,
    });
    expect(streamed.usage.cost.total).toBeCloseTo(17 / 1_000_000);
    expect(streamed.providerMetadata?.aiSdkRawParts).toContainEqual({
      type: "custom",
      data: "preserved",
    });
  });
  it("does not re-execute provider tools and admits client tools to Branch", async () => {
    const provider = fixture("v3", [
      { type: "tool-input-start", id: "provider", toolName: "search", providerExecuted: true },
      { type: "tool-input-delta", id: "provider", delta: "{}" },
      {
        type: "tool-call",
        toolCallId: "provider",
        toolName: "search",
        input: "{}",
        providerExecuted: true,
      },
      { type: "tool-input-start", id: "client", toolName: "read" },
      { type: "tool-input-delta", id: "client", delta: '{"path":"a"}' },
      { type: "tool-call", toolCallId: "client", toolName: "read", input: '{"path":"a"}' },
      { ...finish, finishReason: "tool-calls" },
    ]);
    const result = await createAiSdkModelRuntime(model.api, () => provider.sdk)
      .stream(model, context)
      .result();
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toEqual([
      { type: "toolCall", id: "client", name: "read", arguments: { path: "a" } },
    ]);
  });
  it("rejects incomplete provider streams", async () => {
    const provider = fixture("v3", [{ type: "text-delta", id: "text", delta: "partial" }]);
    const result = await createAiSdkModelRuntime(model.api, () => provider.sdk)
      .stream(model, context)
      .result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("without a finish event");
  });
  it("cancels a blocked reader on abort", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const provider = fixture("v3", []);
    provider.sdk.doStream = vi.fn(async (_options: unknown) => ({
      stream: new ReadableStream({ cancel }),
    })) as typeof provider.sdk.doStream;
    const stream = createAiSdkModelRuntime(model.api, () => provider.sdk).stream(model, context, {
      signal: controller.signal,
    });
    for await (const event of stream) {
      if (event.type === "start") controller.abort();
    }
    expect((await stream.result()).stopReason).toBe("aborted");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("enforces the embedding host's managed transport requirement", async () => {
    configureAiTransportHost({
      requiresManagedTransport: () => true,
      buildModelFetch: () => undefined,
    });
    const provider = fixture("v3", [finish]);
    const factory = vi.fn(() => provider.sdk);
    const result = await createAiSdkModelRuntime(model.api, factory)
      .stream(model, context)
      .result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("requires a managed provider transport");
    expect(factory).not.toHaveBeenCalled();
  });
  it("passes guarded fetch, resolved credentials, signal and payload hooks", async () => {
    const guarded = vi.fn<typeof fetch>();
    configureAiTransportHost({
      buildModelFetch: () => guarded,
      resolveSecretSentinel: () => "resolved",
    });
    const provider = fixture("v3", [finish]);
    const factory = vi.fn(() => provider.sdk);
    const signal = new AbortController().signal;
    const onPayload = vi.fn((payload) => payload);
    await createAiSdkModelRuntime(model.api, factory)
      .stream(model, context, { apiKey: "sentinel", signal, onPayload })
      .result();
    expect(factory).toHaveBeenCalledWith({ model, fetch: guarded, apiKey: "resolved", signal });
    expect(onPayload).toHaveBeenCalledOnce();
    expect(provider.doStream.mock.calls[0]?.[0]).toMatchObject({
      abortSignal: signal,
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
  });
});
