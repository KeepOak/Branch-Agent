import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { registerTrunkStatusTools, type StatusGateway } from "./trunk-status-tools.js";

type Call = { method: string; params: Record<string, unknown> };

/** Fake gateway: canned answers per method; every call is recorded so tests can prove what was read. */
function fakeGateway(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const gw: StatusGateway = {
    async request(method, params) {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) {
        throw new Error(`unexpected ${method}`);
      }
      return (await answer(params)) as never;
    },
  };
  return { gw, calls };
}

const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
});

async function connect(gw: StatusGateway) {
  const server = new McpServer({ name: "branch", version: "test" });
  registerTrunkStatusTools(server, gw);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "Claude Code", version: "2.1.0" });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return await client.callTool({ name, arguments: args });
}

describe("branch mcp serve status tools", () => {
  it("registers only the three read-only status tools", async () => {
    const { gw } = fakeGateway({});
    const client = await connect(gw);
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["computer_status", "memory_status", "skills_status"]);
  });

  it("skills_status reads skills.status and reports how many skills it lists", async () => {
    const { gw, calls } = fakeGateway({
      "skills.status": () => ({ skills: [{ name: "pond" }, { name: "tide" }] }),
    });
    const client = await connect(gw);
    const result = await call(client, "skills_status");
    expect(calls).toEqual([{ method: "skills.status", params: {} }]);
    expect(result.structuredContent).toEqual({ skills: [{ name: "pond" }, { name: "tide" }] });
    expect(JSON.stringify(result.content)).toContain("2 skills");
  });

  it("passes agentId to skills.status only when the caller names one", async () => {
    const { gw, calls } = fakeGateway({ "skills.status": () => ({ skills: [] }) });
    const client = await connect(gw);
    await call(client, "skills_status", { agentId: "builder-maple" });
    expect(calls[0]).toEqual({ method: "skills.status", params: { agentId: "builder-maple" } });
  });

  it("memory_status reads memory.status and returns its answer", async () => {
    const { gw, calls } = fakeGateway({
      "memory.status": () => ({ agentId: "tk", entries: 0, scope: "project" }),
    });
    const client = await connect(gw);
    const result = await call(client, "memory_status", { agentId: "tk" });
    expect(calls).toEqual([{ method: "memory.status", params: { agentId: "tk" } }]);
    expect(result.structuredContent).toEqual({ agentId: "tk", entries: 0, scope: "project" });
  });

  it("computer_status reads computer.status and says whether control is available", async () => {
    const { gw, calls } = fakeGateway({
      "computer.status": () => ({ configured: true, available: false, error: "no display" }),
    });
    const client = await connect(gw);
    const result = await call(client, "computer_status");
    expect(calls).toEqual([{ method: "computer.status", params: {} }]);
    expect(JSON.stringify(result.content)).toContain("unavailable");
  });

  it("only ever calls the three read methods, whichever tool runs", async () => {
    const { gw, calls } = fakeGateway({
      "skills.status": () => ({ skills: [] }),
      "memory.status": () => ({ entries: 0 }),
      "computer.status": () => ({ configured: false, available: false }),
    });
    const client = await connect(gw);
    await call(client, "skills_status");
    await call(client, "memory_status");
    await call(client, "computer_status");
    expect(calls.map((c) => c.method).sort()).toEqual([
      "computer.status",
      "memory.status",
      "skills.status",
    ]);
  });

  it("reports a gateway refusal as a tool error", async () => {
    const { gw } = fakeGateway({
      "memory.status": () => {
        throw new Error("unknown agentId");
      },
    });
    const client = await connect(gw);
    const result = await call(client, "memory_status", { agentId: "nobody" });
    expect(result.isError).toBe(true);
  });
});
