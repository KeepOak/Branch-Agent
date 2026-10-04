import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { VERSION } from "branch/plugin-sdk/cli-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { createDeferred } from "branch/plugin-sdk/extension-shared";
import {
  createMockIncomingRequest,
  createMockServerResponse,
  postRawWebhook,
  withServer,
} from "branch/plugin-sdk/test-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createA2aHttpHandler } from "./http.js";
import { A2aTaskStore } from "./task-store.js";
import type { A2aChannelConfig } from "./types.js";

vi.mock("node:timers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:timers")>();
  return {
    ...actual,
    setTimeout: ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) =>
      globalThis.setTimeout(callback, delay, ...args)) as typeof actual.setTimeout,
    clearTimeout: ((timer: ReturnType<typeof globalThis.setTimeout> | undefined) =>
      globalThis.clearTimeout(timer)) as typeof actual.clearTimeout,
  };
});

const activeStores = new Set<A2aTaskStore>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of activeStores) {
    store.stop();
  }
  activeStores.clear();
});

async function startHttpHarness(options?: {
  config?: BranchConfig;
  a2aConfig?: Partial<A2aChannelConfig>;
  onDispatch?: (message: {
    taskId: string;
    contextId: string;
    messageId: string;
    peerName: string;
    text: string;
  }) => Promise<void>;
}) {
  const taskStore = new A2aTaskStore();
  activeStores.add(taskStore);
  const config = options?.config ?? {};
  const a2aConfig: A2aChannelConfig = {
    peers: {
      alpha: { token: "alpha-secret" },
      beta: { token: "beta-secret" },
    },
    ...options?.a2aConfig,
  };
  const dispatchInbound =
    options?.onDispatch ??
    (async (message) => {
      taskStore.completeNext(message.contextId, `echo: ${message.text}`, message.peerName);
    });
  const handler = createA2aHttpHandler({
    config,
    a2aConfig,
    version: VERSION,
    taskStore,
    dispatchInbound,
  });
  const baseUrl = "http://gateway.example.test";

  async function dispatchRequest(dispatch: {
    method: "GET" | "POST";
    endpoint: string;
    body?: string;
    token?: string | null;
  }) {
    const request = createMockIncomingRequest(dispatch.body === undefined ? [] : [dispatch.body]);
    request.method = dispatch.method;
    request.url = dispatch.endpoint;
    request.headers = {
      host: "gateway.example.test",
      ...(dispatch.body === undefined
        ? {}
        : {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(dispatch.body)),
          }),
      ...(dispatch.token ? { authorization: `Bearer ${dispatch.token}` } : {}),
    };
    Object.defineProperty(request.socket, "remoteAddress", {
      value: "127.0.0.1",
    });

    const response = createMockServerResponse();
    const events = new EventEmitter();
    response.once = events.once.bind(events) as ServerResponse["once"];
    const originalEnd = response.end.bind(response);
    response.end = ((body?: string) => {
      originalEnd(body);
      events.emit("finish");
      return response;
    }) as ServerResponse["end"];
    await handler(request, response);

    return {
      status: response.statusCode,
      async json(): Promise<unknown> {
        return JSON.parse(response.body ?? "");
      },
      async text(): Promise<string> {
        return response.body ?? "";
      },
    };
  }

  return {
    baseUrl,
    taskStore,
    handler,
    async get(endpoint: string) {
      return await dispatchRequest({ method: "GET", endpoint });
    },
    async post(body: unknown, token: string | null = "alpha-secret") {
      return await dispatchRequest({
        method: "POST",
        endpoint: "/a2a/v1",
        body: typeof body === "string" ? body : JSON.stringify(body),
        token,
      });
    },
  };
}

function sendRequest(options?: {
  id?: string | number;
  contextId?: string;
  messageId?: string;
  text?: string;
  returnImmediately?: boolean;
  method?: string;
}) {
  return {
    jsonrpc: "2.0",
    ...(options?.id !== undefined ? { id: options.id } : { id: "send-1" }),
    method: options?.method ?? "SendMessage",
    params: {
      message: {
        ...(options?.messageId ? { messageId: options.messageId } : {}),
        ...(options?.contextId ? { contextId: options.contextId } : {}),
        role: "ROLE_USER",
        parts: [{ text: options?.text ?? "hello" }],
      },
      ...(options?.returnImmediately ? { configuration: { returnImmediately: true } } : {}),
    },
  };
}

