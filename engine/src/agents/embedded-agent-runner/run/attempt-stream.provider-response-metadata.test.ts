import path from "node:path";
import { configureAiTransportHost, getAiTransportHost } from "@branch/ai";
import { defaultLlmRuntime } from "@branch/ai/internal/runtime";
import { expect, it, vi } from "vitest";
import {
  anthropicModel,
  anthropicEvents,
  context,
  createAnthropicResponse,
} from "../../../../packages/ai/src/provider-transport-parity.test-support.js";
import { createDeferred } from "../../../../test/helpers/promise.js";
import { replaceSessionEntrySync } from "../../../config/sessions/session-accessor.js";
import { createDiagnosticTraceContext } from "../../../infra/diagnostic-trace-context.js";
import type { AssistantMessage, Model, ProviderResponse } from "../../../llm/types.js";
import { createAssistantMessageEventStream } from "../../../llm/utils/event-stream.js";
import { createDiagnosticEmbeddedRunOwner } from "../../../logging/diagnostic-run-activity.js";
import {
  withBranchTestState,
  type BranchTestState,
} from "../../../test-utils/branch-test-state.js";
import type { StreamFn } from "../../runtime/index.js";
import {
  createAssistant,
  testModel,
} from "../../sessions/agent-session-loop-correctness.test-support.js";
import { SessionManager } from "../../sessions/session-manager.js";
import type { EmbeddedAttemptExecutionPhaseInput } from "./attempt-execution-types.js";
import { installEmbeddedAttemptStreamGuards } from "./attempt-stream.js";
import { readProviderResponseID } from "./provider-response-metadata.js";
import "../../../llm/stream.js";

function installProvider(
  provider: StreamFn,
  model: Model = testModel,
  manager = SessionManager.inMemory(),
) {
  const activeSession = {
    agent: { streamFn: provider },
    sessionId: manager.getSessionTarget()?.sessionId ?? "provider-id-fixture",
    messages: [],
  };
  const input = {
    attempt: {
      config: {},
      model,
      modelId: model.id,
      provider: model.provider,
      runId: "provider-id-run",
      sessionId: activeSession.sessionId,
      timeoutMs: 120_000,
    },
    runAbortController: new AbortController(),
    prepared: {
      sessionRuntime: {
        agentSession: { activeSession },
        sessionManager: manager,
        contextGuards: { recordCacheTouch: () => {} },
        isOpenAIResponsesApi: false,
        state: { systemPromptText: "Synthetic fixture" },
        transcriptPolicy: {},
        transport: { effectiveAgentTransport: "sse" },
      },
      toolCatalog: {
        toolSearchRunPlan: { liveAllowedToolNames: new Set(), replayAllowedToolNames: new Set() },
      },
    },
    setup: { sessionAgentId: "main" },
    diagnostics: { runTrace: createDiagnosticTraceContext() },
    lifecycle: { readYieldState: () => ({ yieldDetected: false }) },
  } as unknown as EmbeddedAttemptExecutionPhaseInput;
  installEmbeddedAttemptStreamGuards(input, {
    onRejectedProviderReplayRepaired: () => {},
    onIdleTimeout: () => {},
    diagnosticOwner: createDiagnosticEmbeddedRunOwner({
      runId: "provider-id-run",
      sessionId: activeSession.sessionId,
    }),
  });
  return activeSession.agent.streamFn;
}

function responseProvider(responses: ProviderResponse[], message: AssistantMessage): StreamFn {
  return async (model, _context, options) => {
    for (const response of responses) {
      await options?.onResponse?.(response, model);
    }
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end();
    return stream;
  };
}

async function assertNativeRetention(
  state: BranchTestState,
  onResponse: (response: ProviderResponse, model: Model) => void | Promise<void>,
) {
  const target = {
    agentId: "main",
    sessionId: "provider-id-fixture",
    sessionKey: "agent:main:provider-id-fixture",
    storePath: path.join(state.agentDir(), "sessions.json"),
  };
  replaceSessionEntrySync(target, { sessionId: target.sessionId, updatedAt: 1 });
  const manager = SessionManager.open(target, state.workspaceDir);
  const provider: StreamFn = (model, messages, options) =>
    defaultLlmRuntime.streamSimple(model, messages, {
      ...options,
      apiKey: "synthetic-fixture-only",
    });
  const stream = await installProvider(provider, anthropicModel, manager)(anthropicModel, context, {
    onResponse,
    requestId: "local-not-upstream",
  });
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  const result = await stream.result();
  expect(result.responseId).toBe("msg_parity");
  expect(readProviderResponseID(result.providerMetadata)).toBe("fra1::native-retained");
  expect(events.find((event) => event.type === "done")).toMatchObject({
    message: { providerMetadata: { kilo: { vercelID: "fra1::native-retained" } } },
  });
  expect(onResponse).toHaveBeenCalledOnce();
  manager.appendMessage({ role: "user", content: "Synthetic retention fixture", timestamp: 1 });
  manager.appendMessage(result);
  const retained = SessionManager.open(target, state.workspaceDir)
    .buildSessionContext()
    .messages.find((message) => message.role === "assistant");
  expect(retained).toMatchObject({
    providerMetadata: { kilo: { vercelID: "fra1::native-retained" } },
  });
}

