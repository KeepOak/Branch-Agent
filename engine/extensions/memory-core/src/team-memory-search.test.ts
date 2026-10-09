import type { MemorySearchResult } from "branch/plugin-sdk/memory-core-host-runtime-files";
import { describe, expect, it } from "vitest";
import { searchTeamMemory, type TeamMemoryLookup } from "./team-memory-search.js";
import { createMemorySearchTool } from "./tools.js";
import { asBranchConfig } from "./tools.test-helpers.js";

function hit(overrides: Partial<MemorySearchResult>): MemorySearchResult {
  return {
    path: "memory/note.md",
    startLine: 1,
    endLine: 2,
    score: 0.5,
    snippet: "note",
    source: "memory",
    ...overrides,
  };
}

function managerReturning(results: MemorySearchResult[]): TeamMemoryLookup {
  return { manager: { search: async () => results } };
}

describe("searchTeamMemory", () => {
  it("returns only durable memory hits from every agent, tagged with agentId", async () => {
    const lookups: Record<string, TeamMemoryLookup> = {
      main: managerReturning([
        hit({ path: "memory/main-note.md", score: 0.5 }),
        hit({ path: "sessions/transcript.jsonl", source: "sessions", score: 0.99 }),
        hit({ path: "/abs/home/secret.md", score: 0.9 }),
        hit({
          path: "memory/untrusted.md",
          score: 0.8,
          provenance: { originClass: "untrusted", sessionKind: "unknown", observedAt: 0 },
        }),
      ]),
      builder: managerReturning([hit({ path: "memory/builder-note.md", score: 0.7 })]),
    };

    const outcome = await searchTeamMemory({
      agentIds: ["main", "builder"],
      query: "decision",
      maxResults: 10,
      lookupManager: async (agentId) => lookups[agentId]!,
    });

    expect(outcome.results).toEqual([
      {
        agentId: "builder",
        path: "memory/builder-note.md",
        startLine: 1,
        endLine: 2,
        score: 0.7,
        snippet: "note",
      },
      {
        agentId: "main",
        path: "memory/main-note.md",
        startLine: 1,
        endLine: 2,
        score: 0.5,
        snippet: "note",
      },
    ]);
    expect(outcome.skippedAgentIds).toEqual([]);
  });

  it("caps merged results at maxResults, highest score first", async () => {
    const outcome = await searchTeamMemory({
      agentIds: ["a", "b"],
      query: "q",
      maxResults: 1,
      lookupManager: async (agentId) =>
        managerReturning([
          hit({ path: `memory/${agentId}.md`, score: agentId === "a" ? 0.4 : 0.9 }),
        ]),
    });

    expect(outcome.results.map((result) => result.agentId)).toEqual(["b"]);
  });

  it("reports agents it could not search instead of failing the whole call", async () => {
    const outcome = await searchTeamMemory({
      agentIds: ["ok", "broken", "unindexed"],
      query: "q",
      maxResults: 10,
      lookupManager: async (agentId) => {
        if (agentId === "broken") {
          throw new Error("index corrupt");
        }
        if (agentId === "unindexed") {
          return { error: "no memory index" };
        }
        return managerReturning([hit({ path: "memory/ok.md" })]);
      },
    });

    expect(outcome.results.map((result) => result.agentId)).toEqual(["ok"]);
    expect(outcome.skippedAgentIds).toEqual(["broken", "unindexed"]);
  });

  it("stops when the caller has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      searchTeamMemory({
        agentIds: ["main"],
        query: "q",
        maxResults: 10,
        signal: controller.signal,
        lookupManager: async () => managerReturning([hit({})]),
      }),
    ).rejects.toThrow();
  });
});

describe("memory_search corpus=team", () => {
  it("refuses team search in a sandboxed run without searching", async () => {
    const tool = createMemorySearchTool({
      config: asBranchConfig({ agents: { entries: { main: {} } } }),
      sandboxed: true,
    });

    const result = await tool.execute("team-sandboxed", { query: "decision", corpus: "team" });

    expect(result.details).toMatchObject({
      results: [],
      error: "Team memory search is not available in this run.",
    });
  });
});
