import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectComputerStatus,
  projectSkillsStatus,
  registerTrunkStatusTools,
  scrubPaths,
  type StatusGateway,
} from "./trunk-status-tools.js";

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

// Answers shaped like the real handlers' output (skills status report, memory handler response, computer status).
const SKILLS_REPORT = {
  workspaceDir: "/Users/someone/work/branch-workspace",
  managedSkillsDir: "/Users/someone/.branch/skills",
  agentId: "builder-maple",
  agentSkillFilter: undefined,
  skills: [
    {
      name: "pond",
      description: "Pond skill",
      source: "branch-bundled",
      bundled: true,
      filePath: "/Users/someone/work/branch-workspace/skills/pond/SKILL.md",
      baseDir: "/Users/someone/work/branch-workspace/skills/pond",
      disabled: false,
      blockedByAllowlist: false,
      eligible: true,
      missing: { bins: [], env: [], config: [], os: [] },
      modelVisible: true,
      userInvocable: true,
      commandVisible: true,
      blockedByAgentFilter: false,
      platformIncompatible: false,
      install: [{ id: "brew", command: "brew install pond" }],
      skillCard: {
        present: true,
        path: "/Users/someone/work/branch-workspace/skills/pond/CARD.md",
        sizeBytes: 120,
      },
    },
    {
      name: "tide",
      source: "workspace",
      disabled: true,
      eligible: false,
      modelVisible: false,
      userInvocable: false,
      blockedByAgentFilter: false,
      platformIncompatible: true,
      filePath: "/Users/someone/work/branch-workspace/skills/tide/SKILL.md",
      baseDir: "/Users/someone/work/branch-workspace/skills/tide",
    },
  ],
};

const MEMORY_RESPONSE = {
  version: 2,
  agentId: "tk",
  providerId: "builtin",
  status: "degraded",
  message: "sync failed reading /Users/someone/.branch/agents/tk/memory.sqlite",
  details: {
    legacy: {
      backend: "builtin",
      provider: "openai",
      model: "text-embedding-3-small",
      files: 4,
      chunks: 37,
      dirty: false,
      workspaceDir: "/Users/someone/work/branch-workspace",
      dbPath: "/Users/someone/.branch/agents/tk/memory.sqlite",
      extraPaths: [{ path: "/Users/someone/notes" }],
      sourceCounts: [
        {
          source: "memory",
          files: 4,
          chunks: 37,
          chunkBytes: 9000,
          eligible: 4,
          issues: ["stale"],
        },
      ],
      storage: {
        databaseBytes: 1000,
        walBytes: 10,
        reusableBytes: 5,
        embeddingCacheBytes: 80,
        embeddingCacheEntries: 12,
      },
      custom: { indexIdentity: { status: "matched", root: "C:\\Users\\someone\\memory" } },
    },
  },
};

const COMPUTER_STATUS = {
  configured: true,
  available: true,
  computerUse: {
    contractVersion: 2,
    provider: { id: "branch-computer", label: "Branch computer", generation: "1.2.0" },
    actions: ["screen.snapshot", "computer.act"],
    targets: ["screen", "window"],
    deliveryModes: ["background"],
    observations: ["image"],
    features: { recording: false, agentCursor: true, multiDisplay: false },
  },
};

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

/** Every string an outside agent receives from a tool: structured content and text content. */
function everythingSent(result: { content: unknown; structuredContent?: unknown }): string {
  return JSON.stringify([result.structuredContent, result.content]);
}

const ABSOLUTE_PATH = /(?:^|[^\w])(?:\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\)/;