describe("A2A HTTP agent discovery", () => {
  it("serves both public discovery paths with the canonical bounded v1.0 card", async () => {
    const hiddenDescription = "hidden-secret-description";
    const harness = await startHttpHarness({
      config: {
        agents: {
          list: [
            { id: "hidden", description: hiddenDescription },
            { id: "writer", name: "Writing assistant", description: "x".repeat(500) },
            { id: "reviewer" },
          ],
        },
      },
      a2aConfig: {
        advertisedUrl: "https://agents.example.test/",
        exposeAgents: ["writer", "reviewer"],
      },
    });

    for (const endpoint of ["/.well-known/agent-card.json", "/.well-known/agent.json"]) {
      const response = await harness.get(endpoint);
      const card = (await response.json()) as {
        capabilities: Record<string, unknown>;
        skills: Array<{ id: string; description: string }>;
      };
      expect(response.status).toBe(200);
      expect(card).toMatchObject({
        name: "Writing assistant",
        description: expect.any(String),
        supportedInterfaces: [
          {
            url: "https://agents.example.test/a2a/v1",
            protocolBinding: "JSONRPC",
            protocolVersion: "1.0",
          },
        ],
        version: VERSION,
        capabilities: {
          streaming: true,
          pushNotifications: true,
        },
        securitySchemes: { bearerAuth: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
        defaultInputModes: ["text/plain"],
        defaultOutputModes: ["text/plain"],
        skills: [
          { id: "writer", name: "writer", tags: ["branch"] },
          { id: "reviewer", name: "reviewer", tags: ["branch"] },
        ],
      });
      // A2A v1.0 AgentCapabilities has no stateTransitionHistory member; a
      // partial match would let the retired 0.3 field reappear unnoticed.
      expect(Object.keys(card.capabilities).toSorted()).toEqual(["pushNotifications", "streaming"]);
      // The card is served unauthenticated, so operator-authored descriptions
      // must never reach it - not the unexposed agent's, not the exposed one's.
      expect(card.skills[0]?.description).toBe("Branch Agent agent writer.");
      expect(card.skills[1]?.description).toBe("Branch Agent agent reviewer.");
      expect(JSON.stringify(card)).not.toContain(hiddenDescription);
      expect(JSON.stringify(card)).not.toContain("x".repeat(50));
      expect(card).not.toHaveProperty("protocolVersion");
      expect(card).not.toHaveProperty("url");
      expect(card).not.toHaveProperty("preferredTransport");
    }
  });

  it("advertises skills for the canonical agents.entries roster", async () => {
    const harness = await startHttpHarness({
      config: {
        agents: {
          entries: {
            main: { description: "Primary assistant" },
            research: { name: "Research", description: "Deep research" },
          },
        },
      },
    });

    const card = (await (await harness.get("/.well-known/agent-card.json")).json()) as {
      skills: Array<{ id: string; description: string }>;
    };

    // Operators configure agents.entries, not the legacy agents.list projection;
    // reading only the list shape published a skill-less card to every peer.
    expect(card.skills.map((skill) => skill.id).toSorted()).toEqual(["main", "research"]);
    expect(card.skills.find((skill) => skill.id === "research")?.description).toBe(
      "Branch Agent agent research.",
    );
  });

  it("derives the advertised interface origin from the request Host", async () => {
    const harness = await startHttpHarness({
      config: { agents: { list: [{ id: "main" }] } },
    });
    const response = await harness.get("/.well-known/agent-card.json");
    const card = (await response.json()) as { supportedInterfaces: Array<{ url: string }> };

    expect(card.supportedInterfaces[0]?.url).toBe(`${harness.baseUrl}/a2a/v1`);
  });
});

describe("A2A HTTP authentication and request limits", () => {
  it.each([
    ["missing bearer", null],
    ["long invalid token", "x".repeat(200)],
  ])("rejects %s", async (_label, token) => {
    const harness = await startHttpHarness();
    const denied = await harness.post(sendRequest(), token);

    expect(denied.status).toBe(401);
    await expect(denied.json()).resolves.toMatchObject({
      error: expect.stringContaining("channels.a2a.peers"),
    });
  });

  it("limits each peer independently and admits requests when the sliding window expires", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const harness = await startHttpHarness({ a2aConfig: { rateLimitPerMinute: 2 } });
    const request = { jsonrpc: "2.0", id: "task", method: "GetTask", params: { id: "missing" } };

    await harness.post(request);
    await harness.post(request);
    const limited = await harness.post(request);
    expect(limited.status).toBe(200);
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: -32000, message: expect.stringContaining("rate limited") },
    });

    const otherPeer = await harness.post(request, "beta-secret");
    await expect(otherPeer.json()).resolves.toMatchObject({ error: { code: -32001 } });

    now += 60_001;
    const admittedAgain = await harness.post(request);
    await expect(admittedAgain.json()).resolves.toMatchObject({ error: { code: -32001 } });
  });

  it("allows unlimited requests when the per-peer rate limit is zero", async () => {
    const harness = await startHttpHarness({ a2aConfig: { rateLimitPerMinute: 0 } });
    const request = { jsonrpc: "2.0", id: 1, method: "GetTask", params: { id: "missing" } };

    const responses = await Promise.all(Array.from({ length: 35 }, () => harness.post(request)));
    for (const response of responses) {
      await expect(response.json()).resolves.toMatchObject({ error: { code: -32001 } });
    }
  });

  it("delivers HTTP 413 over the wire and closes for request bodies above 1 MiB", async () => {
    const harness = await startHttpHarness();
    await withServer(
      (req, res) => {
        void harness.handler(req, res);
      },
      async (baseUrl) => {
        // Declared and sent in one write: the shape whose rejection used to race the flush.
        const result = await postRawWebhook({
          url: `${baseUrl}/a2a/v1`,
          body: "x".repeat(1024 * 1024 + 1),
          headers: {
            "content-type": "application/json",
            authorization: "Bearer alpha-secret",
          },
        });

        expect(result.statusLine).toBe("HTTP/1.1 413 Payload Too Large");
        expect(result.headers.connection).toBe("close");
        expect(JSON.parse(result.body)).toEqual({
          error: "Request body exceeds the 1 MiB limit",
        });
        expect(result.closedByServer).toBe(true);
      },
    );
  });

  it("delivers the JSON-RPC timeout response before closing a partial upload", async () => {
    const harness = await startHttpHarness();
    const requestReceived = createDeferred<void>();
    await withServer(
      (req, res) => {
        void harness.handler(req, res);
        // Observe after the body reader is installed; Bun's socket wrapper omits raw data events.
        req.once("data", () => requestReceived.resolve());
      },
      async (baseUrl) => {
        vi.useFakeTimers();
        try {
          const resultPromise = postRawWebhook({
            url: `${baseUrl}/a2a/v1`,
            body: "{",
            contentLength: 2,
            idleTimeoutMs: 60_000,
            headers: {
              "content-type": "application/json",
              authorization: "Bearer alpha-secret",
            },
          });

          await requestReceived.promise;
          await vi.advanceTimersByTimeAsync(31_000);
          const result = await resultPromise;

          expect(result.statusLine).toBe("HTTP/1.1 200 OK");
          expect(result.headers.connection).toBe("close");
          expect(JSON.parse(result.body)).toEqual({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: "Request body could not be read" },
          });
          expect(result.closedByServer).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      },
    );
  });

  it("rejects oversized batches with one bounded error", async () => {
    const harness = await startHttpHarness();
    const response = await harness.post(Array.from({ length: 1_000 }, () => null));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: null,
      error: { code: -32000, message: expect.stringContaining("batch") },
    });
    expect(Buffer.byteLength(await response.text())).toBeLessThan(1_024);
  });

  it("charges schema-invalid requests to the peer rate limit", async () => {
    const harness = await startHttpHarness({ a2aConfig: { rateLimitPerMinute: 1 } });

    const invalid = await harness.post({ jsonrpc: "2.0", id: "invalid" });
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: -32600 } });

    const limited = await harness.post({
      jsonrpc: "2.0",
      id: "limited",
      method: "GetTask",
      params: { id: "missing" },
    });
    await expect(limited.json()).resolves.toMatchObject({
      id: "limited",
      error: { code: -32000, message: expect.stringContaining("rate limited") },
    });
  });

  it("replaces oversized RPC results with a bounded error", async () => {
    const harness = await startHttpHarness();
    const task = harness.taskStore.create("ctx-large", "alpha");
    const oversizedText = "x".repeat(1024 * 1024);
    harness.taskStore.completeNext(task.contextId, oversizedText, "alpha");
    const requestBody = JSON.stringify({
      jsonrpc: "2.0",
      id: "large-result",
      method: "GetTask",
      params: { id: task.id },
    });
    const stringifySpy = vi.spyOn(JSON, "stringify");

    const response = await harness.post(requestBody);

    await expect(response.json()).resolves.toMatchObject({
      id: "large-result",
      error: { code: -32000, message: expect.stringContaining("response") },
    });
    expect(Buffer.byteLength(await response.text())).toBeLessThan(1_024);
    expect(
      stringifySpy.mock.calls.some(
        ([value]) =>
          (value as { result?: { artifacts?: Array<{ parts?: Array<{ text?: string }> }> } })
            ?.result?.artifacts?.[0]?.parts?.[0]?.text === oversizedText,
      ),
    ).toBe(false);
  });

  it("keeps the overflow fallback bounded when its request ID cannot fit", async () => {
    const harness = await startHttpHarness();
    const requestBody = JSON.stringify({
      jsonrpc: "2.0",
      id: "i".repeat(1024 * 1024 - 25),
    });
    expect(Buffer.byteLength(requestBody)).toBeLessThanOrEqual(1024 * 1024);

    const response = await harness.post(requestBody);

    await expect(response.json()).resolves.toMatchObject({
      id: null,
      error: { code: -32000, message: expect.stringContaining("response") },
    });
    expect(Buffer.byteLength(await response.text())).toBeLessThan(1_024);
  });

  it("preserves batch response IDs when aggregate results exceed the response limit", async () => {
    const harness = await startHttpHarness();
    const taskA = harness.taskStore.create("ctx-large-a", "alpha");
    const taskB = harness.taskStore.create("ctx-large-b", "alpha");
    harness.taskStore.completeNext(taskA.contextId, "a".repeat(600 * 1024), "alpha");
    harness.taskStore.completeNext(taskB.contextId, "b".repeat(600 * 1024), "alpha");

    const response = await harness.post([
      { jsonrpc: "2.0", id: "large-a", method: "GetTask", params: { id: taskA.id } },
      { jsonrpc: "2.0", id: "large-b", method: "GetTask", params: { id: taskB.id } },
    ]);

    await expect(response.json()).resolves.toEqual([
      {
        jsonrpc: "2.0",
        id: "large-a",
        error: { code: -32000, message: expect.stringContaining("response") },
      },
      {
        jsonrpc: "2.0",
        id: "large-b",
        error: { code: -32000, message: expect.stringContaining("response") },
      },
    ]);
    expect(Buffer.byteLength(await response.text())).toBeLessThan(1_024);
  });
});

