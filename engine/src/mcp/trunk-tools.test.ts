import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { EventFrame } from "../../packages/gateway-protocol/src/index.js";
import { gateEveryTool } from "./channel-server-runtime.js";
import { liveDesktopGatewayUrl, resolveDesktopGateway } from "./desktop-gateway.js";
import { displayName, outsideAgentFromClient, OutsidePresence } from "./outside-presence.js";
import { describeRunEvent, registerTrunkMcpTools, type TrunkGateway } from "./trunk-tools.js";

type Call = { method: string; params: Record<string, unknown> };

/** A fake gateway: canned answers per method, every call recorded, events pushed by the test. */
function fakeGateway(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const listeners = new Set<(event: EventFrame) => void>();
  const gw: TrunkGateway = {
    async request(method, params) {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) throw new Error(`unexpected ${method}`);
      return (await answer(params)) as never;
    },
    onGatewayEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (payload: Record<string, unknown>) => {
    for (const listener of listeners)
      listener({ type: "event", event: "agent", payload } as EventFrame);
  };
  return { gw, calls, emit };
}

const claude = { id: "claude-code", name: "Claude Code", version: "2.1.0", where: "LEGION" };
const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

async function connect(gw: TrunkGateway, agent: typeof claude | null = claude) {
  const server = new McpServer({ name: "branch", version: "test" });
  registerTrunkMcpTools(server, gw, { outsideAgent: () => agent ?? undefined, now: () => 1_700 });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "Claude Code", version: "2.1.0" });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>, extra = {}) {
  const result = await client.callTool({ name, arguments: args }, undefined, extra);
  return result.structuredContent as Record<string, unknown>;
}

