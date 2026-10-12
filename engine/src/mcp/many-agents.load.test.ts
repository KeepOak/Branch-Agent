// Load: 6 Hermes and 10 Claude Code clients at once, each with its own MCP session and identity, each sending
// to a Trunk and waiting for its reply. Nothing may be lost or crossed, and the waits must overlap (no global
// lock in the bridge): the whole round takes about one run, not sixteen.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { EventFrame } from "../../packages/gateway-protocol/src/index.js";
import { outsideAgentFromClient } from "./outside-presence.js";
import { registerTrunkMcpTools, type TrunkGateway } from "./trunk-tools.js";

const RUN_MS = 300;

/** One gateway shared by every client, with per-thread transcripts and runs that take RUN_MS each. */
function sharedGateway() {
  const threads = new Map<string, Record<string, unknown>[]>();
  const runs = new Map<string, Promise<void>>();
  let next = 0;
  const gw: TrunkGateway = {
    async request(method, params) {
      const key = String(params.sessionKey ?? params.key ?? "");
      if (method === "sessions.create") {
        if (threads.has(key)) throw new Error(`thread created twice: ${key}`);
        threads.set(key, []);
        return {} as never;
      }
      if (method === "chat.send") {
        const runId = `run-${++next}`;
        const transcript = threads.get(key)!;
        transcript.push({
          role: "user",
          content: params.message,
          __branch: { senderName: (params.outsideAgent as { name: string }).name },
        });
        runs.set(
          runId,
          new Promise((resolve) =>
            setTimeout(() => {
              transcript.push({
                role: "assistant",
                content: `echo: ${String(params.message)}`,
                __branch: { runId },
              });
              resolve();
            }, RUN_MS),
          ),
        );
        return { runId, status: "started" } as never;
      }
      if (method === "agent.wait") {
        await runs.get(String(params.runId));
        return { status: "ok" } as never;
      }
      if (method === "chat.history") return { messages: threads.get(key) ?? [] } as never;
      throw new Error(`unexpected ${method}`);
    },
    onGatewayEvent: (_listener: (event: EventFrame) => void) => () => undefined,
  };
  return { gw, threads };
}

describe("many outside agents at once", () => {
  it("16 concurrent clients each get their own thread and their own reply, in about one run's time", async () => {
    const { gw, threads } = sharedGateway();
    const clients = await Promise.all(
      Array.from({ length: 16 }, async (_, i) => {
        const product = i < 6 ? { name: "hermes", title: "Hermes Agent" } : { name: "claude-code" };
        const agent = outsideAgentFromClient(
          { ...product, version: "1" },
          "LEGION",
          `/work/project-${i}`,
        )!;
        const server = new McpServer({ name: "branch", version: "load" });
        registerTrunkMcpTools(server, gw, { outsideAgent: async () => agent });
        const [a, b] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: product.name, version: "1" });
        await Promise.all([server.connect(a), client.connect(b)]);
        return { agent, client };
      }),
    );
    expect(new Set(clients.map((c) => c.agent.id)).size).toBe(16);
    const started = Date.now();
    const results = await Promise.all(
      clients.map(async ({ agent, client }, i) => {
        const t0 = Date.now();
        const text = `ping ${i} from ${agent.id}`;
        const sent = (
          await client.callTool({ name: "trunk_send", arguments: { agent_id: "oak", text } })
        ).structuredContent as Record<string, string>;
        const waited = (
          await client.callTool({
            name: "run_wait",
            arguments: { run_id: sent.run_id, thread_key: sent.thread_key, timeout_ms: 10_000 },
          })
        ).structuredContent as Record<string, string>;
        return { text, sent, waited, ms: Date.now() - t0 };
      }),
    );
    const total = Date.now() - started;
    for (const { text, sent, waited } of results) {
      expect(waited.status).toBe("ok");
      expect(waited.reply).toBe(`echo: ${text}`);
      expect(
        threads
          .get(sent.thread_key)
          ?.filter((m) => m.role === "user")
          .map((m) => m.content),
      ).toEqual([text]);
    }
    expect(new Set(results.map((r) => r.sent.thread_key)).size).toBe(16);
    expect(new Set(results.map((r) => r.sent.run_id)).size).toBe(16);
    // Serialised, 16 runs would take 16 x RUN_MS = 4.8 s.
    expect(total).toBeLessThan(RUN_MS * 4);
    expect(Math.max(...results.map((r) => r.ms))).toBeLessThan(RUN_MS * 4);
    await Promise.all(clients.map(({ client }) => client.close()));
  });
});
