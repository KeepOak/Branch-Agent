// Memory capture and curation: agent memory write tools, working memory,
// task clipboard, implicit-referent resolution, temporal gap markers and link
// capture, all hung on memory-core's Markdown memory files and plugin state.
import { resolveSessionAgentIdStrict } from "branch/plugin-sdk/agent-scope-runtime";
import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import {
  jsonResult,
  resolveMemoryRingsPluginConfig,
  type BranchConfig,
} from "branch/plugin-sdk/memory-core-host-runtime-core";
import { ErrorCodes, errorShape, type GatewayRequestHandlerOptions } from "branch/plugin-sdk/gateway-runtime";
import type {
  AnyAgentTool,
  BranchPluginApi,
  BranchPluginToolContext,
  PluginCommandContext,
} from "branch/plugin-sdk/plugin-entry";
import { asNullableRecord } from "branch/plugin-sdk/string-coerce-runtime";
import type { MemoryCoreRuntimeHost } from "./memory/runtime-host.js";
import {
  buildReadOnlyWorkingMemoryInstruction,
  buildWorkingMemoryToolInstruction,
  DEFAULT_WORKING_MEMORY_TEMPLATE,
  describeWorkingMemoryTool,
  resolveWorkingMemoryUpdate,
} from "./working-memory.js";

const loadMemoryWrite = createLazyRuntimeModule(() => import("./memory-write.js"));
const loadTaskClipboard = createLazyRuntimeModule(() => import("./task-clipboard.js"));
const loadResolveReferent = createLazyRuntimeModule(() => import("./resolve-referent.js"));
const loadTemporalMarkers = createLazyRuntimeModule(() => import("./temporal-markers.js"));
const loadLinkCapture = createLazyRuntimeModule(() => import("./link-capture.js"));
const loadMemoryInbox = createLazyRuntimeModule(() => import("./memory-inbox.js"));

export const MEMORY_CAPTURE_TOOL_NAMES = [
  "memory_write",
  "update_working_memory",
  "task_clipboard",
  "resolve_referent",
] as const;

const WORKING_MEMORY_NAMESPACE = "working-memory";
const WORKING_MEMORY_MAX_ENTRIES = 50_000;

type WorkingMemoryEntry = { content: string; updatedAt: number };

export type WorkingMemorySettings = {
  enabled: boolean;
  scope: "agent" | "session";
  template: string;
  schema?: Record<string, unknown>;
  readOnly: boolean;
};

export type MemoryCaptureSettings = {
  workingMemory: WorkingMemorySettings;
  temporalMarkers: boolean;
  linkCapture: boolean;
  /** memory-review › requireApproval ships off: on, memory writes wait in the inbox. */
  requireApproval: boolean;
  excludedChannels: string[];
};

