import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EventFrame } from "../../packages/gateway-protocol/src/index.js";
import {
  annotateInterSessionPromptText,
  normalizeInputProvenance,
} from "../sessions/input-provenance.js";
import { extractFirstTextBlock } from "../shared/chat-message-content.js";
import { registerQueueMcpTools } from "./queue-tools.js";
import { registerSigninMcpTools } from "./signin-tools.js";
import { registerTrunkStatusTools } from "./trunk-status-tools.js";

/**
 * Trunk tools for `branch mcp serve`: an outside agent sees and drives Trunks the way the owner's window does.
 * Upstream's channel tools (conversations_list, messages_send, ...) only reach channel-routed conversations
 * (`toConversation` needs a channel route), so a Trunk's own threads need these. The handshake, steer and
 * run-status rules are the ones tools/branch-driver/driver.cjs proved against the owner's gateway.
 */
export type TrunkGateway = {
  request<T = Record<string, unknown>>(method: string, params: Record<string, unknown>): Promise<T>;
  onGatewayEvent(listener: (event: EventFrame) => void): () => void;
};
export type OutsideAgentIdentity = {
  id: string;
  name: string;
  version?: string;
  where?: string;
  project?: string;
  instance?: string;
  avatar?: string;
  trunkId?: string;
};
export type TrunkToolsOptions = {
  /** Who is speaking, once the gateway accepted contacts.outside.hello; undefined = plain owner messages. */
  outsideAgent: () => OutsideAgentIdentity | undefined | Promise<OutsideAgentIdentity | undefined>;
  /** What this agent is doing now, for Settings › Grafts. */
  activity?: (text: string) => void;
  now?: () => number;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
const RUN_WAIT_MAX_MS = 600_000;
const WAIT_SLICE_MS = 30_000;

export function ok(text: string, structuredContent: Rec) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

/** One message as an agent wants to read it: who wrote it, what it says, when. */
export function readMessage(message: unknown): Rec {
  const m = rec(message);
  const meta = rec(m.__branch);
  const text = typeof m.content === "string" ? m.content : extractFirstTextBlock(m);
  const from =
    m.role === "user"
      ? (str(meta.senderName) ?? (meta.senderIsOwner === true ? "owner" : "user"))
      : (str(rec(m.senderSession).agentId) ?? "trunk");
  return {
    role: m.role,
    from,
    // Graft is an agent-facing reader: retain the trusted handoff envelope
    // that chat.history separates from its display body.
    text: annotateInterSessionPromptText(text ?? "", normalizeInputProvenance(m.provenance)),
    ...(typeof m.timestamp === "number" ? { at: m.timestamp } : {}),
    ...(str(meta.id) ? { id: meta.id } : {}),
    ...(str(meta.runId) ? { runId: meta.runId } : {}),
  };
}

/** A short line for a streamed run event (thinking, tool call, tool result, lifecycle); undefined to skip. */
/** Token totals from a run's streamed `usage` events (the driver's usageFromLog): one model call per input report. */
export function addUsage(
  total: {
    model_calls: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  },
  data: Rec,
): void {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  if (n(data.inputTokens)) {
    total.model_calls += 1;
    total.input_tokens += n(data.inputTokens);
    total.cached_input_tokens += n(data.cachedInputTokens);
  }
  total.output_tokens += n(data.outputTokens);
}

export function describeRunEvent(payload: Rec): string | undefined {
  const stream = str(payload.stream);
  const data = rec(payload.data);
  if (!stream || stream === "assistant") return undefined;
  if (stream === "tool") {
    const phase = str(data.phase) ?? "call";
    return `tool ${phase}: ${str(data.name) ?? str(data.toolName) ?? "tool"}`;
  }
  if (stream === "lifecycle") return `run ${str(data.phase) ?? "update"}`;
  const text = str(data.text) ?? str(data.delta);
  if (text) return `${stream}: ${text.slice(0, 200)}`;
  // Item, status and usage events carry no text; name what they are so the stream reads as progress.
  const item = rec(data.item);
  const what = [
    data.phase,
    data.status,
    data.type,
    item.type,
    data.kind,
    data.name,
    item.name,
    data.title,
  ]
    .map(str)
    .filter((part, i, all): part is string => Boolean(part) && all.indexOf(part) === i)
    .slice(0, 3);
  const usage =
    typeof data.outputTokens === "number" ? `${data.outputTokens} output tokens` : undefined;
  return [stream, ...what, ...(usage ? [usage] : [])].join(" ");
}

async function chatSend(gw: TrunkGateway, opts: TrunkToolsOptions, params: Rec) {
  const agent = await opts.outsideAgent();
  return gw.request<Rec>("chat.send", {
    ...params,
    deliver: false,
    idempotencyKey: randomUUID(),
    ...(agent ? { outsideAgent: agent } : {}),
  });
}

/** Live status per Trunk: working or idle, the thread it works in, its model and the account it uses. */
/** A thread's state for a supervisor: its status, the run it is working on now, and why it may be stuck. */
export async function threadState(gw: TrunkGateway, row: Rec): Promise<Rec> {
  const working = row.hasActiveRun === true || row.status === "running";
  const key = str(row.key);
  // chat.history carries the run in flight (also one the engine resumed after a restart); sessions.list doesn't.
  const history =
    working && key
      ? rec(await gw.request("chat.history", { sessionKey: key, limit: 1 }).catch(() => ({})))
      : {};
  const runId = str(rec(history.inFlightRun).runId);
  const info = rec(history.sessionInfo);
  const stuck =
    row.status === "running" && row.hasActiveRun !== true
      ? "status running but no active run"
      : str(row.sendDisabledReason);
  return {
    status: str(info.status) ?? str(row.status) ?? (working ? "running" : "idle"),
    ...(runId ? { run_id: runId } : {}),
    ...(stuck ? { stuck } : {}),
    ...(row.abortedLastRun === true ? { last_run: "aborted" } : {}),
    ...(typeof row.inputTokens === "number"
      ? { tokens: { input: row.inputTokens, output: row.outputTokens, context: row.contextTokens } }
      : {}),
  };
}

/** Live status per Trunk: working or idle, the thread and run it works on, its model and the account it uses. */
export async function listTrunks(gw: TrunkGateway): Promise<Rec[]> {
  const agents = list(rec(await gw.request("agents.list", {})).agents);
  return await Promise.all(
    agents.map(async (agent) => {
      const id = str(agent.id)!;
      const rows = list(
        rec(await gw.request("sessions.list", { agentId: id, limit: 50 }).catch(() => ({})))
          .sessions,
      );
      const running = rows.find(
        (row) =>
          row.hasActiveRun === true || row.status === "running" || str(row.activeWriterRunId),
      );
      const state = running ? await threadState(gw, running) : undefined;
      // Startup stopped retrying this Trunk's preparation on its own (agents.retryStartup starts it again).
      const attention = rec(rec(agent.admissionRefusal).preparation).state === "needs-attention";
      return {
        id,
        name: str(rec(agent.identity).name) ?? str(agent.name) ?? id,
        state: attention ? "needs-attention" : running ? "working" : "idle",
        ...(running ? { thread: running.key, ...state } : {}),
        model: str(rec(agent.model).primary) ?? str(agent.model) ?? str(rows[0]?.model),
        account: str(running?.authProfileOverride) ?? str(rows[0]?.authProfileOverride),
      };
    }),
  );
}

/** agents.create answers before the config reload makes the Trunk known everywhere; wait for it (driver W-ready). */
async function waitForTrunk(
  gw: TrunkGateway,
  agentId: string,
  timeoutMs: number,
): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const status = rec(
      await gw.request("models.authStatus", { agentId }).catch(() => ({ error: 1 })),
    );
    if (!status.error && !status.unavailable) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

/** The status of a run, reading the thread's row when agent.wait has forgotten a finished run (driver W12). */
async function runStatus(gw: TrunkGateway, runId: string, threadKey: string, sliceMs: number) {
  const wait = rec(
    await gw
      .request("agent.wait", { runId, timeoutMs: sliceMs })
      .catch((error: unknown) => ({ status: "timeout", transient: String(error) })),
  );
  if (wait.status !== "timeout") return wait;
  const described = rec(
    await gw.request("sessions.describe", { key: threadKey }).catch(() => ({})),
  );
  const row = rec(described.session);
  const active = str(row.activeWriterRunId);
  if (row.status && row.status !== "running" && active !== runId) {
    return { status: String(row.status) };
  }
  return wait;
}

export function registerTrunkMcpTools(
  server: McpServer,
  gw: TrunkGateway,
  opts: TrunkToolsOptions,
): void {
  registerSigninMcpTools(server, gw);
  registerQueueMcpTools(server, gw);
  registerTrunkReadTools(server, gw);
  registerTrunkStatusTools(server, gw);
  registerTrunkWriteTools(server, gw, opts);
  registerRunTools(server, gw);
  registerRoomTools(server, gw, opts);
}

function registerTrunkReadTools(server: McpServer, gw: TrunkGateway): void {
  server.tool(
    "trunks_list",
    "List Branch Trunks and contacts with live status: working, idle or needs-attention (its startup stopped retrying), the thread in use, model and account.",
    {},
    async () => {
      const trunks = await listTrunks(gw);
      const contacts = list(rec(await gw.request("contacts.list", {}).catch(() => ({}))).contacts);
      const outside = contacts
        .filter((row) => row.kind === "outside" || row.kind === "group")
        .map((row) => ({ id: row.id, kind: row.kind, name: row.name, where: row.where }));
      return ok(`${trunks.length} Trunks`, { trunks, contacts: outside });
    },
  );

  server.tool(
    "trunk_threads",
    "List a Trunk's threads (conversations) with their status, newest first, paged by cursor.",
    {
      agent_id: z.string().min(1),
      status: z.enum(["active", "working", "archived"]).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    async ({ agent_id, status, limit, cursor }) => {
      const result = rec(
        await gw.request("contacts.topics", {
          contactId: `trunk:${agent_id}`,
          ...(status ? { status } : {}),
          limit: limit ?? 20,
          ...(cursor ? { cursor } : {}),
        }),
      );
      const rows = new Map(
        list(
          rec(
            await gw.request("sessions.list", { agentId: agent_id, limit: 200 }).catch(() => ({})),
          ).sessions,
        ).map((row) => [str(row.key), row]),
      );
      const threads = await Promise.all(
        list(result.topics).map(async (topic) => {
          const row = rows.get(str(topic.key));
          return {
            key: topic.key,
            title: topic.title,
            status: topic.status,
            unread: topic.unread,
            ...(row ? await threadState(gw, row) : {}),
          };
        }),
      );
      return ok(`${threads.length} threads`, { threads, next_cursor: result.nextCursor ?? null });
    },
  );

  server.tool(
    "thread_history",
    "Read a thread's messages, oldest first, with who wrote each one. Pass next_cursor back for the next page.",
    {
      thread_key: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    async ({ thread_key, limit, cursor }) => {
      const result = rec(
        await gw.request("chat.history", {
          sessionKey: thread_key,
          limit: limit ?? 30,
          ...(cursor ? { cursor } : {}),
        }),
      );
      const messages = list(result.messages).map(readMessage);
      const next = str(result.nextCursor) ?? str(result.cursor) ?? null;
      return ok(`${messages.length} messages`, { messages, next_cursor: next });
    },
  );

  server.tool(
    "usage_status",
    "Usage and account status: plan limits per provider and which signed-in accounts each Trunk can use.",
    { agent_id: z.string().optional() },
    async ({ agent_id }) => {
      const usage = await gw
        .request("usage.status", {})
        .catch((e: unknown) => ({ error: String(e) }));
      const accounts = await gw
        .request("models.authStatus", agent_id ? { agentId: agent_id } : {})
        .catch((e: unknown) => ({ error: String(e) }));
      return ok("usage and accounts", { usage, accounts });
    },
  );
}

function registerTrunkWriteTools(
  server: McpServer,
  gw: TrunkGateway,
  opts: TrunkToolsOptions,
): void {
  server.tool(
    "trunk_create",
    "Create a Trunk. It is ready to message when this returns.",
    {
      name: z.string().min(1).max(80),
      model: z.string().optional(),
      workspace: z.string().optional(),
      accounts: z
        .array(z.string().min(1))
        .optional()
        .describe(
          'Signed-in accounts in the order this Trunk should use them, e.g. ["openai-codex:b", "openai-codex:a"]',
        ),
    },
    async ({ name, model, workspace, accounts }) => {
      opts.activity?.(`Creating Trunk ${name}`);
      const created = rec(
        await gw.request("agents.create", {
          name,
          ...(model ? { model } : {}),
          ...(workspace ? { workspace } : {}),
        }),
      );
      const agentId = str(created.agentId) ?? str(created.id);
      if (!agentId) throw new Error("agents.create returned no agent id");
      const ready = await waitForTrunk(gw, agentId, 120_000);
      // Account order per provider, as the driver set it (models.authOrderSet).
      const byProvider = new Map<string, string[]>();
      for (const profile of accounts ?? []) {
        const provider = profile.split(":")[0]!;
        byProvider.set(provider, [...(byProvider.get(provider) ?? []), profile]);
      }
      for (const [provider, profileIds] of byProvider) {
        await gw.request("models.authOrderSet", { agentId, provider, profileIds });
      }
      return ok(`created ${agentId}`, {
        agent_id: agentId,
        ready,
        workspace: created.workspace,
        ...(byProvider.size ? { accounts: Object.fromEntries(byProvider) } : {}),
      });
    },
  );

  server.tool(
    "trunk_send",
    "Send a message to a Trunk: in a new thread (default) or in thread_key. Returns the thread and run ids; use run_wait for the reply.",
    {
      agent_id: z.string().min(1),
      text: z.string().min(1),
      thread_key: z.string().optional(),
      title: z.string().max(100).optional(),
    },
    async ({ agent_id, text, thread_key, title }) => {
      opts.activity?.(`Messaging ${agent_id}`);
      let key = thread_key;
      if (!key) {
        const who = (await opts.outsideAgent())?.id ?? "mcp";
        key = `agent:${agent_id}:${who}-${(opts.now ?? Date.now)()}`;
        await gw.request("sessions.create", {
          key,
          agentId: agent_id,
          label: title ?? text.slice(0, 60),
        });
      }
      // A send queues behind the thread's active run. It never starts a parallel run, whatever
      // queue mode the session or config sets. trunk_steer is the path that joins the run.
      const sent = await chatSend(gw, opts, {
        sessionKey: key,
        agentId: agent_id,
        message: text,
        queueMode: "followup",
      });
      return ok(`sent to ${key}`, {
        thread_key: key,
        run_id: sent.runId ?? null,
        status: sent.status,
      });
    },
  );

  server.tool(
    "trunk_steer",
    "Steer a Trunk that is working: the message joins its current run instead of waiting behind it.",
    { thread_key: z.string().min(1), text: z.string().min(1) },
    async ({ thread_key, text }) => {
      opts.activity?.(`Steering ${thread_key}`);
      const sent = await chatSend(gw, opts, {
        sessionKey: thread_key,
        message: text,
        queueMode: "steer",
      });
      return ok("steered", { thread_key, run_id: sent.runId ?? null, status: sent.status });
    },
  );
}

function registerRunTools(server: McpServer, gw: TrunkGateway): void {
  server.tool(
    "run_abort",
    "Stop a Trunk's run in a thread (the current run, or run_id).",
    { thread_key: z.string().min(1), run_id: z.string().optional() },
    async ({ thread_key, run_id }) => {
      const result = await gw.request("chat.abort", {
        sessionKey: thread_key,
        ...(run_id ? { runId: run_id } : {}),
      });
      return ok("aborted", { result });
    },
  );

  server.tool(
    "run_wait",
    "Wait for a run to finish (bounded by timeout_ms, max 10 min), streaming thinking, tool calls and results as progress. Returns the status, the events seen and the Trunk's reply.",
    {
      run_id: z.string().min(1),
      thread_key: z.string().min(1),
      timeout_ms: z.number().int().min(1_000).max(RUN_WAIT_MAX_MS).optional(),
    },
    async ({ run_id, thread_key, timeout_ms }, extra) => {
      const events: string[] = [];
      const usage = { model_calls: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
      const progressToken = extra._meta?.progressToken;
      const stop = gw.onGatewayEvent((frame) => {
        const payload = rec(frame.payload);
        if (frame.event !== "agent" || payload.runId !== run_id) return;
        if (payload.stream === "usage") addUsage(usage, rec(payload.data));
        const line = describeRunEvent(payload);
        if (!line) return;
        events.push(line);
        if (progressToken !== undefined) {
          void extra
            .sendNotification({
              method: "notifications/progress",
              params: { progressToken, progress: events.length, message: line },
            })
            .catch(() => undefined);
        }
      });
      try {
        const deadline = Date.now() + (timeout_ms ?? 120_000);
        let status: Rec = { status: "timeout" };
        while (Date.now() < deadline && !extra.signal.aborted) {
          status = await runStatus(
            gw,
            run_id,
            thread_key,
            Math.min(WAIT_SLICE_MS, deadline - Date.now()),
          );
          if (status.status !== "timeout") break;
        }
        const history = rec(
          await gw.request("chat.history", { sessionKey: thread_key, limit: 20 }),
        );
        // This run's answer, never an earlier turn's in the same thread.
        const last = list(history.messages)
          .filter((m) => m.role === "assistant" && rec(m.__branch).runId === run_id)
          .at(-1);
        const reply = last ? String(readMessage(last).text) : "";
        return ok(`run ${String(status.status)}`, {
          status: status.status,
          ...(status.error ? { error: status.error } : {}),
          reply,
          usage,
          events: events.slice(-50),
        });
      } finally {
        stop();
      }
    },
  );
}

function registerRoomTools(server: McpServer, gw: TrunkGateway, opts: TrunkToolsOptions): void {
  server.tool("rooms_list", "List Branch group chats and their members.", {}, async () => {
    const rooms = list(rec(await gw.request("rooms.list", {})).rooms).map((room) => ({
      id: room.roomId,
      name: room.name,
      lead: room.lead,
      members: list(room.members).map((m) => `${String(m.kind)}:${String(m.id)}`),
    }));
    return ok(`${rooms.length} group chats`, { rooms });
  });

  server.tool(
    "room_read",
    "Read a group chat's log after a cursor (seq).",
    {
      room_id: z.string().min(1),
      cursor: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    async ({ room_id, cursor, limit }) => {
      const log = await gw.request("rooms.log", {
        roomId: room_id,
        ...(cursor !== undefined ? { cursor } : {}),
        limit: limit ?? 50,
      });
      return ok("group chat log", { log });
    },
  );

  server.tool(
    "room_join",
    "Add this agent to a group chat as an outside-agent member, so it can post there.",
    { room_id: z.string().min(1) },
    async ({ room_id }) => {
      const agent = await opts.outsideAgent();
      if (!agent) {
        throw new Error(
          "Branch has not registered this outside agent. Reconnect Graft and try room_join again.",
        );
      }
      const result = await gw.request("rooms.members.add", {
        roomId: room_id,
        kind: "a2a",
        id: agent.id,
        outsideAgent: agent,
      });
      return ok("joined", { result });
    },
  );

  server.tool(
    "room_post",
    "Post a message to a group chat; its lead Trunk answers when mentioned. The message is shown as this agent's.",
    { room_id: z.string().min(1), text: z.string().min(1) },
    async ({ room_id, text }) => {
      opts.activity?.(`Posting in group chat ${room_id}`);
      const agent = await opts.outsideAgent();
      if (!agent) {
        throw new Error(
          "Branch has not registered this outside agent. Reconnect Graft and try room_join before posting.",
        );
      }
      const result = await gw.request("rooms.send", {
        roomId: room_id,
        message: text,
        outsideAgent: agent,
      });
      return ok("posted", { result });
    },
  );
}
