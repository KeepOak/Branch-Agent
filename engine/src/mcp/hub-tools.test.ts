import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { parseDoc, registerHubMcpTools, sha256, versionName } from "./hub-tools.js";
import type { TrunkGateway } from "./trunk-tools.js";

type Rec = Record<string, unknown>;

/**
 * A fake gateway that keeps state the way the engine does: one Trunk workspace (Documents/ and MEMORY.md),
 * exclusive document creation, hash-checked overwrites, and a Canopy card store.
 */
function fakeBranch() {
  const files = new Map<string, string>();
  const cards: Rec[] = [];
  const boards: Rec[] = [];
  const calls: { method: string; params: Rec }[] = [];
  const handlers: Record<string, (p: Rec) => unknown> = {
    "agents.list": () => ({
      defaultId: "main",
      agents: [{ id: "main" }, { id: "branch-project", name: "Branch project" }],
    }),
    "agents.documents.create": (p) => {
      const key = `Documents/${String(p.name)}`;
      if (files.has(key)) {
        throw new Error("A document with this name already exists");
      }
      files.set(key, String(p.content));
      return { file: { name: p.name } };
    },
    "agents.workspace.get": (p) => {
      const content = files.get(String(p.path));
      if (content === undefined) {
        throw new Error("workspace file not found");
      }
      return { file: { path: p.path, content } };
    },
    "agents.workspace.list": () => ({
      entries: [...files.keys()]
        .filter((k) => k.startsWith("Documents/"))
        .map((k) => ({
          name: k.slice(10),
          kind: "file",
          size: files.get(k)!.length,
          updatedAtMs: 1,
        })),
    }),
    "sessions.files.set": (p) => {
      const current = files.get(String(p.path));
      if (current === undefined) {
        throw new Error("session file not found");
      }
      if (sha256(current) !== p.expectedHash) {
        throw new Error("session file changed since it was read");
      }
      files.set(String(p.path), String(p.content));
      return {};
    },
    "agents.files.get": (p) => {
      const content = files.get(String(p.name));
      return {
        file:
          content === undefined
            ? { missing: true }
            : { missing: false, content, hash: sha256(content) },
      };
    },
    "agents.files.set": (p) => {
      const current = files.get(String(p.name));
      if (p.expectedMissing && current !== undefined) {
        throw new Error("exists");
      }
      if (p.expectedHash && sha256(current ?? "") !== p.expectedHash) {
        throw new Error("conflict");
      }
      files.set(String(p.name), String(p.content));
      return { ok: true };
    },
    "memory.search": (p) => ({
      results: [
        {
          path: "MEMORY.md",
          score: 0.9,
          snippet: `about ${String(p.query)}`,
          startLine: 3,
        },
      ],
    }),
    "canopy.boards.list": () => ({ boards }),
    "canopy.boards.upsert": (p) => {
      boards.push({ id: p.id, name: p.name });
      return { board: p };
    },
    "canopy.cards.list": (p) => ({
      cards: cards.filter((c) => c.boardId === p.boardId),
    }),
    "canopy.cards.create": (p) => {
      const card = {
        ...p,
        id: `card-${cards.length + 1}`,
        metadata: { ...(p.metadata as Rec) },
      };
      cards.push(card);
      return { card };
    },
    "canopy.cards.update": (p) => {
      const card = cards.find((c) => c.id === p.id)!;
      Object.assign(card, p.patch);
      return { card };
    },
    "canopy.cards.link": (p) =>
      mutateMeta(p, "links", { type: p.type, url: p.url, title: p.title }),
    "canopy.cards.comment": (p) => mutateMeta(p, "comments", { body: p.body, createdAt: 5 }),
    "canopy.cards.claim": (p) => {
      const card = cards.find((c) => c.id === p.id)!;
      (card.metadata as Rec).claim = { ownerId: p.ownerId };
      return { card, token: "tok-1" };
    },
  };
  function mutateMeta(p: Rec, field: string, value: Rec) {
    const card = cards.find((c) => c.id === p.id)!;
    const meta = card.metadata as Rec;
    meta[field] = [...((meta[field] as Rec[]) ?? []), value];
    return { card };
  }
  const gw: TrunkGateway = {
    async request(method, params) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) {
        throw new Error(`unknown method: ${method}`);
      }
      return handler(params) as never;
    },
    onGatewayEvent: () => () => undefined,
  };
  return { gw, files, cards, calls, handlers };
}

const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
});

async function connect(gw: TrunkGateway) {
  const server = new McpServer({ name: "branch", version: "test" });
  const agent = { id: "claude-code-36c22b", name: "Claude Code" };
  registerHubMcpTools(server, gw, {
    outsideAgent: () => agent,
    now: () => Date.UTC(2026, 9, 5, 20),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claude-code", version: "test" });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Rec = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content?: { text?: string }[];
      structuredContent?: Rec;
    };
    if (result.isError) {
      throw new Error(result.content?.[0]?.text);
    }
    return result.structuredContent ?? {};
  };
}

