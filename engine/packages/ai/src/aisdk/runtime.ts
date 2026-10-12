// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/llm/model/model.loop.ts (atlas AGENT-LOOP-0026). Adapted model invocation to Branch's registry, guarded fetch, and event protocol; Branch owns the agent/tool loop.
import { createApiRegistry } from "../api-registry.js";
import { getAiTransportHost } from "../host.js";
import { createLlmRuntime } from "../stream.js";
import { buildGuardedModelFetch, buildManagedModelFetch } from "../transports/host-policy.js";
import type { Context, Model, StreamOptions, AssistantMessage } from "../types.js";
import { formatThrownValue } from "../utils/diagnostics.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { streamSdkModel, type AiSdkLanguageModel } from "./model-adapters.js";
import { createSdkCallOptions } from "./prompt.js";
import { createSdkStreamReducer } from "./stream-reducer.js";

export type AiSdkModelFactory = (request: {
  model: Model;
  fetch: typeof fetch;
  apiKey?: string;
  signal?: AbortSignal;
}) => AiSdkLanguageModel | Promise<AiSdkLanguageModel>;

function createOutput(model: Model): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

async function openSdkStream(
  factory: AiSdkModelFactory,
  model: Model,
  context: Context,
  options: StreamOptions | undefined,
  method: "generate" | "stream",
) {
  options?.signal?.throwIfAborted();
  const sdk = await factory({
    model,
    fetch: buildManagedModelFetch(model) ?? buildGuardedModelFetch(model, options?.timeoutMs),
    apiKey: options?.apiKey
      ? getAiTransportHost().resolveSecretSentinel(options.apiKey)
      : undefined,
    signal: options?.signal,
  });
  options?.signal?.throwIfAborted();
  const call = createSdkCallOptions(sdk, model, context, options);
  const projected = await options?.onPayload?.(call, model);
  return streamSdkModel(sdk, projected === undefined ? call : (projected as typeof call), method);
}

async function invokeSdk(
  factory: AiSdkModelFactory,
  model: Model,
  context: Context,
  options: StreamOptions | undefined,
  method: "generate" | "stream",
  stream: AssistantMessageEventStream,
  output: AssistantMessage,
): Promise<void> {
  const sdkStream = await openSdkStream(factory, model, context, options, method);
  const reducer = createSdkStreamReducer(output, stream, model);
  const reader = sdkStream.getReader();
  const abort = () => {
    void reader.cancel(options?.signal?.reason).catch(() => {});
  };
  options?.signal?.addEventListener("abort", abort, { once: true });
  stream.push({ type: "start", partial: output });
  try {
    while (true) {
      options?.signal?.throwIfAborted();
      const part = await reader.read();
      options?.signal?.throwIfAborted();
      if (part.done) break;
      reducer.consume(part.value);
    }
    reducer.assertFinished();
  } finally {
    options?.signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function createSdkStream(factory: AiSdkModelFactory, method: "generate" | "stream") {
  return (model: Model, context: Context, options?: StreamOptions) => {
    const stream = new AssistantMessageEventStream();
    const output = createOutput(model);
    void invokeSdk(factory, model, context, options, method, stream, output)
      .then(() => {
        stream.push({
          type: "done",
          reason: output.stopReason as "stop" | "length" | "toolUse",
          message: output,
        });
        stream.end();
      })
      .catch((error: unknown) => {
        output.stopReason = options?.signal?.aborted ? "aborted" : "error";
        output.errorMessage = getAiTransportHost().redactToolPayloadText(formatThrownValue(error));
        stream.push({ type: "error", reason: output.stopReason, error: output });
        stream.end();
      });
    return stream;
  };
}

/** Versioned SDK models run through the same Branch provider protocol and host policy. */
export function createAiSdkModelRuntime(api: string, factory: AiSdkModelFactory) {
  const registry = createApiRegistry();
  const streaming = createSdkStream(factory, "stream");
  const generating = createSdkStream(factory, "generate");
  registry.registerApiProvider({ api, stream: streaming, streamSimple: streaming });
  const runtime = createLlmRuntime(registry);
  const generateRegistry = createApiRegistry();
  generateRegistry.registerApiProvider({ api, stream: generating, streamSimple: generating });
  const generateRuntime = createLlmRuntime(generateRegistry);
  return {
    ...runtime,
    complete: generateRuntime.complete,
    completeSimple: generateRuntime.completeSimple,
  };
}
