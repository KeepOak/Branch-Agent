import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { listAgentIds, resolveAgentConfig } from "branch/plugin-sdk/agent-scope-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";
import { boundedJsonUtf8Bytes } from "branch/plugin-sdk/text-utility-runtime";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
} from "branch/plugin-sdk/webhook-ingress";
import {
  runDetachedWebhookWork,
  sendHttpRequestRejection,
} from "branch/plugin-sdk/webhook-request-guards";
import {
  A2A_ERROR_TASK_NOT_CANCELABLE,
  A2A_ERROR_TASK_NOT_FOUND,
  A2A_ERROR_UNSUPPORTED_OPERATION,
  A2A_STREAMING_METHODS,
  A2aListPushConfigsParamsSchema,
  A2aListTasksParamsSchema,
  A2aProtocolError,
  A2aPushConfigRequestParamsSchema,
  A2aPushNotificationConfigSchema,
  A2aRpcRequestSchema,
  A2aSendMessageParamsSchema,
  A2aTaskRequestParamsSchema,
  extractA2aMessageText,
  isTerminalA2aTaskState,
  resolveA2aRpcMethod,
  type A2aCanonicalMethod,
  type A2aTaskRecord,
} from "./protocol.js";
import type { A2aStreamEvent, A2aTaskStore } from "./task-store.js";
import type { A2aChannelConfig } from "./types.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
// This cap stays enforced when an operator disables the per-peer rate limit.
const MAX_BATCH_REQUESTS = 30;
const DEFAULT_REPLY_TIMEOUT_MS = 120_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

type A2aRpcIdentifier = string | number | null;

type A2aRpcResponse =
  | { jsonrpc: "2.0"; id: A2aRpcIdentifier; result: unknown }
  | { jsonrpc: "2.0"; id: A2aRpcIdentifier; error: { code: number; message: string } };

type A2aInboundDispatch = {
  taskId: string;
  contextId: string;
  messageId: string;
  peerName: string;
  text: string;
};

type A2aHttpHandlerParams = {
  config: BranchConfig;
  a2aConfig: A2aChannelConfig;
  version: string;
  taskStore: A2aTaskStore;
  dispatchInbound: (message: A2aInboundDispatch) => Promise<void>;
};

type A2aParsedRpcRequest = {
  id: A2aRpcIdentifier;
  notification: boolean;
  method: string;
  params: unknown;
};

function writeJsonResponse(response: ServerResponse, statusCode: number, value: unknown): void {
  writeJsonBody(response, statusCode, JSON.stringify(value));
}