describe("branch mcp serve Trunk tools", () => {
  it("trunks_list shows each Trunk's live state, thread, model and account, plus outside contacts", async () => {
    const { gw } = fakeGateway({
      "agents.list": () => ({
        agents: [
          { id: "builder-oak", name: "Builder Oak", model: { primary: "openai-codex/gpt-5.5" } },
          { id: "main", identity: { name: "Sapling" } },
        ],
      }),
      "sessions.list": (p) =>
        p.agentId === "builder-oak"
          ? {
              sessions: [
                {
                  key: "agent:builder-oak:t1",
                  status: "running",
                  hasActiveRun: true,
                  authProfileOverride: "openai-codex:b",
                  inputTokens: 900,
                  outputTokens: 40,
                  contextTokens: 1200,
                },
              ],
            }
          : { sessions: [{ key: "agent:main:main", status: "done", model: "claude-opus" }] },
      // The run in flight (also one resumed after a restart) comes from chat.history.
      "chat.history": () => ({
        sessionInfo: { status: "running" },
        inFlightRun: { runId: "run-resumed-7" },
      }),
      "contacts.list": () => ({
        contacts: [
          { id: "trunk:main", kind: "trunk", name: "Sapling" },
          { id: "a2a:claude-code", kind: "outside", name: "Claude Code", where: "LEGION" },
        ],
      }),
    });
    const out = await call(await connect(gw), "trunks_list", {});
    expect(out.trunks).toEqual([
      {
        id: "builder-oak",
        name: "Builder Oak",
        state: "working",
        thread: "agent:builder-oak:t1",
        status: "running",
        run_id: "run-resumed-7",
        tokens: { input: 900, output: 40, context: 1200 },
        model: "openai-codex/gpt-5.5",
        account: "openai-codex:b",
      },
      { id: "main", name: "Sapling", state: "idle", model: "claude-opus" },
    ]);
    expect(out.contacts).toEqual([
      { id: "a2a:claude-code", kind: "outside", name: "Claude Code", where: "LEGION" },
    ]);
  });

  it("trunks_list says a Trunk whose startup stopped retrying needs attention", async () => {
    const pending = (state: string) => ({
      agentId: "x",
      paths: ["db"],
      code: "agent-database-inspection-pending",
      reason: "pending",
      repairHint: "wait",
      preparation: { state, failures: 30, restarts: 4 },
    });
    const { gw } = fakeGateway({
      "agents.list": () => ({
        agents: [
          { id: "spruce", name: "Spruce", admissionRefusal: pending("needs-attention") },
          { id: "elm", name: "Elm", admissionRefusal: pending("retrying") },
        ],
      }),
      "sessions.list": () => ({ sessions: [] }),
      "contacts.list": () => ({ contacts: [] }),
    });
    const out = await call(await connect(gw), "trunks_list", {});
    expect(out.trunks).toEqual([
      { id: "spruce", name: "Spruce", state: "needs-attention" },
      { id: "elm", name: "Elm", state: "idle" },
    ]);
  });

  it("trunk_send opens a new labelled thread and sends as the outside agent", async () => {
    const { gw, calls } = fakeGateway({
      "sessions.create": () => ({ ok: true }),
      "chat.send": () => ({ runId: "run-1", status: "started" }),
    });
    const out = await call(await connect(gw), "trunk_send", {
      agent_id: "builder-oak",
      text: "Reply with exactly OK",
    });
    expect(out).toEqual({
      thread_key: "agent:builder-oak:claude-code-1700",
      run_id: "run-1",
      status: "started",
    });
    expect(calls[0]).toEqual({
      method: "sessions.create",
      params: {
        key: "agent:builder-oak:claude-code-1700",
        agentId: "builder-oak",
        label: "Reply with exactly OK",
      },
    });
    expect(calls[1]?.params).toMatchObject({
      sessionKey: "agent:builder-oak:claude-code-1700",
      agentId: "builder-oak",
      message: "Reply with exactly OK",
      deliver: false,
      outsideAgent: claude,
    });
  });

  it("trunk_send into a given thread does not create one, and without a known identity sends plainly", async () => {
    const { gw, calls } = fakeGateway({ "chat.send": () => ({ runId: "run-2" }) });
    await call(await connect(gw, null), "trunk_send", {
      agent_id: "main",
      text: "hi",
      thread_key: "agent:main:main",
    });
    expect(calls.map((c) => c.method)).toEqual(["chat.send"]);
    expect(calls[0]?.params).not.toHaveProperty("outsideAgent");
  });

  it("trunk_send into a thread queues behind its active run instead of inheriting the session queue mode", async () => {
    const { gw, calls } = fakeGateway({ "chat.send": () => ({ runId: "run-3", status: "queued" }) });
    await call(await connect(gw), "trunk_send", {
      agent_id: "builder-oak",
      text: "Also check the migration",
      thread_key: "agent:builder-oak:claude-code-1700",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.params).toMatchObject({
      sessionKey: "agent:builder-oak:claude-code-1700",
      queueMode: "followup",
    });
  });

  it("trunk_steer steers the busy run and run_abort stops it", async () => {
    const { gw, calls } = fakeGateway({
      "chat.send": () => ({ runId: "run-1" }),
      "chat.abort": () => ({ ok: true }),
    });
    const client = await connect(gw);
    await call(client, "trunk_steer", { thread_key: "agent:oak:t", text: "also add tests" });
    await call(client, "run_abort", { thread_key: "agent:oak:t", run_id: "run-1" });
    expect(calls[0]?.params).toMatchObject({
      sessionKey: "agent:oak:t",
      queueMode: "steer",
      outsideAgent: claude,
    });
    expect(calls[1]).toEqual({
      method: "chat.abort",
      params: { sessionKey: "agent:oak:t", runId: "run-1" },
    });
  });

  it("run_wait streams thinking and tool events as progress and returns the reply", async () => {
    let waits = 0;
    const fake = fakeGateway({
      "agent.wait": async () => {
        waits += 1;
        if (waits === 1) {
          fake.emit({ runId: "run-1", stream: "thinking", data: { text: "checking the brief" } });
          fake.emit({ runId: "run-1", stream: "tool", data: { phase: "start", name: "exec" } });
          fake.emit({ runId: "other", stream: "tool", data: { phase: "start", name: "read" } });
          fake.emit({
            runId: "run-1",
            stream: "usage",
            data: { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 30 },
          });
          fake.emit({
            runId: "run-1",
            stream: "usage",
            data: { inputTokens: 1200, cachedInputTokens: 1000, outputTokens: 12 },
          });
          fake.emit({
            runId: "other",
            stream: "usage",
            data: { inputTokens: 99, outputTokens: 99 },
          });
          return { status: "timeout" };
        }
        return { status: "ok" };
      },
      "sessions.describe": () => ({ session: { status: "running", activeWriterRunId: "run-1" } }),
      "chat.history": () => ({
        messages: [
          { role: "user", content: "Reply with exactly OK" },
          {
            role: "assistant",
            content: [{ type: "text", text: "earlier answer" }],
            __branch: { runId: "run-0" },
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "OK" }],
            __branch: { runId: "run-1" },
          },
        ],
      }),
    });
    const progress: string[] = [];
    const out = await call(
      await connect(fake.gw),
      "run_wait",
      { run_id: "run-1", thread_key: "agent:oak:t", timeout_ms: 5_000 },
      {
        onprogress: (p: { message?: string }) => progress.push(p.message ?? ""),
      },
    );
    expect(out).toEqual({
      status: "ok",
      reply: "OK",
      usage: { model_calls: 2, input_tokens: 2200, cached_input_tokens: 1800, output_tokens: 42 },
      events: [
        "thinking: checking the brief",
        "tool start: exec",
        "usage 30 output tokens",
        "usage 12 output tokens",
      ],
    });
    expect(progress.slice(0, 2)).toEqual(["thinking: checking the brief", "tool start: exec"]);
  });

  it("run_wait reads the thread row when agent.wait forgot a finished run", async () => {
    const { gw } = fakeGateway({
      "agent.wait": () => ({ status: "timeout" }),
      "sessions.describe": () => ({ session: { status: "done" } }),
      "chat.history": () => ({ messages: [] }),
    });
    const out = await call(await connect(gw), "run_wait", {
      run_id: "run-1",
      thread_key: "agent:oak:t",
      timeout_ms: 5_000,
    });
    expect(out.status).toBe("done");
  });

  it("thread_history pages with a cursor and names who wrote each message", async () => {
    const { gw, calls } = fakeGateway({
      "chat.history": () => ({
        messages: [
          { role: "user", content: "hi", __branch: { senderName: "Claude Code", id: "e1" } },
          { role: "user", content: "me", __branch: { senderIsOwner: true } },
          { role: "assistant", content: [{ type: "text", text: "OK" }], __branch: { runId: "r1" } },
        ],
        nextCursor: "c2",
      }),
    });
    const out = await call(await connect(gw), "thread_history", {
      thread_key: "agent:oak:t",
      limit: 3,
      cursor: "c1",
    });
    expect(calls[0]?.params).toEqual({ sessionKey: "agent:oak:t", limit: 3, cursor: "c1" });
    expect(out).toEqual({
      messages: [
        { role: "user", from: "Claude Code", text: "hi", id: "e1" },
        { role: "user", from: "owner", text: "me" },
        { role: "assistant", from: "trunk", text: "OK", runId: "r1" },
      ],
      next_cursor: "c2",
    });
  });

  it("trunk_threads lists a Trunk's contact topics", async () => {
    const { gw, calls } = fakeGateway({
      "contacts.topics": () => ({
        topics: [{ key: "agent:oak:t", title: "Fix CI", status: "working", unread: true }],
        nextCursor: "agent:oak:t",
      }),
    });
    const out = await call(await connect(gw), "trunk_threads", {
      agent_id: "oak",
      status: "working",
    });
    expect(calls[0]?.params).toEqual({ contactId: "trunk:oak", status: "working", limit: 20 });
    expect(out).toEqual({
      threads: [{ key: "agent:oak:t", title: "Fix CI", status: "working", unread: true }],
      next_cursor: "agent:oak:t",
    });
  });

  it("room_join and room_post act as the outside agent", async () => {
    const { gw, calls } = fakeGateway({
      "rooms.members.add": () => ({ room: {} }),
      "rooms.send": () => ({ event: { seq: 4 } }),
    });
    const client = await connect(gw);
    await call(client, "room_join", { room_id: "builders" });
    await call(client, "room_post", { room_id: "builders", text: "Hello from Claude Code" });
    expect(calls[0]).toEqual({
      method: "rooms.members.add",
      params: { roomId: "builders", kind: "a2a", id: "claude-code", outsideAgent: claude },
    });
    expect(calls[1]).toEqual({
      method: "rooms.send",
      params: { roomId: "builders", message: "Hello from Claude Code", outsideAgent: claude },
    });
  });

  it("trunk_create waits until the new Trunk is known", async () => {
    let checks = 0;
    const { gw } = fakeGateway({
      "agents.create": () => ({ agentId: "scout", workspace: "C:/w/scout" }),
      "models.authStatus": () => (++checks < 2 ? { unavailable: true } : { providers: [] }),
    });
    const out = await call(await connect(gw), "trunk_create", { name: "Scout" });
    expect(out).toEqual({ agent_id: "scout", ready: true, workspace: "C:/w/scout" });
  });
});

