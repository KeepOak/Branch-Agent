import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listOutsideAgentIdentityIds } from "branch/plugin-sdk/memory-core-host-runtime-core";
import type { MemorySearchResult } from "branch/plugin-sdk/memory-core-host-runtime-files";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemorySearchDeadlineError } from "./memory/search-deadline.js";
import {
  resolveTeamMemberIds,
  searchTeamMemory,
  type TeamMemoryLookup,
} from "./team-memory-search.js";
import { createMemorySearchTool } from "./tools.js";
import { asBranchConfig } from "./tools.test-helpers.js";

let workspace: string;
let root: string;
let stateDir: string;
let savedStateDir: string | undefined;

const OUTSIDE_REGISTRY = [
  {
    id: "builder-linked",
    name: "Linked Branch",
    kind: "branch",
    deviceId: "device-7f3a",
    activity: "Messaging builder-a",
    project: "private-project",
    firstSeenAt: 1,
    lastSeenAt: 2,
  },
  {
    id: "builder-desk",
    name: "Grafted Trunk",
    kind: "trunk",
    trunkId: "builder-grafted",
    via: "builder-linked",
    firstSeenAt: 1,
    lastSeenAt: 2,
  },
];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "team-memory-"));
  savedStateDir = process.env.BRANCH_STATE_DIR;
  stateDir = path.join(root, "state");
  process.env.BRANCH_STATE_DIR = stateDir;
  await fs.mkdir(path.join(stateDir, "contacts"), { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "contacts", "outside-agents.json"),
    JSON.stringify(OUTSIDE_REGISTRY),
  );
  workspace = path.join(root, "builder-a");
  const outside = path.join(root, "outside");
  await fs.mkdir(path.join(workspace, "memory"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "notes.md"), "private outside notes\n");
  await fs.writeFile(path.join(workspace, "USER.md"), "owner profile\n");
  await fs.writeFile(path.join(workspace, "SOUL.md"), "agent soul\n");
  await fs.writeFile(path.join(workspace, "MEMORY.md"), "durable note\n");
  await fs.writeFile(path.join(workspace, "memory", "ok.md"), "durable note\n");
  await fs.writeFile(path.join(workspace, "memory", "USER.md"), "owner profile copy\n");
  await fs.symlink(path.join(outside, "notes.md"), path.join(workspace, "memory", "link.md"));
  await fs.symlink(path.join(workspace, "USER.md"), path.join(workspace, "memory", "profile.md"));
});

afterEach(async () => {
  if (savedStateDir === undefined) {
    delete process.env.BRANCH_STATE_DIR;
  } else {
    process.env.BRANCH_STATE_DIR = savedStateDir;
  }
  await fs.rm(root, { recursive: true, force: true });
});