describe("A2A JSON-RPC protocol boundary", () => {
  it.each([
    ["malformed JSON", "{", -32700],
    ["invalid request ID", '{"jsonrpc":"2.0","id":{},"method":"GetTask"}', -32600],
    ["empty batch", "[]", -32600],
  ])("maps %s to its JSON-RPC error with HTTP 200", async (_label, body, errorCode) => {
    const harness = await startHttpHarness();
    const response = await harness.post(body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: errorCode },
    });
  });

  it.each([
    ["wrong protocol version", { jsonrpc: "1.0", id: "bad", method: "GetTask" }, -32600],
    ["unknown method", { jsonrpc: "2.0", id: "bad", method: "tasks/frobnicate" }, -32601],
    ["unsupported method", { jsonrpc: "2.0", id: "bad", method: "GetExtendedAgentCard" }, -32004],
    [
      "missing message parts",
      { jsonrpc: "2.0", id: "bad", method: "SendMessage", params: { message: { role: "user" } } },
      -32602,
    ],
    [
      "invalid context id",
      {
        jsonrpc: "2.0",
        id: "bad",
        method: "SendMessage",
        params: { message: { role: "user", contextId: "../../secret", parts: [{ text: "hi" }] } },
      },
      -32602,
    ],
    [
      "file-only message",
      {
        jsonrpc: "2.0",
        id: "bad",
        method: "SendMessage",
        params: { message: { role: "user", parts: [{ url: "https://example.test/file" }] } },
      },
      -32602,
    ],
    ["missing task id", { jsonrpc: "2.0", id: "bad", method: "GetTask", params: {} }, -32602],
  ])("rejects %s", async (_label, request, errorCode) => {
    const harness = await startHttpHarness();
    const response = await harness.post(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ id: "bad", error: { code: errorCode } });
  });

  it("executes batch notifications without returning notification response entries", async () => {
    const harness = await startHttpHarness();
    const notification = sendRequest({ text: "notify", returnImmediately: true });
    const { id: _notificationId, ...withoutId } = notification;
    const response = await harness.post([
      withoutId,
      sendRequest({ id: "visible", text: "visible" }),
      42,
    ]);

    expect(response.status).toBe(200);
    const results = (await response.json()) as Array<{ id: string | null }>;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "visible",
      result: { task: { artifacts: [{ parts: [{ text: "echo: visible" }] }] } },
    });
    expect(results[1]).toMatchObject({ id: null, error: { code: -32600 } });
  });

  it("responds to notification-only requests with HTTP 200 and an empty body", async () => {
    const harness = await startHttpHarness();
    const { id: _notificationId, ...notification } = sendRequest({ returnImmediately: true });
    const response = await harness.post(notification);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });

  it.each(["SendMessage", "message/send", "tasks/send"])(
    "dispatches %s through the inbound channel boundary and returns its task artifact",
    async (method) => {
      const harness = await startHttpHarness();
      const response = await harness.post(
        sendRequest({ method, contextId: "conversation-1", text: "hello world" }),
      );

      await expect(response.json()).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: "send-1",
        result: {
          task: {
            contextId: "conversation-1",
            status: { state: "TASK_STATE_COMPLETED" },
            artifacts: [{ parts: [{ text: "echo: hello world" }] }],
            history: [],
          },
        },
      });
    },
  );

  it("returns immediately with a working task when requested and supports legacy task polling", async () => {
    const harness = await startHttpHarness({ onDispatch: async () => {} });
    const createdResponse = await harness.post(sendRequest({ returnImmediately: true }));
    const created = (await createdResponse.json()) as { result: { task: { id: string } } };

    expect(created).toMatchObject({
      result: { task: { status: { state: "TASK_STATE_WORKING" } } },
    });

    const polled = await harness.post({
      jsonrpc: "2.0",
      id: "poll",
      method: "tasks/get",
      params: { id: created.result.task.id },
    });
    await expect(polled.json()).resolves.toMatchObject({
      id: "poll",
      result: { id: created.result.task.id, status: { state: "TASK_STATE_WORKING" } },
    });
  });

  it("rejects task inspection from a different configured peer", async () => {
    const harness = await startHttpHarness({ onDispatch: async () => {} });
    const createdResponse = await harness.post(sendRequest({ returnImmediately: true }));
    const created = (await createdResponse.json()) as { result: { task: { id: string } } };

    const response = await harness.post(
      { jsonrpc: "2.0", id: "GetTask", method: "GetTask", params: { id: created.result.task.id } },
      "beta-secret",
    );
    await expect(response.json()).resolves.toMatchObject({
      id: "GetTask",
      error: { code: -32001, message: "Task not found" },
    });
  });

  it.each(["CancelTask", "tasks/cancel"])(
    "cancels a working task with %s and aborts the run serving it",
    async (method) => {
      const harness = await startHttpHarness({ onDispatch: async () => {} });
      const createdResponse = await harness.post(sendRequest({ returnImmediately: true }));
      const created = (await createdResponse.json()) as { result: { task: { id: string } } };
      const signal = harness.taskStore.abortSignal(created.result.task.id);

      const response = await harness.post({
        jsonrpc: "2.0",
        id: "cancel",
        method,
        params: { id: created.result.task.id },
      });

      await expect(response.json()).resolves.toMatchObject({
        id: "cancel",
        result: { id: created.result.task.id, status: { state: "TASK_STATE_CANCELED" } },
      });
      expect(signal?.aborted).toBe(true);
      const again = await harness.post({
        jsonrpc: "2.0",
        id: "again",
        method,
        params: { id: created.result.task.id },
      });
      await expect(again.json()).resolves.toMatchObject({ error: { code: -32002 } });
    },
  );

  it("refuses to cancel another peer's task", async () => {
    const harness = await startHttpHarness({ onDispatch: async () => {} });
    const createdResponse = await harness.post(sendRequest({ returnImmediately: true }));
    const created = (await createdResponse.json()) as { result: { task: { id: string } } };

    const response = await harness.post(
      { jsonrpc: "2.0", id: "cancel", method: "CancelTask", params: { id: created.result.task.id } },
      "beta-secret",
    );

    await expect(response.json()).resolves.toMatchObject({ error: { code: -32001 } });
    expect(harness.taskStore.get(created.result.task.id)?.status.state).toBe("TASK_STATE_WORKING");
  });

  it("transitions the task to FAILED when inbound dispatch throws", async () => {
    const harness = await startHttpHarness({
      onDispatch: async () => {
        throw new Error("dispatch unavailable");
      },
    });
    const response = await harness.post(sendRequest());

    await expect(response.json()).resolves.toMatchObject({
      result: {
        task: {
          status: {
            state: "TASK_STATE_FAILED",
            message: { parts: [{ text: "dispatch unavailable" }] },
          },
        },
      },
    });
  });
});

