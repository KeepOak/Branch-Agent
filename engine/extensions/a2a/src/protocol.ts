import { truncateUtf8Prefix } from "branch/plugin-sdk/text-utility-runtime";
import { z } from "zod";

const A2A_CONTEXT_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const A2A_MESSAGE_MAX_BYTES = 64 * 1024;
const A2A_TRUNCATION_MARKER = `\n[message truncated at ${A2A_MESSAGE_MAX_BYTES} bytes]`;

type A2aPartMetadata = { metadata?: Record<string, unknown> };

export type A2aMessagePart = A2aPartMetadata &
  ({ text: string } | { data: unknown } | { url: string } | { raw: string });

export type A2aMessageRecord = {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: "ROLE_USER" | "ROLE_AGENT";
  parts: A2aMessagePart[];
  metadata?: Record<string, unknown>;
};

export type A2aTaskStatus =
  | { state: "TASK_STATE_SUBMITTED" | "TASK_STATE_WORKING"; timestamp: string }
  | {
      state:
        | "TASK_STATE_COMPLETED"
        | "TASK_STATE_FAILED"
        | "TASK_STATE_CANCELED"
        | "TASK_STATE_REJECTED";
      timestamp: string;
      message?: A2aMessageRecord;
    };

export type A2aTaskArtifact = {
  artifactId: string;
  name?: string;
  parts: A2aMessagePart[];
};

export type A2aTaskRecord = {
  id: string;
  contextId: string;
  status: A2aTaskStatus;
  artifacts: A2aTaskArtifact[];
  history: A2aMessageRecord[];
};

export const A2aRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number().finite(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const A2aMetadataSchema = z.record(z.string(), z.unknown());
const A2aInboundPartSchema = z.object({
  text: z.string().optional(),
  data: z.unknown().optional(),
});

export const A2aSendMessageParamsSchema = z.object({
  message: z.object({
    messageId: z.string().min(1).optional(),
    contextId: z.string().regex(A2A_CONTEXT_PATTERN).optional(),
    taskId: z.string().min(1).optional(),
    role: z.enum(["ROLE_USER", "ROLE_AGENT", "user", "agent"]),
    parts: z.array(z.unknown()),
    metadata: A2aMetadataSchema.optional(),
  }),
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().int().nonnegative().optional(),
      returnImmediately: z.boolean().optional(),
      // 1.0 `taskPushNotificationConfig`; 0.3 peers send `pushNotificationConfig`.
      taskPushNotificationConfig: z.unknown().optional(),
      pushNotificationConfig: z.unknown().optional(),
    })
    .optional(),
  tenant: z.string().optional(),
  metadata: A2aMetadataSchema.optional(),
});

export const A2aTaskRequestParamsSchema = z.object({
  id: z.string().min(1),
  historyLength: z.number().int().nonnegative().optional(),
  tenant: z.string().optional(),
  metadata: A2aMetadataSchema.optional(),
});

export const A2A_TASK_STATES = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;

// A2A 1.0 ListTasksRequest: "If unspecified, at most 50 tasks will be returned.
// The minimum value is 1. The maximum value is 100."
export const A2A_LIST_TASKS_DEFAULT_PAGE_SIZE = 50;
export const A2A_LIST_TASKS_MAX_PAGE_SIZE = 100;

export const A2aListTasksParamsSchema = z.object({
  tenant: z.string().optional(),
  contextId: z.string().optional(),
  status: z.enum(A2A_TASK_STATES).optional(),
  pageSize: z.number().int().min(1).max(A2A_LIST_TASKS_MAX_PAGE_SIZE).optional(),
  pageToken: z.string().optional(),
  historyLength: z.number().int().nonnegative().optional(),
  statusTimestampAfter: z.string().datetime({ offset: true }).optional(),
  includeArtifacts: z.boolean().optional(),
});

const A2aPushAuthenticationSchema = z.object({
  scheme: z.string().min(1),
  credentials: z.string().optional(),
});