export function resolveMemoryCaptureSettings(
  pluginConfig: Record<string, unknown> | undefined,
): MemoryCaptureSettings {
  const working = asNullableRecord(pluginConfig?.workingMemory);
  const links = asNullableRecord(pluginConfig?.linkCapture);
  const review = asNullableRecord(pluginConfig?.memoryReview);
  const excluded = asNullableRecord(asNullableRecord(pluginConfig?.memoryPolicy)?.excludeSessions);
  const schema = asNullableRecord(working?.schema);
  return {
    workingMemory: {
      // mastra memoryDefaultOptions: workingMemory.enabled = false, scope = resource.
      enabled: working?.enabled === true,
      scope: working?.scope === "session" ? "session" : "agent",
      template: typeof working?.template === "string" ? working.template : DEFAULT_WORKING_MEMORY_TEMPLATE,
      ...(schema ? { schema } : {}),
      readOnly: working?.readOnly === true,
    },
    // mastra observationalMemory.temporalMarkers defaults to false.
    temporalMarkers: pluginConfig?.temporalMarkers === true,
    // eliza registers the link-extraction evaluator by default.
    linkCapture: links?.enabled !== false,
    requireApproval: review?.requireApproval === true,
    excludedChannels: Array.isArray(excluded?.channels)
      ? excluded.channels.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function currentConfig(api: BranchPluginApi): BranchConfig {
  return (api.runtime.config?.current?.() ?? api.config) as BranchConfig;
}

function currentPluginConfig(api: BranchPluginApi): Record<string, unknown> | undefined {
  return resolveMemoryRingsPluginConfig(currentConfig(api)) ?? api.pluginConfig;
}

function currentSettings(api: BranchPluginApi): MemoryCaptureSettings {
  return resolveMemoryCaptureSettings(currentPluginConfig(api));
}

function resolveAgentScope(api: BranchPluginApi, sessionKey?: string, agentId?: string) {
  const cfg = currentConfig(api);
  const resolvedAgentId = resolveSessionAgentIdStrict({ sessionKey, config: cfg, agentId });
  return {
    cfg,
    agentId: resolvedAgentId,
    workspaceDir: api.runtime.agent.resolveAgentWorkspaceDir(cfg, resolvedAgentId),
  };
}

function workingMemoryKey(settings: WorkingMemorySettings, agentId: string, sessionKey?: string) {
  if (settings.scope === "session") {
    return sessionKey ? `session:${agentId}:${sessionKey}` : undefined;
  }
  return `agent:${agentId}`;
}

function openWorkingMemoryStore(host: MemoryCoreRuntimeHost) {
  if (!host.openKeyedStore) {
    throw new Error("plugin state is unavailable for working memory");
  }
  return host.openKeyedStore<WorkingMemoryEntry>({
    namespace: WORKING_MEMORY_NAMESPACE,
    maxEntries: WORKING_MEMORY_MAX_ENTRIES,
  });
}

function readStringParam(params: unknown, key: string): string | undefined {
  const value = asNullableRecord(params)?.[key];
  return typeof value === "string" ? value : undefined;
}

function createMemoryWriteTool(api: BranchPluginApi, ctx: BranchPluginToolContext): AnyAgentTool | null {
  if (ctx.senderIsOwner !== true || ctx.sandboxed === true) {
    return null;
  }
  return {
    label: "Memory Write",
    name: "memory_write",
    description:
      "Add, update or remove one memory entry in MEMORY.md (default), USER.md or a Markdown file under memory/. " +
      "add stores a new entry (skipped when an equivalent entry already exists); update replaces the entry matching `match`; " +
      "remove deletes the entry matching `match` and needs a short `reason`. Remove an entry when it is incorrect, obsolete, or duplicated.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "update", "remove"] },
        content: { type: "string", description: "New entry text for add/update (one line)." },
        match: { type: "string", description: "Existing entry text to update or remove." },
        path: { type: "string", description: "MEMORY.md (default), USER.md or memory/<name>.md." },
        section: { type: "string", description: "Optional section heading for an added entry." },
        reason: { type: "string", description: "Why the entry is removed." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => {
      ctx.assertInvocationCurrent?.();
      const action = readStringParam(params, "action");
      const module = await loadMemoryWrite();
      if (!module.MEMORY_WRITE_ACTIONS.some((candidate) => candidate === action)) {
        throw new Error("action must be add, update or remove");
      }
      const { agentId, workspaceDir } = resolveAgentScope(api, ctx.sessionKey, ctx.agentId);
      const operation = {
        action: action as (typeof module.MEMORY_WRITE_ACTIONS)[number],
        path: readStringParam(params, "path") ?? module.DEFAULT_MEMORY_WRITE_PATH,
        content: readStringParam(params, "content"),
        match: readStringParam(params, "match"),
        section: readStringParam(params, "section"),
        reason: readStringParam(params, "reason"),
      };
      if (currentSettings(api).requireApproval) {
        const { stageMemoryProposal } = await loadMemoryInbox();
        return jsonResult(
          await stageMemoryProposal({ agentId, workspaceDir, operation, source: "memory_write" }),
        );
      }
      return jsonResult(await module.applyMemoryWrite(workspaceDir, operation));
    },
  };
}

function createWorkingMemoryTool(
  api: BranchPluginApi,
  host: MemoryCoreRuntimeHost,
  ctx: BranchPluginToolContext,
): AnyAgentTool | null {
  const settings = currentSettings(api);
  if (!settings.workingMemory.enabled || settings.workingMemory.readOnly) {
    return null;
  }
  const schemaMode = Boolean(settings.workingMemory.schema);
  return {
    label: "Working Memory",
    name: "update_working_memory",
    description: describeWorkingMemoryTool(schemaMode),
    parameters: {
      type: "object",
      properties: {
        memory: schemaMode
          ? { description: "The JSON formatted working memory content to store." }
          : {
              type: "string",
              description:
                "The Markdown formatted working memory content to store. This MUST be a string. Never pass an object.",
            },
      },
      required: ["memory"],
    },
    execute: async (_toolCallId, params) => {
      ctx.assertInvocationCurrent?.();
      const live = currentSettings(api);
      const { agentId } = resolveAgentScope(api, ctx.sessionKey, ctx.agentId);
      const key = workingMemoryKey(live.workingMemory, agentId, ctx.sessionKey);
      if (!key) {
        throw new Error("Session key is required for session-scoped working memory updates");
      }
      const store = openWorkingMemoryStore(host);
      const existing = (await store.lookup(key))?.content ?? null;
      const update = resolveWorkingMemoryUpdate({
        input: asNullableRecord(params)?.memory,
        existing,
        template: { format: "markdown", content: live.workingMemory.template },
        ...(live.workingMemory.schema ? { schema: live.workingMemory.schema } : {}),
      });
      if (!update.ok) {
        return jsonResult({ success: false, message: update.message });
      }
      await store.register(key, { content: update.workingMemory, updatedAt: Date.now() });
      return jsonResult({ success: true });
    },
  };
}

function createTaskClipboardTool(ctx: BranchPluginToolContext): AnyAgentTool | null {
  const taskKey = ctx.sessionKey?.trim();
  if (!taskKey) {
    return null;
  }
  return {
    label: "Task Clipboard",
    name: "task_clipboard",
    description:
      "Task working memory for this session: keep complete results (command output, file excerpts, search results) so later steps of the same task reuse them instead of re-running tools. " +
      "add stores an item (an item with the same sourceType + sourceId is replaced), list shows items, get returns one item, remove deletes one.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "get", "remove"] },
        id: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
        sourceType: {
          type: "string",
          enum: [
            "manual",
            "command",
            "file",
            "attachment",
            "image_attachment",
            "channel",
            "conversation_search",
            "entity",
            "entity_search",
            "action_result",
          ],
        },
        sourceId: { type: "string" },
        sourceLabel: { type: "string" },
        mimeType: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => {
      ctx.assertInvocationCurrent?.();
      const { createTaskClipboardService, TASK_CLIPBOARD_SOURCE_TYPES } = await loadTaskClipboard();
      const service = createTaskClipboardService();
      const action = readStringParam(params, "action");
      const id = readStringParam(params, "id");
      if (action === "list") {
        return jsonResult(await service.getSnapshot(taskKey));
      }
      if (action === "get" || action === "remove") {
        if (!id) {
          throw new Error(`id is required for ${action}`);
        }
        return jsonResult(
          action === "get"
            ? { item: await service.getItem(id, taskKey) }
            : await service.removeItem(id, taskKey),
        );
      }
      if (action !== "add") {
        throw new Error("action must be add, list, get or remove");
      }
      const sourceType = readStringParam(params, "sourceType");
      const result = await service.addItem(
        {
          content: readStringParam(params, "content") ?? "",
          title: readStringParam(params, "title"),
          sourceType: TASK_CLIPBOARD_SOURCE_TYPES.find((candidate) => candidate === sourceType),
          sourceId: readStringParam(params, "sourceId"),
          sourceLabel: readStringParam(params, "sourceLabel"),
          mimeType: readStringParam(params, "mimeType"),
        },
        taskKey,
      );
      return jsonResult(result);
    },
  };
}

function createResolveReferentTool(api: BranchPluginApi, ctx: BranchPluginToolContext): AnyAgentTool | null {
  if (ctx.senderIsOwner !== true) {
    return null;
  }
  return {
    label: "Resolve Referent",
    name: "resolve_referent",
    description:
      "Resolve an under-specified owner ask ('book the usual', 'clear my afternoon, you know why', 'same as last time') by ranking candidate referents from the owner's memory files (USER.md, MEMORY.md, recent daily notes). " +
      "Preview-first: returns the resolved interpretation for confirmation, or one disambiguating question to ask. Does NOT execute the underlying operation.",
    parameters: {
      type: "object",
      properties: { ask: { type: "string", description: "The owner's under-specified request." } },
      required: ["ask"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params) => {
      ctx.assertInvocationCurrent?.();
      const ask = readStringParam(params, "ask")?.trim();
      if (!ask) {
        throw new Error("ask is required");
      }
      const { workspaceDir } = resolveAgentScope(api, ctx.sessionKey, ctx.agentId);
      const { resolveReferent } = await loadResolveReferent();
      return jsonResult(await resolveReferent({ workspaceDir, ask }));
    },
  };
}

async function buildWorkingMemoryContext(
  api: BranchPluginApi,
  host: MemoryCoreRuntimeHost,
  settings: WorkingMemorySettings,
  ctx: { sessionKey?: string; agentId?: string },
): Promise<string | undefined> {
  const { agentId } = resolveAgentScope(api, ctx.sessionKey, ctx.agentId);
  const key = workingMemoryKey(settings, agentId, ctx.sessionKey);
  if (!key) {
    return undefined;
  }
  const data = (await openWorkingMemoryStore(host).lookup(key))?.content ?? null;
  return settings.readOnly
    ? buildReadOnlyWorkingMemoryInstruction(data)
    : buildWorkingMemoryToolInstruction({
        template: settings.schema
          ? { format: "json", content: settings.schema }
          : { format: "markdown", content: settings.template },
        data,
      });
}

async function captureLinks(
  api: BranchPluginApi,
  event: { content: string; sessionKey?: string },
  ctx: { channelId: string; sessionKey?: string },
): Promise<void> {
  const settings = currentSettings(api);
  if (!settings.linkCapture || settings.excludedChannels.includes(ctx.channelId)) {
    return;
  }
  const links = await loadLinkCapture();
  const urls = links.extractUrls(event.content ?? "");
  if (urls.length === 0) {
    return;
  }
  const { workspaceDir } = resolveAgentScope(api, ctx.sessionKey ?? event.sessionKey);
  const { applyMemoryWrite } = await loadMemoryWrite();
  const warn = (message: string) => api.logger.warn?.(message);
  const summarize = async (prompt: string) =>
    (
      await api.runtime.llm.complete({
        messages: [{ role: "user", content: prompt }],
        purpose: "memory-core link capture summary",
      })
    ).text;
  for (const url of urls) {
    try {
      const record = await links.buildLinkRecord(url, summarize, warn);
      await applyMemoryWrite(workspaceDir, {
        action: "add",
        path: links.LINK_MEMORY_PATH,
        content: links.formatLinkEntry(record, ctx.channelId || "unknown", new Date()),
      });
    } catch (error) {
      // Links are independent enrichment items; report one failed URL and keep going.
      warn(`memory-core: link capture failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

type MemoryInboxEntries = Awaited<
  ReturnType<(typeof import("./memory-inbox.js"))["listMemoryInbox"]>
>;

function formatInbox(entries: MemoryInboxEntries): string {
  if (entries.length === 0) {
    return "Memory inbox is empty.";
  }
  return [
    `Memory inbox: ${entries.length} pending proposal${entries.length === 1 ? "" : "s"}.`,
    ...entries.map(
      (entry) =>
        `\n[${entry.id}] ${entry.operation.action} (${entry.source}, ${entry.createdAt})\n${entry.diff}`,
    ),
    "",
    "Use /memory-inbox accept <id> or /memory-inbox reject <id>.",
  ].join("\n");
}

async function handleMemoryInboxCommand(api: BranchPluginApi, ctx: PluginCommandContext) {
  const [verb = "list", id] = (ctx.args?.trim() ?? "").split(/\s+/u).filter(Boolean);
  const { agentId, workspaceDir } = resolveAgentScope(api, ctx.sessionKey, ctx.agentId);
  const inbox = await loadMemoryInbox();
  if (verb === "list") {
    return { text: formatInbox(await inbox.listMemoryInbox(agentId)) };
  }
  if ((verb !== "accept" && verb !== "reject") || !id) {
    return { text: "Usage: /memory-inbox [list] | accept <id> | reject <id>" };
  }
  const allowed = Array.isArray(ctx.gatewayClientScopes)
    ? ctx.gatewayClientScopes.includes("operator.admin")
    : ctx.senderIsOwner === true;
  if (!allowed) {
    return {
      text: "⚠️ /memory-inbox accept|reject requires owner status for channel callers or operator.admin for gateway clients.",
    };
  }
  try {
    if (verb === "accept") {
      const result = await inbox.acceptMemoryProposal({ agentId, workspaceDir, id });
      return { text: `Accepted ${id}: ${result.status} in ${result.path}.` };
    }
    await inbox.rejectMemoryProposal({ agentId, id });
    return { text: `Rejected ${id}.` };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error) };
  }
}

function registerMemoryInboxGatewayMethods(api: BranchPluginApi): void {
  for (const operation of ["list", "accept", "reject"] as const) {
    api.registerGatewayMethod(
      `memory.inbox.${operation}`,
      async ({ params, respond }: GatewayRequestHandlerOptions) => {
        const record = asNullableRecord(params) ?? {};
        const id = typeof record.id === "string" ? record.id.trim() : "";
        const agentIdParam = typeof record.agentId === "string" ? record.agentId.trim() : undefined;
        if (operation !== "list" && !id) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required."));
          return;
        }
        try {
          const { agentId, workspaceDir } = resolveAgentScope(api, undefined, agentIdParam);
          const inbox = await loadMemoryInbox();
          const payload =
            operation === "list"
              ? { proposals: await inbox.listMemoryInbox(agentId) }
              : operation === "accept"
                ? await inbox.acceptMemoryProposal({ agentId, workspaceDir, id })
                : await inbox.rejectMemoryProposal({ agentId, id });
          respond(true, payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
        }
      },
      { scope: operation === "list" ? "operator.read" : "operator.admin" },
    );
  }
}

export function registerMemoryCaptureFeatures(api: BranchPluginApi, host: MemoryCoreRuntimeHost): void {
  api.registerTool((ctx) => createMemoryWriteTool(api, ctx), { names: ["memory_write"] });
  api.registerTool((ctx) => createWorkingMemoryTool(api, host, ctx), {
    names: ["update_working_memory"],
  });
  api.registerTool((ctx) => createTaskClipboardTool(ctx), { names: ["task_clipboard"] });
  api.registerTool((ctx) => createResolveReferentTool(api, ctx), { names: ["resolve_referent"] });
  registerMemoryInboxGatewayMethods(api);
  api.registerCommand({
    name: "memory-inbox",
    description: "Review pending memory proposals: list, accept or reject.",
    acceptsArgs: true,
    exposeSenderIsOwner: true,
    handler: async (ctx) => await handleMemoryInboxCommand(api, ctx),
  });

  api.on("before_prompt_build", async (event, ctx) => {
    try {
      const settings = currentSettings(api);
      const segments: string[] = [];
      if (settings.temporalMarkers && ctx.trigger === "user") {
        const { buildTemporalGapReminder } = await loadTemporalMarkers();
        const cfg = currentConfig(api);
        const reminder = buildTemporalGapReminder({
          messages: event.messages,
          now: Date.now(),
          timeZone: cfg.agents?.defaults?.userTimezone,
        });
        if (reminder) {
          segments.push(reminder);
        }
      }
      if (settings.workingMemory.enabled) {
        const instruction = await buildWorkingMemoryContext(api, host, settings.workingMemory, ctx);
        if (instruction) {
          segments.push(instruction);
        }
      }
      ctx.hookInvocation?.assertActive();
      return segments.length > 0 ? { prependContext: segments.join("\n\n") } : undefined;
    } catch (error) {
      api.logger.warn?.(
        `memory-core: memory capture context failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  });

  api.on("message_received", async (event, ctx) => {
    try {
      await captureLinks(api, event, ctx);
    } catch (error) {
      api.logger.warn?.(
        `memory-core: link capture failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