function createTeamTool(params: Parameters<typeof createMemorySearchTool>[0]) {
  const tool = createMemorySearchTool(params);
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

function hit(overrides: Partial<MemorySearchResult>): MemorySearchResult {
  return {
    path: "memory/ok.md",
    startLine: 1,
    endLine: 2,
    score: 0.5,
    snippet: "note",
    source: "memory",
    ...overrides,
  };
}

function managerReturning(
  results: MemorySearchResult[],
  workspaceDir: string | undefined = workspace,
): TeamMemoryLookup {
  return {
    manager: {
      search: async () => results,
      status: () => ({ workspaceDir }),
    },
  };
}

describe("resolveTeamMemberIds", () => {
  const roster = {
    defaultId: "main",
    entries: { main: {}, "builder-a": {}, "builder-b": {}, personal: {} },
  };

  it("is opt-in: with no owner list, no Trunk is a member", () => {
    expect(resolveTeamMemberIds(asBranchConfig({ agents: roster }))).toEqual([]);
  });

  it("uses only the owner's explicit list, dropping ids that are not configured agents", () => {
    const listed = asBranchConfig({
      agents: { ...roster, teamMemory: { agents: ["main", "builder-b", "outside-branch"] } },
    });

    expect(resolveTeamMemberIds(listed)).toEqual(["main", "builder-b"]);
  });

  it("excludes registry outside Branches and grafted Trunks even when listed under builder-* ids", () => {
    const listed = asBranchConfig({
      agents: {
        defaultId: "main",
        entries: { main: {}, "builder-linked": {}, "builder-grafted": {}, "builder-a": {} },
        teamMemory: { agents: ["builder-linked", "builder-grafted", "builder-a"] },
      },
    });

    expect(resolveTeamMemberIds(listed)).toEqual(["builder-a"]);
  });

  it("exposes only outside ids and grafted Trunk ids from the registry", () => {
    const ids = listOutsideAgentIdentityIds();

    expect(ids).toEqual(["builder-desk", "builder-grafted", "builder-linked"]);
    expect(JSON.stringify(ids)).not.toContain("device-7f3a");
    expect(JSON.stringify(ids)).not.toContain("private-project");
  });

  it("excludes nothing when the registry file is missing", async () => {
    await fs.rm(path.join(stateDir, "contacts"), { recursive: true, force: true });
    const listed = asBranchConfig({
      agents: {
        defaultId: "main",
        entries: { main: {}, "builder-a": {} },
        teamMemory: { agents: ["builder-a"] },
      },
    });

    expect(listOutsideAgentIdentityIds()).toEqual([]);
    expect(resolveTeamMemberIds(listed)).toEqual(["builder-a"]);
  });
});

describe("searchTeamMemory", () => {
  it("never opens an unlisted agent, even when it would score highest", async () => {
    const opened: string[] = [];
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "decision",
      maxResults: 10,
      lookupManager: async (agentId) => {
        opened.push(agentId);
        return managerReturning([hit({ score: 0.99 })]);
      },
    });

    expect(opened).toEqual(["builder-a"]);
    expect(outcome.results.map((result) => result.agentId)).toEqual(["builder-a"]);
  });

  it("returns only durable notes from the agent's own workspace, tagged with agentId", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "decision",
      maxResults: 10,
      lookupManager: async () =>
        managerReturning([
          hit({ path: "memory/ok.md", score: 0.5 }),
          hit({ path: "MEMORY.md", score: 0.4 }),
          hit({ path: "sessions/transcript.jsonl", source: "sessions", score: 0.99 }),
          hit({ path: "/abs/home/secret.md", score: 0.9 }),
          hit({
            path: "memory/ok.md",
            score: 0.8,
            provenance: { originClass: "untrusted", sessionKind: "unknown", observedAt: 0 },
          }),
        ]),
    });

    expect(outcome.results).toEqual([
      {
        agentId: "builder-a",
        path: "memory/ok.md",
        startLine: 1,
        endLine: 2,
        score: 0.5,
        snippet: "note",
      },
      {
        agentId: "builder-a",
        path: "MEMORY.md",
        startLine: 1,
        endLine: 2,
        score: 0.4,
        snippet: "note",
      },
    ]);
  });

  it("drops hits outside the workspace, USER.md, and symlinks that escape the notes", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "q",
      maxResults: 20,
      lookupManager: async () =>
        managerReturning([
          hit({ path: "../outside/notes.md", score: 0.9 }),
          hit({ path: "USER.md", score: 0.9 }),
          hit({ path: "memory/USER.md", score: 0.9 }),
          hit({ path: "SOUL.md", score: 0.9 }),
          hit({ path: "memory/link.md", score: 0.9 }),
          hit({ path: "memory/profile.md", score: 0.9 }),
          hit({ path: "memory/../USER.md", score: 0.9 }),
          hit({ path: "memory/ok.md", score: 0.1 }),
        ]),
    });

    expect(outcome.results.map((result) => result.path)).toEqual(["memory/ok.md"]);
  });

  it("caps merged results at maxResults, highest score first", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a", "builder-b"],
      query: "q",
      maxResults: 1,
      lookupManager: async (agentId) =>
        managerReturning([hit({ score: agentId === "builder-a" ? 0.4 : 0.9 })]),
    });

    expect(outcome.results.map((result) => result.agentId)).toEqual(["builder-b"]);
  });

  it("keeps at most four agents in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const memberIds = Array.from({ length: 12 }, (_, index) => `builder-${index}`);
    await searchTeamMemory({
      memberIds,
      query: "q",
      maxResults: 10,
      lookupManager: async () => ({
        manager: {
          status: () => ({ workspaceDir: workspace }),
          search: async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((resolve) => {
              setTimeout(resolve, 5);
            });
            inFlight -= 1;
            return [];
          },
        },
      }),
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("returns partial results and names the agent that timed out", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a", "stuck"],
      query: "q",
      maxResults: 10,
      timeoutMs: 40,
      lookupManager: async (agentId) =>
        agentId === "stuck"
          ? {
              manager: {
                status: () => ({ workspaceDir: workspace }),
                search: () => new Promise<MemorySearchResult[]>(() => {}),
              },
            }
          : managerReturning([hit({})]),
    });

    expect(outcome.results.map((result) => result.agentId)).toEqual(["builder-a"]);
    expect(outcome.skipped).toEqual([{ agentId: "stuck", reason: "timeout" }]);
    expect(outcome.note).toBe("Partial results. Timed out: stuck.");
  });

  it("skips an agent whose workspace cannot be verified", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "q",
      maxResults: 10,
      lookupManager: async () => ({
        manager: { search: async () => [hit({})], status: () => ({}) },
      }),
    });

    expect(outcome.results).toEqual([]);
    expect(outcome.skipped).toEqual([{ agentId: "builder-a", reason: "unavailable" }]);
  });

  it("stops when the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      searchTeamMemory({
        memberIds: ["builder-a"],
        query: "q",
        maxResults: 10,
        signal: controller.signal,
        lookupManager: async () => managerReturning([hit({})]),
      }),
    ).rejects.toThrow();
  });
});