it("retains actual transport response headers through native session append and reload", async () => {
  await import("../../ai-transport-runtime-host.js");
  const previousHost = getAiTransportHost();
  const onResponse = vi.fn(async () => {
    await Promise.resolve();
  });
  configureAiTransportHost({
    ...previousHost,
    buildModelFetch: () => async () => {
      const response = createAnthropicResponse(anthropicEvents);
      response.headers.set("X-Vercel-Id", "  fra1::native-retained  ");
      return response;
    },
  });
  try {
    await withBranchTestState({ label: "provider-request-id-retained" }, async (state) => {
      await assertNativeRetention(state, onResponse);
    });
  } finally {
    configureAiTransportHost(previousHost);
  }
});

const retryCases: Array<{
  label: string;
  headers: ProviderResponse["headers"];
  expected: string | undefined;
}> = [
  {
    label: "valid replacement",
    headers: { "x-vercel-id": "fra1::second" },
    expected: "fra1::second",
  },
  { label: "headerless success", headers: {}, expected: undefined },
  { label: "unsafe success", headers: { "x-vercel-id": "unsafe\nsecret" }, expected: undefined },
];

it.each(retryCases)(
  "uses the terminal response for $label and result-only consumers",
  async ({ headers, expected }) => {
    const message = createAssistant(testModel, [{ type: "text", text: "Fixture" }]);
    message.providerMetadata = { other: { preserved: true }, kilo: { preserved: true } };
    const streamFn = installProvider(
      responseProvider(
        [
          { status: 503, headers: { "x-vercel-id": "fra1::failed" } },
          { status: 200, headers },
        ],
        message,
      ),
    );
    const callback = vi.fn(async () => {
      await Promise.resolve();
    });
    const stream = await streamFn(testModel, { messages: [] }, { onResponse: callback });
    const result = await stream.result();
    expect(readProviderResponseID(result.providerMetadata)).toBe(expected);
    expect(result.providerMetadata).toMatchObject({
      other: { preserved: true },
      kilo: { preserved: true },
    });
    expect(callback).toHaveBeenCalledTimes(2);
  },
);

it("keeps response callback rejection and isolates consecutive model calls", async () => {
  const responses = [{ status: 200, headers: { "x-vercel-id": "fra1::first-call" } }];
  const provider: StreamFn = (model, messages, options) =>
    responseProvider(
      responses.splice(0),
      createAssistant(testModel, [{ type: "text", text: "Fixture" }]),
    )(model, messages, options);
  const streamFn = installProvider(provider);
  const first = await streamFn(testModel, { messages: [] }, {});
  expect(readProviderResponseID((await first.result()).providerMetadata)).toBe("fra1::first-call");
  const second = await streamFn(testModel, { messages: [] }, {});
  expect((await second.result()).providerMetadata).toBeUndefined();
  const rejected = installProvider(
    responseProvider([{ status: 200, headers: {} }], createAssistant(testModel, [])),
  );
  await expect(
    rejected(
      testModel,
      { messages: [] },
      {
        onResponse: async () => {
          throw new Error("fixture callback failure");
        },
      },
    ),
  ).rejects.toThrow("fixture callback failure");
});

it("waits for the existing async response callback before provider completion", async () => {
  const released = createDeferred<void>();
  const invoked = createDeferred<void>();
  const message = createAssistant(testModel, [{ type: "text", text: "Fixture" }]);
  const provider = responseProvider(
    [{ status: 200, headers: { "x-vercel-id": "fra1::awaited" } }],
    message,
  );
  let completed = false;
  const pending = Promise.resolve(
    installProvider(provider)(
      testModel,
      { messages: [] },
      {
        onResponse: () => {
          invoked.resolve();
          return released.promise;
        },
      },
    ),
  ).then((stream) => {
    completed = true;
    return stream;
  });
  await invoked.promise;
  await Promise.resolve();
  const completedBeforeRelease = completed;
  released.resolve();
  const result = await (await pending).result();
  expect(completedBeforeRelease).toBe(false);
  expect(readProviderResponseID(result.providerMetadata)).toBe("fra1::awaited");
});