describe("Graft hub documents", () => {
  it("docs_write versions and attributes every write; docs_read reads any version; docs_list hides old versions", async () => {
    const { gw, files } = fakeBranch();
    const call = await connect(gw);
    const first = await call("docs_write", {
      name: "PLAN",
      text: "# Plan\nship it\n",
    });
    expect(first).toMatchObject({
      project: "branch-project",
      name: "PLAN.md",
      version: 1,
      created: true,
    });
    const read = await call("docs_read", { name: "PLAN.md" });
    expect(read).toMatchObject({
      version: 1,
      by: "Claude Code (claude-code-36c22b)",
      text: "# Plan\nship it\n",
    });

    const second = await call("docs_write", {
      name: "PLAN.md",
      text: "# Plan\nshipped\n",
      expected_hash: read.hash,
      note: "done",
    });
    expect(second).toMatchObject({ version: 2, created: false });
    expect(parseDoc(files.get(`Documents/${versionName("PLAN.md", 1)}`)!).body).toBe(
      "# Plan\nship it\n",
    );
    expect(await call("docs_read", { name: "PLAN.md", version: 1 })).toMatchObject({
      version: 1,
      latest_version: 2,
      text: "# Plan\nship it\n",
    });
    expect((await call("docs_read", { name: "PLAN.md" })).text).toBe("# Plan\nshipped\n");
    expect((await call("docs_list")).docs).toEqual([
      expect.objectContaining({ name: "PLAN.md", versions: 2 }),
    ]);
  });

  it("docs_write refuses a stale hash and a document over 240 KiB, and never takes folders", async () => {
    const { gw } = fakeBranch();
    const call = await connect(gw);
    await call("docs_write", { name: "A.md", text: "one" });
    await expect(
      call("docs_write", {
        name: "A.md",
        text: "two",
        expected_hash: "0".repeat(64),
      }),
    ).rejects.toThrow(/changed since you read it/);
    await expect(
      call("docs_write", { name: "B.md", text: "x".repeat(241 * 1024) }),
    ).rejects.toThrow(/split it into parts/);
    await expect(call("docs_write", { name: "dir/C.md", text: "x" })).rejects.toThrow(/no folders/);
  });

  it("docs_search returns matching lines per document, without the attribution line", async () => {
    const { gw } = fakeBranch();
    const call = await connect(gw);
    await call("docs_write", { name: "A.md", text: "alpha graft hub\nbeta\n" });
    await call("docs_write", { name: "B.md", text: "nothing here\n" });
    const found = await call("docs_search", { query: "Graft HUB" });
    expect(found.results).toEqual([{ name: "A.md", hits: [{ line: 1, text: "alpha graft hub" }] }]);
  });
});

describe("Graft hub memory", () => {
  it("memory_write appends an attributed, dated line to MEMORY.md with a hash check; memory_search reads hits", async () => {
    const { gw, files, calls } = fakeBranch();
    const call = await connect(gw);
    await call("memory_write", {
      text: "Builders  push through the merge gate",
    });
    await call("memory_write", { text: "CI is capped at 15 minutes" });
    expect(files.get("MEMORY.md")).toBe(
      "# Memory\n\n- 2026-10-05 (Claude Code): Builders push through the merge gate\n- 2026-10-05 (Claude Code): CI is capped at 15 minutes\n",
    );
    expect(calls.findLast((c) => c.method === "agents.files.set")?.params.expectedHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    const hits = await call("memory_search", { query: "merge gate" });
    expect(hits).toMatchObject({
      project: "branch-project",
      hits: [{ path: "MEMORY.md", text: "about merge gate", line: 3 }],
    });
  });
});

describe("Graft hub board", () => {
  it("board_create is idempotent by key, links PRs once, and makes the Branch board on first use", async () => {
    const { gw, cards, calls } = fakeBranch();
    const call = await connect(gw);
    const pr = "https://github.com/KeepOak/Branch-Agent/pull/242";
    const a = await call("board_create", {
      title: "P12 animated Trunks",
      key: "P12",
      status: "review",
      pr_urls: [pr],
    });
    const b = await call("board_create", {
      title: "P12 animated Trunks",
      key: "P12",
      status: "review",
      pr_urls: [pr],
    });
    expect(cards).toHaveLength(1);
    expect((a.card as Rec).id).toBe((b.card as Rec).id);
    expect(b.card).toMatchObject({ status: "review", prs: [pr] });
    expect(calls.filter((c) => c.method === "canopy.boards.upsert")).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      boardId: "branch",
      idempotencyKey: "graft:branch:P12",
    });
  });

  it("board_claim owns the card as this agent, board_comment carries its name, board_update moves and links", async () => {
    const { gw } = fakeBranch();
    const call = await connect(gw);
    const { card } = (await call("board_create", {
      title: "P7 live activity",
    })) as { card: Rec };
    expect(await call("board_claim", { card_id: card.id })).toMatchObject({
      token: "tok-1",
      card: { owner: "claude-code-36c22b" },
    });
    expect(await call("board_comment", { card_id: card.id, text: "taking this" })).toMatchObject({
      card: { comments: [{ text: "Claude Code: taking this" }] },
    });
    const updated = await call("board_update", {
      card_id: card.id,
      status: "done",
      pr_url: "https://github.com/KeepOak/Branch-Agent/pull/241",
    });
    expect(updated.card).toMatchObject({
      status: "done",
      prs: ["https://github.com/KeepOak/Branch-Agent/pull/241"],
    });
    expect((await call("board_list", { status: "done" })).cards).toHaveLength(1);
  });
});