describe("branch mcp serve status tools", () => {
  it("registers only the three read-only status tools", async () => {
    const { gw } = fakeGateway({});
    const client = await connect(gw);
    const names = (await client.listTools()).tools.map((tool) => tool.name).toSorted();
    expect(names).toEqual(["computer_status", "memory_status", "skills_status"]);
  });

  it("skills_status keeps names, sources and flags, and drops paths, install commands and skill cards", () => {
    const projected = projectSkillsStatus(SKILLS_REPORT);
    expect(projected).toEqual({
      agentId: "builder-maple",
      total: 2,
      eligible: 1,
      modelVisible: 1,
      skills: [
        {
          name: "pond",
          source: "branch-bundled",
          bundled: true,
          enabled: true,
          eligible: true,
          modelVisible: true,
          userInvocable: true,
          blockedByAgentFilter: false,
          platformIncompatible: false,
        },
        {
          name: "tide",
          source: "workspace",
          bundled: undefined,
          enabled: false,
          eligible: false,
          modelVisible: false,
          userInvocable: false,
          blockedByAgentFilter: false,
          platformIncompatible: true,
        },
      ],
    });
  });

  it("skills_status never sends filePath, baseDir or any absolute path to the outside agent", async () => {
    const { gw, calls } = fakeGateway({ "skills.status": () => SKILLS_REPORT });
    const client = await connect(gw);
    const result = await call(client, "skills_status");
    expect(calls).toEqual([{ method: "skills.status", params: {} }]);
    const sent = everythingSent(result as never);
    expect(sent).not.toContain("filePath");
    expect(sent).not.toContain("baseDir");
    expect(sent).not.toContain("/Users/");
    expect(ABSOLUTE_PATH.test(sent)).toBe(false);
  });

  it("passes agentId to skills.status only when the caller names one", async () => {
    const { gw, calls } = fakeGateway({ "skills.status": () => ({ skills: [] }) });
    const client = await connect(gw);
    await call(client, "skills_status", { agentId: "builder-maple" });
    expect(calls[0]).toEqual({ method: "skills.status", params: { agentId: "builder-maple" } });
  });

  it("memory_status keeps the provider, health and counts from the real response, and drops paths and custom fields", async () => {
    const { gw, calls } = fakeGateway({ "memory.status": () => MEMORY_RESPONSE });
    const client = await connect(gw);
    const result = await call(client, "memory_status", { agentId: "tk" });
    expect(calls).toEqual([{ method: "memory.status", params: { agentId: "tk" } }]);
    expect(result.structuredContent).toEqual({
      agentId: "tk",
      providerId: "builtin",
      status: "degraded",
      message: "sync failed reading [path]",
      backend: "builtin",
      provider: "openai",
      model: "text-embedding-3-small",
      files: 4,
      chunks: 37,
      dirty: false,
      sourceCounts: [{ source: "memory", files: 4, chunks: 37 }],
      storageEntries: 12,
    });
    const sent = everythingSent(result as never);
    expect(sent).not.toContain("workspaceDir");
    expect(sent).not.toContain("dbPath");
    expect(sent).not.toContain("extraPaths");
    expect(sent).not.toContain("custom");
    expect(ABSOLUTE_PATH.test(sent)).toBe(false);
    expect(sent).not.toContain("C:\\");
  });

  it("scrubPaths replaces POSIX and Windows absolute paths, and leaves other text alone", () => {
    expect(scrubPaths("read /Users/a/b.sqlite and C:\\x\\y then ok")).toBe(
      "read [path] and [path] then ok",
    );
    expect(scrubPaths("no paths here")).toBe("no paths here");
  });

  it("computer_status reports configured, available and the supported actions, and reduces errors to a flag", async () => {
    const { gw, calls } = fakeGateway({ "computer.status": () => COMPUTER_STATUS });
    const client = await connect(gw);
    const result = await call(client, "computer_status");
    expect(calls).toEqual([{ method: "computer.status", params: {} }]);
    expect(result.structuredContent).toEqual({
      configured: true,
      available: true,
      actions: ["screen.snapshot", "computer.act"],
      targets: ["screen", "window"],
      hasError: false,
    });
  });

  it("computer_status drops free-text error details", () => {
    const projected = projectComputerStatus({
      configured: true,
      available: false,
      error: "display C:\\secret\\driver failed",
    });
    expect(projected).toEqual({
      configured: true,
      available: false,
      actions: [],
      targets: [],
      hasError: true,
    });
    expect(JSON.stringify(projected)).not.toContain("secret");
  });

  it("only ever calls the three read methods, whichever tool runs", async () => {
    const { gw, calls } = fakeGateway({
      "skills.status": () => SKILLS_REPORT,
      "memory.status": () => MEMORY_RESPONSE,
      "computer.status": () => COMPUTER_STATUS,
    });
    const client = await connect(gw);
    await call(client, "skills_status");
    await call(client, "memory_status");
    await call(client, "computer_status");
    expect(calls.map((c) => c.method).toSorted()).toEqual([
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
