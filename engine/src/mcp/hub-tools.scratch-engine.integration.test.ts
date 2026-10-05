// The Graft hub tools against a real Branch engine: a scratch gateway (own home, state and free loopback port;
// never the owner's app), the real `branch graft` runtime, and an MCP client that names itself "Claude Code".
// It needs a built engine, so it runs when BRANCH_SCRATCH_ENGINE_DIR names one (e.g. an installed release's
// engine folder). The Canopy plugin is off by default, so the test turns it on the way an owner would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createChannelMcpRuntime } from "./channel-server-runtime.js";
import { FORBIDDEN_PORTS, startScratchEngine, type ScratchEngine } from "./ui-target.js";

const engineDir = process.env.BRANCH_SCRATCH_ENGINE_DIR;
type Rec = Record<string, unknown>;

describe.runIf(Boolean(engineDir))("Graft hub tools against a scratch engine", () => {
  let engine: ScratchEngine;
  let client: Client;
  let request: (method: string, params: Rec) => Promise<Rec>;
  let close: () => Promise<void>;

  beforeAll(async () => {
    engine = await startScratchEngine({
      ...process.env,
      BRANCH_UI_ENGINE_DIR: engineDir,
    });
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
    request = (method, params) => runtime.bridge.request<Rec>(method, params);
    const config = await request("config.get", {});
    await request("config.patch", {
      baseHash: config.hash,
      raw: JSON.stringify({
        plugins: { entries: { canopy: { enabled: true } } },
      }),
    });
    client = new Client({
      name: "claude-code",
      title: "Claude Code",
      version: "test",
    } as never);
    await client.connect(b);
    close = async () => {
      await client.close();
      await runtime.close();
    };
  }, 300_000);

  afterAll(async () => {
    await close?.();
    engine?.stop();
  });

  const call = async (name: string, args: Rec = {}) => {
    const result = (await client.callTool({ name, arguments: args }, undefined, {
      timeout: 180_000,
    })) as {
      isError?: boolean;
      content?: { text?: string }[];
      structuredContent?: Rec;
    };
    if (result.isError) {
      throw new Error(`${name}: ${result.content?.[0]?.text}`);
    }
    return result.structuredContent ?? {};
  };

  it("keeps project documents versioned and attributed in the project Trunk's Library", async () => {
    const created = await call("trunk_create", { name: "Branch" });
    expect(created.ready).toBe(true);
    const project = String(created.agent_id);
    const first = await call("docs_write", {
      project,
      name: "PLAN.md",
      text: "# Plan\nv1\n",
    });
    expect(first).toMatchObject({ version: 1, created: true });
    const read = await call("docs_read", { project, name: "PLAN.md" });
    expect(read.by).toMatch(/^Claude Code \(/);
    await call("docs_write", {
      project,
      name: "PLAN.md",
      text: "# Plan\nv2\n",
      expected_hash: read.hash,
    });
    expect(await call("docs_read", { project, name: "PLAN.md" })).toMatchObject({
      version: 2,
      text: "# Plan\nv2\n",
    });
    expect(await call("docs_read", { project, name: "PLAN.md", version: 1 })).toMatchObject({
      text: "# Plan\nv1\n",
    });
    expect((await call("docs_list", { project })).docs).toEqual([
      expect.objectContaining({ name: "PLAN.md", versions: 2 }),
    ]);
    expect((await call("docs_search", { project, query: "plan v2" })).results).toHaveLength(1);
    // The window's Library lists the same document (and hides the kept version).
    const library = await request("agents.workspace.list", {
      agentId: project,
      path: "Documents",
    });
    expect((library.entries as Rec[]).map((e) => e.name)).toContain("PLAN.md");
  }, 300_000);

  it("writes project memory and instructions", async () => {
    await call("memory_write", {
      project: "branch",
      text: "Graft is the hub",
    });
    const memory = await request("agents.files.get", {
      agentId: "branch",
      name: "MEMORY.md",
    });
    expect(String((memory.file as Rec).content)).toMatch(/\(Claude Code\): Graft is the hub/);
    await call("project_instructions", {
      project: "branch",
      text: "# Continue here\n",
    });
    expect((await call("project_instructions", { project: "branch" })).text).toBe(
      "# Continue here\n",
    );
    expect((await call("memory_search", { project: "branch", query: "hub" })).hits).toEqual(
      expect.any(Array),
    );
  }, 120_000);

  it("creates, claims, comments on, moves and links board cards, once per key", async () => {
    const pr = "https://github.com/KeepOak/Branch-Agent/pull/242";
    const a = (
      await call("board_create", {
        title: "P12 animated Trunks",
        key: "P12",
        status: "review",
        pr_urls: [pr],
      })
    ).card as Rec;
    const b = (
      await call("board_create", {
        title: "P12 animated Trunks",
        key: "P12",
        status: "review",
        pr_urls: [pr],
      })
    ).card as Rec;
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ status: "review", prs: [pr] });
    const claimed = await call("board_claim", { card_id: a.id });
    expect(claimed.card).toMatchObject({
      owner: expect.stringMatching(/^claude-code/),
    });
    expect((await call("board_comment", { card_id: a.id, text: "on it" })).card).toMatchObject({
      comments: [expect.objectContaining({ text: "Claude Code: on it" })],
    });
    expect((await call("board_list")).cards).toHaveLength(1);
  }, 120_000);

  it("reports activity as lines", async () => {
    const feed = await call("activity_feed");
    expect(feed.lines).toEqual(expect.any(Array));
    expect((feed.lines as string[]).some((l) => /Claude Code \(grafted/.test(l))).toBe(true);
  }, 120_000);
});