describe("Graft hub activity feed", () => {
  it("activity_feed says who is working on what with run ids, then grafted agents, then recent work", async () => {
    const { gw, handlers } = fakeBranch();
    const now = Date.now();
    handlers["agents.list"] = () => ({
      agents: [
        { id: "builder-oak", identity: { name: "Builder Oak" } },
        { id: "main", name: "TK" },
      ],
    });
    handlers["sessions.list"] = (p) => ({
      sessions:
        p.agentId === "builder-oak"
          ? [
              {
                key: "agent:builder-oak:t1",
                label: "P38 startup races",
                status: "running",
                activeWriterRunId: "run-9",
                activitySummary: {
                  text: "editing the watchdog",
                  state: "current",
                },
              },
            ]
          : [
              {
                key: "agent:main:t2",
                label: "Morning brief",
                status: "done",
                updatedAt: now - 5 * 60_000,
              },
            ],
    });
    handlers["contacts.outside.list"] = () => ({
      agents: [
        {
          id: "codex",
          name: "Codex",
          where: "LEGION",
          online: true,
          activity: "Messaging builder-oak",
        },
        { id: "old", name: "Hermes", online: false },
      ],
    });
    const call = await connect(gw);
    const feed = await call("activity_feed");
    expect(feed.lines).toEqual([
      "Builder Oak is working on P38 startup races (run run-9) - editing the watchdog",
      "Codex (grafted, LEGION) is messaging builder-oak",
      "TK worked on Morning brief 5 min ago",
    ]);
    expect(feed.working).toEqual([
      expect.objectContaining({
        trunk: "builder-oak",
        run_id: "run-9",
        thread: "agent:builder-oak:t1",
      }),
    ]);
  });
});

describe("Graft hub project instructions", () => {
  it("project_instructions reads and replaces the project Trunk's AGENTS.md with a hash check", async () => {
    const { gw, files, calls } = fakeBranch();
    const call = await connect(gw);
    expect(await call("project_instructions")).toMatchObject({
      project: "branch-project",
      text: "",
      hash: null,
    });
    await call("project_instructions", { text: "# Continue here\n" });
    expect(files.get("AGENTS.md")).toBe("# Continue here\n");
    const read = await call("project_instructions");
    await call("project_instructions", {
      text: "# Continue here v2\n",
      expected_hash: read.hash,
    });
    expect(
      calls.filter((c) => c.method === "agents.files.set").map((c) => Object.keys(c.params).at(-1)),
    ).toEqual(["expectedMissing", "expectedHash"]);
    await expect(
      call("project_instructions", { text: "stale", expected_hash: read.hash }),
    ).rejects.toThrow(/conflict/);
  });
});

describe("Graft hub board without Canopy", () => {
  it("board tools say the Canopy plugin is off instead of 'unknown method'", async () => {
    const { gw, handlers } = fakeBranch();
    for (const method of Object.keys(handlers).filter((m) => m.startsWith("canopy."))) {
      Reflect.deleteProperty(handlers, method);
    }
    const call = await connect(gw);
    await expect(call("board_list")).rejects.toThrow(/Canopy plugin, which is off on this Branch/);
  });
});

describe("Graft hub project choice", () => {
  it("never falls back to another Trunk's Library when there is no project Trunk", async () => {
    const { gw, handlers, calls } = fakeBranch();
    handlers["agents.list"] = () => ({ defaultId: "tk", agents: [{ id: "tk" }] });
    const call = await connect(gw);
    await expect(call("docs_write", { name: "A.md", text: "x" })).rejects.toThrow(
      /no "branch-project" Trunk/,
    );
    expect(calls.some((c) => c.method === "agents.documents.create")).toBe(false);
    expect(await call("docs_list", { project: "tk" })).toMatchObject({ project: "tk", docs: [] });
  });
});