const A2aHttpsOrHttpUrlSchema = z
  .string()
  .url()
  .and(z.string().regex(/^https?:\/\//, "A2A push URLs must use HTTP or HTTPS"));

/** A2A 1.0 TaskPushNotificationConfig (flattened) with the 0.3 nested form accepted. */
export const A2aPushNotificationConfigSchema = z.preprocess(
  (input) => {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return input;
    }
    const record = input as Record<string, unknown>;
    const nested = record.pushNotificationConfig;
    if (nested === null || typeof nested !== "object" || Array.isArray(nested)) {
      return input;
    }
    // 0.3 `tasks/pushNotificationConfig/set` nests the config and uses
    // `authentication.schemes[]`; fold it into the 1.0 flattened shape.
    const { pushNotificationConfig: _nested, ...rest } = record;
    const config = nested as Record<string, unknown>;
    const authentication = config.authentication as Record<string, unknown> | undefined;
    const schemes = Array.isArray(authentication?.schemes) ? authentication.schemes : undefined;
    return {
      ...rest,
      ...config,
      ...(authentication
        ? {
            authentication: {
              scheme: typeof schemes?.[0] === "string" ? schemes[0] : authentication.scheme,
              credentials: authentication.credentials,
            },
          }
        : {}),
    };
  },
  z.object({
    tenant: z.string().optional(),
    id: z.string().min(1).max(128).optional(),
    taskId: z.string().min(1).optional(),
    url: A2aHttpsOrHttpUrlSchema,
    token: z.string().optional(),
    authentication: A2aPushAuthenticationSchema.optional(),
  }),
);

export type A2aPushNotificationConfig = {
  id: string;
  taskId: string;
  url: string;
  token?: string;
  authentication?: { scheme: string; credentials?: string };
};

export const A2aPushConfigRequestParamsSchema = z.object({
  tenant: z.string().optional(),
  taskId: z.string().min(1),
  id: z.string().min(1),
});

export const A2aListPushConfigsParamsSchema = z.object({
  tenant: z.string().optional(),
  taskId: z.string().min(1),
  pageSize: z.number().int().min(0).optional(),
  pageToken: z.string().optional(),
});

export type A2aCanonicalMethod =
  | "SendMessage"
  | "SendStreamingMessage"
  | "GetTask"
  | "ListTasks"
  | "CancelTask"
  | "SubscribeToTask"
  | "CreateTaskPushNotificationConfig"
  | "GetTaskPushNotificationConfig"
  | "ListTaskPushNotificationConfigs"
  | "DeleteTaskPushNotificationConfig";

// A2A 1.0 method names plus the dotted names older peers still send: 0.3
// (`message/send`, `message/stream`, `tasks/*`, `tasks/pushNotificationConfig/*`)
// and 0.2 (`tasks/send`, `tasks/sendSubscribe`).
const A2A_METHOD_ALIASES: Readonly<Record<string, A2aCanonicalMethod>> = {
  SendMessage: "SendMessage",
  SendStreamingMessage: "SendStreamingMessage",
  GetTask: "GetTask",
  ListTasks: "ListTasks",
  CancelTask: "CancelTask",
  SubscribeToTask: "SubscribeToTask",
  CreateTaskPushNotificationConfig: "CreateTaskPushNotificationConfig",
  SetTaskPushNotificationConfig: "CreateTaskPushNotificationConfig",
  GetTaskPushNotificationConfig: "GetTaskPushNotificationConfig",
  ListTaskPushNotificationConfig: "ListTaskPushNotificationConfigs",
  ListTaskPushNotificationConfigs: "ListTaskPushNotificationConfigs",
  DeleteTaskPushNotificationConfig: "DeleteTaskPushNotificationConfig",
  "message/send": "SendMessage",
  "message/stream": "SendStreamingMessage",
  "tasks/send": "SendMessage",
  "tasks/sendSubscribe": "SendStreamingMessage",
  "tasks/get": "GetTask",
  "tasks/list": "ListTasks",
  "tasks/cancel": "CancelTask",
  "tasks/resubscribe": "SubscribeToTask",
  "tasks/pushNotificationConfig/set": "CreateTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/get": "GetTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/list": "ListTaskPushNotificationConfigs",
  "tasks/pushNotificationConfig/delete": "DeleteTaskPushNotificationConfig",
};

// The extended card is not offered (`capabilities.extendedAgentCard` is unset).
const A2A_UNSUPPORTED_METHODS = new Set(["GetExtendedAgentCard", "agent/getAuthenticatedExtendedCard"]);

export const A2A_STREAMING_METHODS: ReadonlySet<A2aCanonicalMethod> = new Set([
  "SendStreamingMessage",
  "SubscribeToTask",
]);

export function resolveA2aRpcMethod(
  method: string,
): A2aCanonicalMethod | "unsupported" | undefined {
  if (Object.hasOwn(A2A_METHOD_ALIASES, method)) {
    return A2A_METHOD_ALIASES[method];
  }
  return A2A_UNSUPPORTED_METHODS.has(method) ? "unsupported" : undefined;
}

// A2A JSON-RPC error codes (spec section 9.5 mapping).
export const A2A_ERROR_TASK_NOT_FOUND = -32001;
export const A2A_ERROR_TASK_NOT_CANCELABLE = -32002;
export const A2A_ERROR_UNSUPPORTED_OPERATION = -32004;

export function isTerminalA2aTaskState(state: string): boolean {
  return (
    state === "TASK_STATE_COMPLETED" ||
    state === "TASK_STATE_FAILED" ||
    state === "TASK_STATE_CANCELED" ||
    state === "TASK_STATE_REJECTED"
  );
}

export function extractA2aMessageText(parts: unknown[]): string | undefined {
  const textParts: string[] = [];
  for (const candidate of parts) {
    const parsed = A2aInboundPartSchema.safeParse(candidate);
    if (!parsed.success) {
      continue;
    }
    if (typeof parsed.data.text === "string") {
      textParts.push(parsed.data.text);
    } else if (Object.hasOwn(parsed.data, "data") && parsed.data.data !== undefined) {
      textParts.push(JSON.stringify(parsed.data.data));
    }
  }

  const text = textParts.join("\n");
  if (!text.trim()) {
    return undefined;
  }
  if (Buffer.byteLength(text) <= A2A_MESSAGE_MAX_BYTES) {
    return text;
  }

  const prefixBytes = A2A_MESSAGE_MAX_BYTES - Buffer.byteLength(A2A_TRUNCATION_MARKER);
  // Preserve TextDecoder's leading-BOM removal for truncated messages.
  return truncateUtf8Prefix(text, prefixBytes).replace(/^\uFEFF/, "") + A2A_TRUNCATION_MARKER;
}

export class A2aProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "A2aProtocolError";
  }
}