function parseSseEvents(body: string): Array<{ id: unknown; result?: Record<string, unknown> }> {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as { id: unknown });
}

async function postOverHttp(baseUrl: string, body: unknown, token = "alpha-secret") {
  return await fetch(`${baseUrl}/a2a/v1`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

async function readStreamText(response: Response): Promise<string> {
  return await response.text();
}

describe("A2A streaming over server-sent events", () => {
  it.each(["SendStreamingMessage", "message/stream"])(
    "streams %s as task, partial artifact chunks, the final artifact and the terminal status",
    async (method) => {
      const harness = await startHttpHarness({
        onDispatch: async (message) => {
          harness.taskStore.publishPartial(message.taskId, "echo", true);
          harness.taskStore.publishPartial(message.taskId, ": hi", true);
          harness.taskStore.completeNext(message.contextId, "echo: hi", message.peerName);
        },
      });
      await withServer(
        (req, res) => {
          void harness.handler(req, res);
        },
        async (baseUrl) => {
          const response = await postOverHttp(
            baseUrl,
            sendRequest({ method, id: "stream-1", text: "hi" }),
          );
          expect(response.headers.get("content-type")).toContain("text/event-stream");
          const events = parseSseEvents(await readStreamText(response));

          expect(events.every((event) => event.id === "stream-1")).toBe(true);
          expect(events.map((event) => Object.keys(event.result ?? {})[0])).toEqual([
            "task",
            "artifactUpdate",
            "artifactUpdate",
            "artifactUpdate",
            "statusUpdate",
          ]);
          expect(events[0]?.result).toMatchObject({
            task: { status: { state: "TASK_STATE_WORKING" } },
          });
          expect(events[1]?.result).toMatchObject({
            artifactUpdate: {
              artifact: { parts: [{ text: "echo" }] },
              append: true,
              lastChunk: false,
            },
          });
          expect(events[3]?.result).toMatchObject({
            artifactUpdate: {
              artifact: { parts: [{ text: "echo: hi" }] },
              append: false,
              lastChunk: true,
            },
          });
          const artifactIds = new Set(
            events
              .slice(1, 4)
              .map(
                (event) =>
                  (event.result?.artifactUpdate as { artifact: { artifactId: string } }).artifact
                    .artifactId,
              ),
          );
          expect(artifactIds.size).toBe(1);
          expect(events[4]?.result).toMatchObject({
            statusUpdate: { status: { state: "TASK_STATE_COMPLETED" } },
          });
        },
      );
    },
  );

  it("resubscribes to a live task and ends the stream when the task is canceled", async () => {
    const harness = await startHttpHarness({ onDispatch: async () => {} });
    const created = (await (await harness.post(sendRequest({ returnImmediately: true }))).json()) as {
      result: { task: { id: string } };
    };
    const taskId = created.result.task.id;
    await withServer(
      (req, res) => {
        void harness.handler(req, res);
      },
      async (baseUrl) => {
        const response = await postOverHttp(baseUrl, {
          jsonrpc: "2.0",
          id: "sub",
          method: "tasks/resubscribe",
          params: { id: taskId },
        });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        const first = decoder.decode((await reader.read()).value);
        expect(parseSseEvents(first)[0]?.result).toMatchObject({ task: { id: taskId } });

        const cancel = await postOverHttp(baseUrl, {
          jsonrpc: "2.0",
          id: "cancel",
          method: "CancelTask",
          params: { id: taskId },
        });
        await expect(cancel.json()).resolves.toMatchObject({
          result: { status: { state: "TASK_STATE_CANCELED" } },
        });
        let rest = "";
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          rest += decoder.decode(chunk.value);
        }
        expect(parseSseEvents(rest).at(-1)?.result).toMatchObject({
          statusUpdate: { taskId, status: { state: "TASK_STATE_CANCELED" } },
        });
      },
    );
  });

  it("refuses to subscribe to a finished task or another peer's task", async () => {
    const harness = await startHttpHarness();
    const done = (await (await harness.post(sendRequest())).json()) as {
      result: { task: { id: string } };
    };
    const subscribe = {
      jsonrpc: "2.0",
      id: "sub",
      method: "SubscribeToTask",
      params: { id: done.result.task.id },
    };

    await expect((await harness.post(subscribe)).json()).resolves.toMatchObject({
      id: "sub",
      error: { code: -32004 },
    });
    await expect((await harness.post(subscribe, "beta-secret")).json()).resolves.toMatchObject({
      error: { code: -32001 },
    });
  });

  it("refuses streaming methods inside a JSON-RPC batch", async () => {
    const harness = await startHttpHarness();
    const response = await harness.post([
      sendRequest({ id: "streamed", method: "SendStreamingMessage" }),
      sendRequest({ id: "plain" }),
    ]);

    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ id: "streamed", error: expect.objectContaining({ code: -32004 }) }),
      expect.objectContaining({ id: "plain", result: expect.anything() }),
    ]);
  });
});

