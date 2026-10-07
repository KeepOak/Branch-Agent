// Part A against a real Branch engine: a scratch gateway (own home, profile, state and free loopback port; never
// the owner's app and never 3210/3299/3300/19021/19031/19032), the real `branch mcp serve` runtime, and an MCP client
// that names itself "Claude Code". It needs a built engine (branch.mjs + dist), so it runs when
// BRANCH_SCRATCH_ENGINE_DIR names one, e.g. the installed release's engine folder.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChannelMcpRuntime } from "./channel-server-runtime.js";
import { FORBIDDEN_PORTS, startScratchEngine, type ScratchEngine } from "./ui-target.js";

const engineDir = process.env.BRANCH_SCRATCH_ENGINE_DIR;

describe.runIf(Boolean(engineDir))("branch mcp serve against a scratch engine", () => {
  let engine: ScratchEngine;
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    engine = await startScratchEngine({ ...process.env, BRANCH_UI_ENGINE_DIR: engineDir });
    expect(FORBIDDEN_PORTS.has(Number(new URL(engine.url).port))).toBe(false);
    const runtime = await createChannelMcpRuntime({
      gatewayUrl: engine.url,
      gatewayToken: engine.token,
      config: {} as never,
      claudeChannelMode: "off",
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(a);
    await runtime.start();
    client = new Client({ name: "claude-code", title: "Claude Code", version: "test" } as never);
    await client.connect(b);
    close = async () => {
      await client.close();
      await runtime.close();
    };
  }, 240_000);

  afterAll(async () => {
    await close?.();
    engine?.stop();
  });

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args }, undefined, {
      timeout: 180_000,
    })) as {
      isError?: boolean;
      content?: { text?: string }[];
      structuredContent?: Record<string, unknown>;
    };
    if (result.isError) throw new Error(`${name}: ${result.content?.[0]?.text}`);
    return result.structuredContent ?? {};
  };

  it("lists the scratch engine's Trunks, creates one, and sees it working or idle", async () => {
    const before = (await call("trunks_list")).trunks as { id: string; state: string }[];
    expect(before.length).toBeGreaterThan(0);
    const created = await call("trunk_create", { name: "Scratch Scout" });
    expect(created.ready).toBe(true);
    const after = (await call("trunks_list")).trunks as {
      id: string;
      name: string;
      state: string;
    }[];
    expect(after.find((t) => t.id === created.agent_id)).toMatchObject({
      name: "Scratch Scout",
      state: "idle",
    });
  }, 240_000);

  it("shows the client as an outside-agent contact named by its MCP clientInfo", async () => {
    await call("trunks_list");
    const deadline = Date.now() + 15_000;
    let contacts: { id: string; name: string; kind: string }[] = [];
    while (Date.now() < deadline) {
      contacts = (await call("trunks_list")).contacts as typeof contacts;
      if (contacts.some((c) => c.kind === "outside")) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(contacts.find((c) => c.kind === "outside")?.name).toBe("Claude Code");
  });

  it("lists group chats and reads a Trunk's threads", async () => {
    expect((await call("rooms_list")).rooms).toEqual(expect.any(Array));
    const trunks = (await call("trunks_list")).trunks as { id: string }[];
    expect((await call("trunk_threads", { agent_id: trunks[0]!.id })).threads).toEqual(
      expect.any(Array),
    );
  });
});