describe("branch mcp serve identity and gateway", () => {
  it("names each connected client by its product name, computer and project folder", () => {
    const a = outsideAgentFromClient(
      { name: "claude-code", version: "2.1.0" },
      "LEGION",
      "/w/Branch-Agent",
    );
    const b = outsideAgentFromClient(
      { name: "claude-code", version: "2.1.0" },
      "LEGION",
      "/w/EDILAS",
    );
    const again = outsideAgentFromClient({ name: "claude-code" }, "LEGION", "/w/Branch-Agent");
    expect(a).toMatchObject({
      name: "Claude Code",
      version: "2.1.0",
      where: "LEGION",
      project: "Branch-Agent",
    });
    expect(a?.id).toMatch(/^claude-code-[0-9a-f]{6}$/);
    expect(b?.id).not.toBe(a?.id);
    expect(again?.id).toBe(a?.id);
    expect(displayName({ name: "codex-mcp-client" })).toBe("Codex");
    expect(displayName({ name: "gemini-cli-mcp-client" })).toBe("Gemini CLI");
    expect(displayName({ name: "hermes", title: "Hermes Agent" })).toBe("Hermes Agent");
    expect(displayName({ name: "my-agent" })).toBe("my-agent");
    expect(outsideAgentFromClient(undefined)).toBeUndefined();
  });

  it("stops acting for the agent once Settings › Grafts turns it away", async () => {
    let refuse = false;
    const presence = new OutsidePresence(async () => {
      if (refuse) throw new Error("Claude Code was disconnected in Settings › Connected agents.");
      return { mayDriveWindow: true };
    });
    presence.start(claude);
    await expect(presence.identity()).resolves.toMatchObject(claude);
    expect(presence.mayDriveWindow()).toBe(true);
    refuse = true;
    presence.activity("Messaging oak");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(presence.identity()).rejects.toThrow(/disconnected/);
    presence.stop();
    const older = new OutsidePresence(async () => {
      throw new Error("unknown method: contacts.outside.hello");
    });
    older.start(claude);
    await expect(older.identity()).resolves.toBeUndefined();
    older.stop();
  });

  it("uses the desktop app's loopback gateway and token file only when no auth is named", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-desktop-"));
    try {
      fs.writeFileSync(path.join(dir, "gateway-token"), "secret-value\r\n");
      expect(resolveDesktopGateway({}, {}, dir)).toEqual({
        url: "ws://127.0.0.1:19031",
        token: "secret-value",
        dataDir: dir,
      });
      expect(resolveDesktopGateway({}, { BRANCH_GATEWAY_PORT: "19555" }, dir)?.url).toBe(
        "ws://127.0.0.1:19555",
      );
      expect(resolveDesktopGateway({ token: "explicit" }, {}, dir)).toBeUndefined();
      expect(resolveDesktopGateway({ url: "wss://remote.example" }, {}, dir)).toBeUndefined();
      expect(resolveDesktopGateway({ url: "wss://remote.example" }, {}, dir)).toBeUndefined();
      expect(resolveDesktopGateway({}, { BRANCH_GATEWAY_TOKEN: "env" }, dir)).toBeUndefined();
      expect(resolveDesktopGateway({}, {}, path.join(dir, "missing"))).toBeUndefined();
      // After an in-place update the desktop records the engine's live port; outside agents follow it.
      fs.writeFileSync(path.join(dir, "gateway-port"), "40123\r\n");
      expect(resolveDesktopGateway({}, {}, dir)?.url).toBe("ws://127.0.0.1:40123");
      expect(resolveDesktopGateway({}, { BRANCH_GATEWAY_PORT: "19555" }, dir)?.url).toBe(
        "ws://127.0.0.1:19555",
      );
      // Reconnects re-read the live port from the file; a launch-time env port never pins them.
      expect(liveDesktopGatewayUrl(dir)).toBe("ws://127.0.0.1:40123");
      for (const invalid of ["", "abc", "0", "70000", "12 34"]) {
        fs.writeFileSync(path.join(dir, "gateway-port"), invalid);
        expect(resolveDesktopGateway({}, {}, dir)?.url).toBe("ws://127.0.0.1:19031");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("run progress lines", () => {
  it("names text-less events by what they are", () => {
    expect(describeRunEvent({ stream: "run_status", data: { status: "running" } })).toBe(
      "run_status running",
    );
    expect(
      describeRunEvent({
        stream: "codex_app_server.item",
        data: { item: { type: "commandExecution" } },
      }),
    ).toBe("codex_app_server.item commandExecution");
    expect(describeRunEvent({ stream: "usage", data: { outputTokens: 12 } })).toBe(
      "usage 12 output tokens",
    );
    expect(describeRunEvent({ stream: "assistant", data: { text: "x" } })).toBeUndefined();
  });
});

describe("Settings › Grafts applies to every tool", () => {
  it("a disconnected agent can no longer read Trunks or answer approvals, and takes the id Branch assigns", async () => {
    let refuse = false;
    const presence = new OutsidePresence(async (agent) => {
      if (refuse) throw new Error("Claude Code was disconnected in Settings › Grafts.");
      return { contact: { id: `a2a:${agent.id}-2` } };
    });
    presence.start(claude);
    expect((await presence.identity())?.id).toBe("claude-code-2");
    const server = new McpServer({ name: "branch", version: "gate" });
    gateEveryTool(server, () => presence.assertAllowed());
    let answered = 0;
    server.tool("permissions_respond", "x", {}, async () => (answered++, { content: [] }));
    registerTrunkMcpTools(
      server,
      fakeGateway({ "agents.list": () => ({ agents: [] }), "contacts.list": () => ({}) }).gw,
      {
        outsideAgent: () => presence.identity(),
      },
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "Claude Code", version: "1" });
    clients.push(client);
    await Promise.all([server.connect(a), client.connect(b)]);
    expect((await client.callTool({ name: "trunks_list", arguments: {} })).isError).toBeFalsy();
    refuse = true;
    presence.activity("Reading Trunks");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const listed = await client.callTool({ name: "trunks_list", arguments: {} });
    const approved = await client.callTool({ name: "permissions_respond", arguments: {} });
    expect(listed.isError).toBe(true);
    expect(approved.isError).toBe(true);
    expect(answered).toBe(0);
    presence.stop();
  });
});

describe("an older Branch on the other side", () => {
  it("says hello again in the older shape instead of sending as the owner", async () => {
    const seen: Record<string, unknown>[] = [];
    const presence = new OutsidePresence(async (agent) => {
      seen.push({ ...agent });
      if ("instance" in agent || "project" in agent) {
        throw new Error(
          "invalid contacts.outside.hello params: at /agent: unexpected property 'project'",
        );
      }
      return { contact: { id: `a2a:${agent.id}` } };
    });
    presence.start({ ...claude, project: "Branch-Agent" });
    const identity = await presence.identity();
    expect(identity?.name).toBe("Claude Code");
    expect(seen.at(-1)).toEqual({
      id: claude.id,
      name: "Claude Code",
      version: "2.1.0",
      where: "LEGION",
    });
    presence.stop();
  });
});

describe("leaving", () => {
  it("says goodbye with the id Branch gave this session, once, and never hangs", async () => {
    const goodbyes: Record<string, unknown>[] = [];
    const presence = new OutsidePresence(
      async (agent) => ({ contact: { id: `a2a:${agent.id}-2` } }),
      () => undefined,
      async (agent) => goodbyes.push({ ...agent }),
    );
    presence.start(claude);
    await presence.identity();
    await presence.leave();
    expect(goodbyes).toHaveLength(1);
    expect(goodbyes[0]?.id).toBe("claude-code-2");
    const stuck = new OutsidePresence(
      async () => ({}),
      () => undefined,
      () => new Promise(() => undefined),
    );
    stuck.start(claude);
    await stuck.identity();
    const started = Date.now();
    await stuck.leave();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("supervising Trunks through Graft", () => {
  it("trunk_threads shows each thread's status, the run it works on and a stuck thread", async () => {
    const { gw } = fakeGateway({
      "contacts.topics": () => ({
        topics: [
          { key: "agent:oak:a", title: "P22", status: "working", unread: false },
          { key: "agent:oak:b", title: "P4", status: "working", unread: false },
          { key: "agent:oak:c", title: "Old", status: "active", unread: false },
        ],
      }),
      "sessions.list": () => ({
        sessions: [
          { key: "agent:oak:a", status: "running", hasActiveRun: true },
          { key: "agent:oak:b", status: "running", hasActiveRun: false },
          { key: "agent:oak:c", status: "done", abortedLastRun: true },
        ],
      }),
      "chat.history": (p) =>
        p.sessionKey === "agent:oak:a" ? { inFlightRun: { runId: "run-a" } } : {},
    });
    const out = await call(await connect(gw), "trunk_threads", { agent_id: "oak" });
    const threads = out.threads as Record<string, unknown>[];
    expect(threads[0]).toMatchObject({ key: "agent:oak:a", status: "running", run_id: "run-a" });
    expect(threads[1]).toMatchObject({
      key: "agent:oak:b",
      stuck: "status running but no active run",
    });
    expect(threads[1]).not.toHaveProperty("run_id");
    expect(threads[2]).toMatchObject({ key: "agent:oak:c", status: "done", last_run: "aborted" });
  });

  it("trunk_create sets the account order per provider", async () => {
    const { gw, calls } = fakeGateway({
      "agents.create": () => ({ agentId: "elm" }),
      "models.authStatus": () => ({ providers: [] }),
      "models.authOrderSet": () => ({ ok: true }),
    });
    const out = await call(await connect(gw), "trunk_create", {
      name: "Elm",
      accounts: ["openai-codex:b", "anthropic:work", "openai-codex:a"],
    });
    expect(calls.filter((c) => c.method === "models.authOrderSet").map((c) => c.params)).toEqual([
      {
        agentId: "elm",
        provider: "openai-codex",
        profileIds: ["openai-codex:b", "openai-codex:a"],
      },
      { agentId: "elm", provider: "anthropic", profileIds: ["anthropic:work"] },
    ]);
    expect(out.accounts).toEqual({
      "openai-codex": ["openai-codex:b", "openai-codex:a"],
      anthropic: ["anthropic:work"],
    });
  });
});