describe("A2A task listing and push notification configs", () => {
  it("lists only the caller's tasks with filters, paging and artifacts on request", async () => {
    const harness = await startHttpHarness();
    for (const contextId of ["ctx-a", "ctx-a", "ctx-b"]) {
      await harness.post(sendRequest({ contextId }));
    }
    await harness.post(sendRequest({ contextId: "ctx-a" }), "beta-secret");

    const firstPage = await harness.post({
      jsonrpc: "2.0",
      id: "list",
      method: "ListTasks",
      params: { contextId: "ctx-a", pageSize: 1 },
    });
    const first = (await firstPage.json()) as {
      result: {
        tasks: Array<{ contextId: string; artifacts: unknown[] }>;
        nextPageToken: string;
        totalSize: number;
        pageSize: number;
      };
    };
    expect(first.result).toMatchObject({ totalSize: 2, pageSize: 1 });
    expect(first.result.tasks).toHaveLength(1);
    expect(first.result.tasks[0]?.artifacts).toEqual([]);
    expect(first.result.nextPageToken).not.toBe("");

    const secondPage = await harness.post({
      jsonrpc: "2.0",
      id: "list-2",
      method: "tasks/list",
      params: {
        contextId: "ctx-a",
        pageSize: 1,
        pageToken: first.result.nextPageToken,
        includeArtifacts: true,
      },
    });
    await expect(secondPage.json()).resolves.toMatchObject({
      result: {
        tasks: [{ contextId: "ctx-a", artifacts: [{ parts: [{ text: "echo: hello" }] }] }],
        nextPageToken: "",
      },
    });

    const all = (await (
      await harness.post({ jsonrpc: "2.0", id: "all", method: "ListTasks" })
    ).json()) as { result: { totalSize: number } };
    expect(all.result.totalSize).toBe(3);
    const invalid = await harness.post({
      jsonrpc: "2.0",
      id: "bad",
      method: "ListTasks",
      params: { pageSize: 101 },
    });
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: -32602 } });
  });

  it("creates, reads, lists and deletes push configs in the 1.0 and 0.3 shapes", async () => {
    const harness = await startHttpHarness({ onDispatch: async () => {} });
    const created = (await (await harness.post(sendRequest({ returnImmediately: true }))).json()) as {
      result: { task: { id: string } };
    };
    const taskId = created.result.task.id;

    const set = await harness.post({
      jsonrpc: "2.0",
      id: "set",
      method: "CreateTaskPushNotificationConfig",
      params: { taskId, id: "hook-1", url: "https://hooks.example.test/a2a", token: "tok" },
    });
    await expect(set.json()).resolves.toMatchObject({
      result: { id: "hook-1", taskId, url: "https://hooks.example.test/a2a", token: "tok" },
    });
    const legacy = await harness.post({
      jsonrpc: "2.0",
      id: "legacy",
      method: "tasks/pushNotificationConfig/set",
      params: {
        taskId,
        pushNotificationConfig: {
          id: "hook-2",
          url: "https://hooks.example.test/legacy",
          authentication: { schemes: ["Bearer"], credentials: "secret" },
        },
      },
    });
    await expect(legacy.json()).resolves.toMatchObject({
      result: { id: "hook-2", authentication: { scheme: "Bearer", credentials: "secret" } },
    });

    const listed = await harness.post({
      jsonrpc: "2.0",
      id: "list",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId },
    });
    const listedBody = (await listed.json()) as {
      result: { configs: Array<{ id: string }>; nextPageToken: string };
    };
    expect(listedBody.result.configs.map((config) => config.id).toSorted()).toEqual([
      "hook-1",
      "hook-2",
    ]);
    expect(listedBody.result.nextPageToken).toBe("");

    const otherPeer = await harness.post(
      {
        jsonrpc: "2.0",
        id: "get",
        method: "GetTaskPushNotificationConfig",
        params: { taskId, id: "hook-1" },
      },
      "beta-secret",
    );
    await expect(otherPeer.json()).resolves.toMatchObject({ error: { code: -32001 } });

    const deleted = await harness.post({
      jsonrpc: "2.0",
      id: "delete",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId, id: "hook-1" },
    });
    await expect(deleted.json()).resolves.toMatchObject({ result: {} });
    const gone = await harness.post({
      jsonrpc: "2.0",
      id: "get",
      method: "tasks/pushNotificationConfig/get",
      params: { taskId, id: "hook-1" },
    });
    await expect(gone.json()).resolves.toMatchObject({ error: { code: -32001 } });
  });

  it("accepts an inline push config on SendMessage and rejects one without a URL", async () => {
    const harness = await startHttpHarness({ onDispatch: async () => {} });
    const request = sendRequest({ returnImmediately: true });
    const withPush = {
      ...request,
      params: {
        ...request.params,
        configuration: {
          returnImmediately: true,
          taskPushNotificationConfig: { url: "https://hooks.example.test/inline" },
        },
      },
    };
    const created = (await (await harness.post(withPush)).json()) as {
      result: { task: { id: string } };
    };
    expect(harness.taskStore.listPushConfigs(created.result.task.id, "alpha")).toEqual([
      expect.objectContaining({ url: "https://hooks.example.test/inline" }),
    ]);

    const invalid = await harness.post({
      ...withPush,
      params: { ...withPush.params, configuration: { taskPushNotificationConfig: { token: "x" } } },
    });
    await expect(invalid.json()).resolves.toMatchObject({ error: { code: -32602 } });
  });
});