it("decorates synchronous partials and removes an earlier capture on a headerless terminal retry", async () => {
  const message = createAssistant(testModel, [{ type: "text", text: "Fixture" }]);
  message.providerMetadata = { other: true };
  const source = createAssistantMessageEventStream();
  let responseHook: NonNullable<Parameters<StreamFn>[2]>["onResponse"];
  const provider: StreamFn = (model, _context, options) => {
    responseHook = options?.onResponse;
    responseHook?.({ status: 503, headers: { "x-vercel-id": "fra1::earlier" } }, model);
    source.push({ type: "start", partial: message });
    return source;
  };
  const stream = installProvider(provider)(testModel, { messages: [] }, {});
  expect(stream).not.toHaveProperty("then");
  const resolved = await stream;
  const iterator = resolved[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({
    partial: { providerMetadata: { kilo: { vercelID: "fra1::earlier" } } },
  });
  const metadata = message.providerMetadata;
  if (!metadata) {
    throw new Error("Expected captured partial metadata");
  }
  metadata.other = "provider-updated";
  (metadata.kilo as Record<string, unknown>).providerUpdated = true;
  await responseHook?.({ status: 200, headers: {} }, testModel);
  source.push({ type: "done", reason: "stop", message });
  source.end();
  expect((await iterator.next()).value).toMatchObject({
    message: { providerMetadata: { other: "provider-updated", kilo: { providerUpdated: true } } },
  });
  expect(readProviderResponseID((await resolved.result()).providerMetadata)).toBeUndefined();
});

function startRetryPartial(message: AssistantMessage, manager: SessionManager) {
  const source = createAssistantMessageEventStream();
  let responseHook: NonNullable<Parameters<StreamFn>[2]>["onResponse"];
  const provider: StreamFn = (model, _context, options) => {
    responseHook = options?.onResponse;
    responseHook?.({ status: 503, headers: { "x-vercel-id": "fra1::earlier" } }, model);
    source.push({ type: "start", partial: message });
    return source;
  };
  return {
    stream: installProvider(provider, testModel, manager)(testModel, { messages: [] }, {}),
    finish: async () => {
      await responseHook?.({ status: 200, headers: {} }, testModel);
      source.push({ type: "done", reason: "stop", message });
      source.end();
    },
  };
}

const clonedMetadataCases = [
  { label: "shallow clone", before: undefined, providerID: undefined, expected: undefined },
  {
    label: "new provider-owned ID",
    before: undefined,
    providerID: "fra1::provider-update",
    expected: "fra1::provider-update",
  },
  {
    label: "pre-existing provider-owned ID",
    before: "fra1::provider-baseline",
    providerID: undefined,
    expected: "fra1::provider-baseline",
  },
];

it.each(clonedMetadataCases)(
  "preserves $label metadata through retry and durable reload",
  async (row) => {
    await withBranchTestState({ label: "provider-metadata-clone-retained" }, async (state) => {
      const target = {
        agentId: "main",
        sessionId: "provider-clone",
        sessionKey: "agent:main:provider-clone",
        storePath: path.join(state.agentDir(), "sessions.json"),
      };
      replaceSessionEntrySync(target, { sessionId: target.sessionId, updatedAt: 1 });
      const manager = SessionManager.open(target, state.workspaceDir);
      const message = createAssistant(testModel, [
        { type: "text", text: "Synthetic clone fixture" },
      ]);
      message.providerMetadata = {
        other: true,
        kilo: { stable: true, ...(row.before ? { vercelID: row.before } : {}) },
      };
      const retry = startRetryPartial(message, manager);
      const stream = await retry.stream;
      const iterator = stream[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toMatchObject({
        partial: { providerMetadata: { kilo: { vercelID: "fra1::earlier" } } },
      });
      message.providerMetadata = {
        ...message.providerMetadata,
        providerUpdate: true,
        kilo: {
          ...(message.providerMetadata.kilo as Record<string, unknown>),
          nestedUpdate: true,
          ...(row.providerID ? { vercelID: row.providerID } : {}),
        },
      };
      await retry.finish();
      await iterator.next();
      const result = await stream.result();
      expect(readProviderResponseID(result.providerMetadata)).toBe(row.expected);
      manager.appendMessage({ role: "user", content: "Synthetic clone retention", timestamp: 1 });
      manager.appendMessage(result);
      const retained = SessionManager.open(target, state.workspaceDir)
        .buildSessionContext()
        .messages.find((value) => value.role === "assistant") as AssistantMessage;
      expect(retained.providerMetadata).toMatchObject({
        other: true,
        providerUpdate: true,
        kilo: { stable: true, nestedUpdate: true },
      });
      expect(readProviderResponseID(retained.providerMetadata)).toBe(row.expected);
    });
  },
);