function writeJsonBody(response: ServerResponse, statusCode: number, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

function createRpcError(id: A2aRpcIdentifier, code: number, message: string): A2aRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function writeRpcResponse(
  response: ServerResponse,
  value: A2aRpcResponse | A2aRpcResponse[],
): void {
  const measured = boundedJsonUtf8Bytes(value, MAX_RESPONSE_BODY_BYTES);
  if (measured.complete) {
    writeJsonBody(response, 200, JSON.stringify(value));
    return;
  }
  const errorMessage = "A2A response exceeds the 1 MiB limit";
  const bounded = Array.isArray(value)
    ? value.map((entry) => createRpcError(entry.id, -32000, errorMessage))
    : createRpcError(value.id, -32000, errorMessage);
  // Request IDs can consume nearly the entire inbound budget. Drop correlation
  // only when an already-oversized response's replacement still cannot fit.
  const fallback = boundedJsonUtf8Bytes(bounded, MAX_RESPONSE_BODY_BYTES).complete
    ? bounded
    : Array.isArray(bounded)
      ? bounded.map(() => createRpcError(null, -32000, errorMessage))
      : createRpcError(null, -32000, errorMessage);
  writeJsonResponse(response, 200, fallback);
}

/** One server-sent event per JSON-RPC response, each bounded like a whole response. */
function writeSseEvent(response: ServerResponse, id: A2aRpcIdentifier, event: unknown): void {
  const payload: A2aRpcResponse = { jsonrpc: "2.0", id, result: event };
  const value = boundedJsonUtf8Bytes(payload, MAX_RESPONSE_BODY_BYTES).complete
    ? payload
    : createRpcError(id, -32000, "A2A stream event exceeds the 1 MiB limit");
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function resolvePeerName(request: IncomingMessage, config: A2aChannelConfig): string | undefined {
  const authorization = request.headers.authorization;
  const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token) {
    return undefined;
  }
  const presentedDigest = createHash("sha256").update(token).digest();
  for (const [peerName, peer] of Object.entries(config.peers ?? {})) {
    const configuredDigest = createHash("sha256").update(peer.token).digest();
    if (timingSafeEqual(presentedDigest, configuredDigest)) {
      return peerName;
    }
  }
  return undefined;
}

function resolveRequestOrigin(request: IncomingMessage): string {
  const encrypted = "encrypted" in request.socket && request.socket.encrypted;
  try {
    return new URL(`${encrypted ? "https" : "http"}://${request.headers.host ?? "localhost"}`)
      .origin;
  } catch {
    return `${encrypted ? "https" : "http"}://localhost`;
  }
}

function createAgentCard(params: A2aHttpHandlerParams, request: IncomingMessage) {
  // listAgentIds reads both the canonical `agents.entries` roster and the legacy
  // `agents.list` projection; reading either shape directly publishes a
  // skill-less card to every peer whose operator configured the other one.
  const exposed = params.a2aConfig.exposeAgents;
  const agentIds = listAgentIds(params.config).filter(
    (agentId) => !exposed?.length || exposed.includes(agentId),
  );
  const instanceName =
    (agentIds[0] ? resolveAgentConfig(params.config, agentIds[0])?.name?.trim() : undefined) ||
    "Branch Agent";
  const advertisedOrigin = params.a2aConfig.advertisedUrl ?? resolveRequestOrigin(request);
  return {
    name: instanceName,
    description: "Branch Agent agent gateway using the Agent2Agent protocol.",
    supportedInterfaces: [
      {
        url: `${advertisedOrigin.replace(/\/+$/, "")}/a2a/v1`,
        protocolBinding: "JSONRPC",
        protocolVersion: "1.0",
      },
    ],
    version: params.version,
    capabilities: {
      streaming: true,
      pushNotifications: true,
    },
    // Peers authenticate with the per-peer bearer token from channels.a2a.peers.
    securitySchemes: {
      bearerAuth: { httpAuthSecurityScheme: { scheme: "Bearer" } },
    },
    securityRequirements: [{ schemes: { bearerAuth: { list: [] } } }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    // AgentSkill.description is spec-required. Operator-authored agent
    // descriptions are deliberately not published here: the card is served
    // unauthenticated, so only the agent id crosses the discovery boundary.
    skills: agentIds.map((agentId) => ({
      id: agentId,
      name: agentId,
      description: `Branch Agent agent ${agentId}.`,
      tags: ["branch"],
    })),
  };
}

function parseRpcRequest(input: unknown): A2aParsedRpcRequest | { invalidId: A2aRpcIdentifier } {
  const parsed = A2aRpcRequestSchema.safeParse(input);
  const candidateId = isRecord(input) ? input.id : undefined;
  const id =
    typeof candidateId === "string" || typeof candidateId === "number" ? candidateId : null;
  if (!parsed.success) {
    return { invalidId: id };
  }
  return {
    id,
    notification: !Object.hasOwn(parsed.data, "id"),
    method: parsed.data.method,
    params: parsed.data.params,
  };
}

function resolveCanonicalMethod(method: string): A2aCanonicalMethod {
  const resolved = resolveA2aRpcMethod(method);
  if (resolved === undefined) {
    throw new A2aProtocolError(-32601, `Method not found: ${method}`);
  }
  if (resolved === "unsupported") {
    throw new A2aProtocolError(A2A_ERROR_UNSUPPORTED_OPERATION, `Unsupported operation: ${method}`);
  }
  return resolved;
}

function parseTaskParams(input: unknown) {
  const taskParams = A2aTaskRequestParamsSchema.safeParse(input);
  if (!taskParams.success) {
    throw new A2aProtocolError(-32602, "Invalid task params: id is required");
  }
  return taskParams.data;
}

function taskNotFound(): A2aProtocolError {
  return new A2aProtocolError(A2A_ERROR_TASK_NOT_FOUND, "Task not found");
}

export function createA2aHttpHandler(params: A2aHttpHandlerParams) {
  const peerRequestTimes = new Map<string, number[]>();
  const store = params.taskStore;

  function isRateLimited(peerName: string): boolean {
    const maximum = params.a2aConfig.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE;
    if (maximum === 0) {
      return false;
    }
    const now = Date.now();
    const requests = (peerRequestTimes.get(peerName) ?? []).filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
    );
    if (requests.length >= maximum) {
      peerRequestTimes.set(peerName, requests);
      return true;
    }
    requests.push(now);
    peerRequestTimes.set(peerName, requests);
    return false;
  }

  /** Validates a send, creates its task and starts the agent turn in the background. */
  function admitMessage(
    input: unknown,
    peerName: string,
  ): { task: A2aTaskRecord; returnImmediately: boolean } {
    const send = A2aSendMessageParamsSchema.safeParse(input);
    if (!send.success) {
      throw new A2aProtocolError(-32602, "Invalid SendMessage params: message and parts required");
    }
    const message = send.data.message;
    const text = extractA2aMessageText(message.parts);
    if (!text) {
      throw new A2aProtocolError(-32602, "Message must contain at least one usable text part");
    }
    const inlinePush =
      send.data.configuration?.taskPushNotificationConfig ??
      send.data.configuration?.pushNotificationConfig;
    const push =
      inlinePush === undefined ? undefined : A2aPushNotificationConfigSchema.safeParse(inlinePush);
    if (push && !push.success) {
      throw new A2aProtocolError(-32602, "Invalid push notification config: url is required");
    }
    const contextId = message.contextId ?? `ctx-${randomUUID()}`;
    const task = store.create(contextId, peerName);
    if (push?.success) {
      store.setPushConfig(task.id, peerName, push.data);
    }
    store.start(task.id);
    // Reserved synchronously while this request is still admitted: a
    // returnImmediately dispatch outlives the response, and an inherited
    // released root makes the agent turn fail as gateway-draining.
    void runDetachedWebhookWork(async () => {
      await params.dispatchInbound({
        taskId: task.id,
        contextId,
        messageId: message.messageId ?? randomUUID(),
        peerName,
        text,
      });
    }).catch((error: unknown) => store.fail(task.id, error));
    return { task, returnImmediately: send.data.configuration?.returnImmediately === true };
  }

  async function sendMessage(input: unknown, peerName: string, returnImmediately?: boolean) {
    const admitted = admitMessage(input, peerName);
    const task = admitted.task;
    if (returnImmediately || admitted.returnImmediately) {
      return { task: store.get(task.id, peerName) ?? task };
    }
    const timeoutMs = params.a2aConfig.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS;
    const settled = await store.wait(task.id, timeoutMs);
    return { task: settled ?? store.get(task.id, peerName) ?? task };
  }

  function listTasks(input: unknown, peerName: string) {
    const listParams = A2aListTasksParamsSchema.safeParse(input ?? {});
    if (!listParams.success) {
      throw new A2aProtocolError(-32602, "Invalid ListTasks params");
    }
    return store.list(peerName, listParams.data);
  }

  function cancelTask(input: unknown, peerName: string) {
    const result = store.cancel(parseTaskParams(input).id, peerName);
    if ("error" in result) {
      throw result.error === "not-found"
        ? taskNotFound()
        : new A2aProtocolError(A2A_ERROR_TASK_NOT_CANCELABLE, "Task cannot be canceled");
    }
    return result.task;
  }

  function createPushConfig(input: unknown, peerName: string) {
    const config = A2aPushNotificationConfigSchema.safeParse(input);
    if (!config.success || !config.data.taskId) {
      throw new A2aProtocolError(-32602, "Invalid push notification config: taskId and url required");
    }
    const stored = store.setPushConfig(config.data.taskId, peerName, config.data);
    if (!stored) {
      throw taskNotFound();
    }
    return stored;
  }

  function getPushConfig(input: unknown, peerName: string) {
    const request = A2aPushConfigRequestParamsSchema.safeParse(input);
    if (!request.success) {
      throw new A2aProtocolError(-32602, "Invalid push notification config params: taskId and id required");
    }
    const config = store.getPushConfig(request.data.taskId, peerName, request.data.id);
    if (!config) {
      throw new A2aProtocolError(A2A_ERROR_TASK_NOT_FOUND, "Push notification config not found");
    }
    return config;
  }

  function listPushConfigs(input: unknown, peerName: string) {
    const request = A2aListPushConfigsParamsSchema.safeParse(input);
    if (!request.success) {
      throw new A2aProtocolError(-32602, "Invalid push notification config params: taskId required");
    }
    const configs = store.listPushConfigs(request.data.taskId, peerName);
    if (!configs) {
      throw taskNotFound();
    }
    return { configs, nextPageToken: "" };
  }

  function deletePushConfig(input: unknown, peerName: string) {
    const request = A2aPushConfigRequestParamsSchema.safeParse(input);
    if (!request.success) {
      throw new A2aProtocolError(-32602, "Invalid push notification config params: taskId and id required");
    }
    if (!store.deletePushConfig(request.data.taskId, peerName, request.data.id)) {
      throw new A2aProtocolError(A2A_ERROR_TASK_NOT_FOUND, "Push notification config not found");
    }
    return {};
  }

  async function runMethod(
    method: A2aCanonicalMethod,
    input: unknown,
    peerName: string,
  ): Promise<unknown> {
    switch (method) {
      case "SendMessage":
        return await sendMessage(input, peerName);
      case "SendStreamingMessage":
        // Only reachable for notifications, which cannot carry a stream.
        return await sendMessage(input, peerName, true);
      case "GetTask": {
        const task = store.get(parseTaskParams(input).id, peerName);
        if (!task) {
          throw taskNotFound();
        }
        return task;
      }
      case "ListTasks":
        return listTasks(input, peerName);
      case "CancelTask":
        return cancelTask(input, peerName);
      case "SubscribeToTask":
        throw new A2aProtocolError(
          A2A_ERROR_UNSUPPORTED_OPERATION,
          "SubscribeToTask requires a streaming request",
        );
      case "CreateTaskPushNotificationConfig":
        return createPushConfig(input, peerName);
      case "GetTaskPushNotificationConfig":
        return getPushConfig(input, peerName);
      case "ListTaskPushNotificationConfigs":
        return listPushConfigs(input, peerName);
      case "DeleteTaskPushNotificationConfig":
        return deletePushConfig(input, peerName);
    }
    throw new A2aProtocolError(-32601, "Method not found");
  }

  async function processRpcRequest(
    input: unknown,
    peerName: string,
    inBatch: boolean,
  ): Promise<A2aRpcResponse | undefined> {
    const request = parseRpcRequest(input);
    const notification = "invalidId" in request ? false : request.notification;
    const id = "invalidId" in request ? request.invalidId : request.id;

    if (isRateLimited(peerName)) {
      return notification ? undefined : createRpcError(id, -32000, "Peer is rate limited");
    }
    if ("invalidId" in request) {
      return createRpcError(id, -32600, "Invalid JSON-RPC request");
    }

    let result: unknown;
    try {
      const method = resolveCanonicalMethod(request.method);
      if (inBatch && A2A_STREAMING_METHODS.has(method)) {
        throw new A2aProtocolError(
          A2A_ERROR_UNSUPPORTED_OPERATION,
          "Streaming methods cannot be sent in a JSON-RPC batch",
        );
      }
      result = await runMethod(method, request.params, peerName);
    } catch (error) {
      if (notification) {
        return undefined;
      }
      if (error instanceof A2aProtocolError) {
        return createRpcError(id, error.code, error.message);
      }
      return createRpcError(id, -32000, "A2A request could not be processed");
    }

    return notification ? undefined : { jsonrpc: "2.0", id, result };
  }

  /** Opens an SSE stream on a live task: a task snapshot, then its updates until it ends. */
  function streamTask(
    response: ServerResponse,
    id: A2aRpcIdentifier,
    task: A2aTaskRecord,
  ): Promise<void> {
    return new Promise((resolve) => {
      let closed = false;
      const finish = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe?.();
        response.end();
        resolve();
      };
      const unsubscribe = store.subscribe(
        task.id,
        (event: A2aStreamEvent) => {
          if (!closed) {
            writeSseEvent(response, id, event);
          }
        },
        finish,
      );
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.setHeader("connection", "keep-alive");
      writeSseEvent(response, id, { task });
      if (!unsubscribe) {
        finish();
        return;
      }
      // A peer disconnect ends its stream; the task keeps running.
      response.once("close", finish);
    });
  }

  async function processStreamingRequest(
    response: ServerResponse,
    rpc: A2aParsedRpcRequest,
    method: A2aCanonicalMethod,
    peerName: string,
  ): Promise<void> {
    let task: A2aTaskRecord;
    try {
      if (method === "SubscribeToTask") {
        const found = store.get(parseTaskParams(rpc.params).id, peerName);
        if (!found) {
          throw taskNotFound();
        }
        if (isTerminalA2aTaskState(found.status.state)) {
          throw new A2aProtocolError(
            A2A_ERROR_UNSUPPORTED_OPERATION,
            "Task is in a terminal state and cannot be subscribed to",
          );
        }
        task = found;
      } else {
        task = admitMessage(rpc.params, peerName).task;
      }
    } catch (error) {
      writeRpcResponse(
        response,
        error instanceof A2aProtocolError
          ? createRpcError(rpc.id, error.code, error.message)
          : createRpcError(rpc.id, -32000, "A2A request could not be processed"),
      );
      return;
    }
    await streamTask(response, rpc.id, task);
  }

  /** Returns true when the single request was a stream this call already answered. */
  async function tryStreamingRequest(
    response: ServerResponse,
    payload: unknown,
    peerName: string,
  ): Promise<boolean> {
    const rpc = parseRpcRequest(payload);
    if ("invalidId" in rpc || rpc.notification) {
      return false;
    }
    const method = resolveA2aRpcMethod(rpc.method);
    if (method === undefined || method === "unsupported" || !A2A_STREAMING_METHODS.has(method)) {
      return false;
    }
    if (isRateLimited(peerName)) {
      writeRpcResponse(response, createRpcError(rpc.id, -32000, "Peer is rate limited"));
      return true;
    }
    await processStreamingRequest(response, rpc, method, peerName);
    return true;
  }

  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (
      request.method === "GET" &&
      (pathname === "/.well-known/agent-card.json" || pathname === "/.well-known/agent.json")
    ) {
      writeJsonResponse(response, 200, createAgentCard(params, request));
      return true;
    }

    if (request.method !== "POST" || pathname !== "/a2a/v1") {
      writeJsonResponse(response, 404, { error: "Not found" });
      return true;
    }

    const peerName = resolvePeerName(request, params.a2aConfig);
    if (!peerName) {
      writeJsonResponse(response, 401, {
        error: "Unauthorized; configure channels.a2a.peers with a matching Bearer token",
      });
      return true;
    }

    let body: string;
    try {
      body = await readRequestBodyWithLimit(request, {
        maxBytes: MAX_REQUEST_BODY_BYTES,
        // Defer destruction so the rejection below reaches the peer before the close.
        destroyOnLimit: false,
      });
    } catch (error) {
      const bodyRejection = isRequestBodyLimitError(error, "PAYLOAD_TOO_LARGE")
        ? { statusCode: 413, body: { error: "Request body exceeds the 1 MiB limit" } }
        : isRequestBodyLimitError(error, "REQUEST_BODY_TIMEOUT")
          ? {
              statusCode: 200,
              body: createRpcError(null, -32000, "Request body could not be read"),
            }
          : undefined;
      if (bodyRejection) {
        response.setHeader("cache-control", "no-store");
        await sendHttpRequestRejection(
          request,
          response,
          bodyRejection.statusCode,
          JSON.stringify(bodyRejection.body),
          "application/json; charset=utf-8",
        );
        return true;
      }
      writeJsonResponse(
        response,
        200,
        createRpcError(null, -32000, "Request body could not be read"),
      );
      return true;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      writeJsonResponse(response, 200, createRpcError(null, -32700, "Parse error"));
      return true;
    }

    let result: A2aRpcResponse | A2aRpcResponse[] | undefined;
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        writeJsonResponse(response, 200, createRpcError(null, -32600, "Invalid JSON-RPC request"));
        return true;
      }
      if (payload.length > MAX_BATCH_REQUESTS) {
        const error = isRateLimited(peerName)
          ? createRpcError(null, -32000, "Peer is rate limited")
          : createRpcError(
              null,
              -32000,
              `A2A batch exceeds the ${MAX_BATCH_REQUESTS} request limit`,
            );
        writeRpcResponse(response, error);
        return true;
      }
      const responses = (
        await Promise.all(payload.map((entry) => processRpcRequest(entry, peerName, true)))
      ).filter((entry): entry is A2aRpcResponse => entry !== undefined);
      result = responses.length > 0 ? responses : undefined;
    } else {
      if (await tryStreamingRequest(response, payload, peerName)) {
        return true;
      }
      result = await processRpcRequest(payload, peerName, false);
    }
    if (result) {
      writeRpcResponse(response, result);
    } else {
      response.statusCode = 200;
      response.end();
    }
    return true;
  };
}