describe("searchTeamMemory manager lifecycle", () => {
  it("keeps the search deadline when close also fails", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "q",
      maxResults: 10,
      closeAfterSearch: true,
      lookupManager: async () => ({
        manager: {
          status: () => ({ workspaceDir: workspace }),
          search: async () => {
            throw createMemorySearchDeadlineError("memory_search timed out");
          },
          close: async () => {
            throw new Error("close failed");
          },
        },
      }),
    });

    expect(outcome.skipped).toEqual([{ agentId: "builder-a", reason: "timeout" }]);
  });

  it("keeps the hits when close fails after a successful search", async () => {
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "q",
      maxResults: 10,
      closeAfterSearch: true,
      lookupManager: async () => ({
        manager: {
          status: () => ({ workspaceDir: workspace }),
          search: async () => [hit({ path: "memory/ok.md" })],
          close: async () => {
            throw new Error("close failed");
          },
        },
      }),
    });

    expect(outcome.results.map((result) => result.path)).toEqual(["memory/ok.md"]);
    expect(outcome.skipped).toEqual([]);
  });

  it("closes a cli-run manager even when its search throws", async () => {
    let closed = 0;
    const outcome = await searchTeamMemory({
      memberIds: ["builder-a"],
      query: "q",
      maxResults: 10,
      closeAfterSearch: true,
      lookupManager: async () => ({
        manager: {
          status: () => ({ workspaceDir: workspace }),
          search: async () => {
            throw new Error("index unreadable");
          },
          close: async () => {
            closed += 1;
          },
        },
      }),
    });

    expect(closed).toBe(1);
    expect(outcome.skipped).toEqual([{ agentId: "builder-a", reason: "unavailable" }]);
  });
});

describe("memory_search corpus=team", () => {
  it("refuses team search in a sandboxed run without searching", async () => {
    const tool = createTeamTool({
      config: asBranchConfig({ agents: { entries: { main: {} } } }),
      sandboxed: true,
    });

    const result = await tool.execute("team-sandboxed", { query: "decision", corpus: "team" });

    expect(result.details).toMatchObject({
      results: [],
      error: "Team memory search is not available in this run.",
    });
  });

  it("refuses team search from a Trunk the owner did not list", async () => {
    const tool = createTeamTool({
      config: asBranchConfig({
        agents: { defaultId: "main", entries: { main: {}, "builder-a": {} } },
      }),
      agentId: "main",
    });

    const result = await tool.execute("team-unlisted", { query: "decision", corpus: "team" });

    expect(result.details).toMatchObject({
      results: [],
      error: "This Trunk is not in the team memory group.",
    });
  });
});
