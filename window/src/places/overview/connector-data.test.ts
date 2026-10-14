import { describe, expect, it, vi } from "vitest";
import { countOf, githubQueries, gmailQueries, itemsOf, offeredTools, readGitHub, readGmail, repoOf, searchTool, sinceDate, topSenders, unwrap, type ToolRef } from "./connector-data";

const NOW = new Date("2026-10-14T12:00:00Z");
const EFFECTIVE = {
  groups: [
    { id: "core", tools: [{ id: "read" }] },
    { id: "mcp", tools: [
      { id: "github__search_pull_requests", mcpServer: "github", mcpToolName: "search_pull_requests" },
      { id: "gmail__search_messages", mcpServer: "gmail", mcpToolName: "search_messages" },
      { id: "gmail__send", mcpServer: "gmail", mcpToolName: "send" },
    ] },
  ],
};

describe("connector tools", () => {
  it("reads the offered tools with their servers, and picks each connector's search tool", () => {
    const tools = offeredTools(EFFECTIVE);
    expect(tools.map(t => t.id)).toEqual(["github__search_pull_requests", "gmail__search_messages", "gmail__send"]);
    expect(searchTool(tools, /github/i)?.id).toBe("github__search_pull_requests");
    expect(searchTool(tools, /gmail/i)?.id).toBe("gmail__search_messages");
    expect(searchTool(tools, /slack/i)).toBeUndefined();
  });

  it("prefers the pull request search over code search when a GitHub server offers both", () => {
    const tools = offeredTools({ groups: [{ id: "mcp", tools: [
      { id: "github__search_code", mcpServer: "github", mcpToolName: "search_code" },
      { id: "github__search_pull_requests", mcpServer: "github", mcpToolName: "search_pull_requests" },
    ] }] });
    const prefer = [/^search_pull_requests$/i, /^search_issues$/i];
    expect(searchTool(tools, /github/i)?.id).toBe("github__search_code");
    expect(searchTool(tools, /github/i, prefer)?.id).toBe("github__search_pull_requests");
  });
});

describe("reading a search result", () => {
  it("unwraps MCP text content and reads totals, rows and bare arrays", () => {
    expect(unwrap({ content: [{ type: "text", text: "{\"total_count\":4}" }] })).toEqual({ total_count: 4 });
    expect(countOf({ total_count: 7, items: [] })).toBe(7);
    expect(countOf({ content: [{ type: "text", text: "[{\"id\":1},{\"id\":2}]" }] })).toBe(2);
    expect(countOf([{ id: 1 }])).toBe(1);
    expect(countOf({ ok: true })).toBeNull();
    expect(itemsOf({ messages: [{ subject: "Hi" }] })).toEqual([{ subject: "Hi" }]);
  });

  it("names the repository of a PR, and the senders of the inbox, most first", () => {
    expect(repoOf({ repository: { full_name: "keepoak/site" } })).toBe("keepoak/site");
    expect(repoOf({ repository_url: "https://api.github.example/repos/keepoak/site" })).toBe("keepoak/site");
    expect(topSenders([{ from: "Dana Okafor <dana@x>" }, { from: "Dana Okafor" }, { from: "Delta" }])).toEqual([["Dana Okafor", 2], ["Delta", 1]]);
  });
});

describe("the searches for a range", () => {
  it("dates the windows and limits GitHub to one repository when one is chosen", () => {
    expect(sinceDate("week", NOW)).toBe("2026-10-07");
    expect(githubQueries("month", "", NOW).opened).toBe("is:pr author:@me created:>=2026-09-14");
    expect(githubQueries("week", "keepoak/site", NOW).merged).toBe("is:pr is:merged author:@me merged:>=2026-10-07 repo:keepoak/site");
    expect(gmailQueries("today")).toMatchObject({ unread: "is:unread", needs: "is:unread in:inbox newer_than:1d", sent: "in:sent newer_than:1d" });
  });
});

describe("reading the connectors", () => {
  it("reads GitHub counts, the repositories, and the review and mention rows", async () => {
    const call = vi.fn(async (_tool: ToolRef, query: string) => {
      if (query.includes("review-requested")) return { items: [{ title: "Billing page copy", number: 212, repository: { full_name: "keepoak/site" } }] };
      if (query.includes("mentions")) return { items: [{ title: "Save files on iCloud", number: 88, repository: { full_name: "edilas/game" } }] };
      return { total_count: query.includes("merged") ? 3 : 5 };
    });
    const github = await readGitHub(call, { id: "gh", server: "github", name: "search" }, "week", "", NOW);
    expect(github).toEqual({
      opened: 5, merged: 3, reviews: 5,
      requested: [{ title: "Billing page copy", number: 212, repository: { full_name: "keepoak/site" } }],
      mentioned: [{ title: "Save files on iCloud", number: 88, repository: { full_name: "edilas/game" } }],
      repos: ["edilas/game", "keepoak/site"],
    });
  });

  it("gives null for a count whose search fails, so only that tile says Coming", async () => {
    const call = vi.fn(async (_tool: ToolRef, query: string) => { if (query.includes("merged")) throw new Error("refused"); return { total_count: 2 }; });
    const github = await readGitHub(call, { id: "gh", server: "github", name: "search" }, "week", "", NOW);
    expect(github.merged).toBeNull();
    expect(github.opened).toBe(2);
  });

  it("reads Gmail counts, the mail that needs a reply, and the top senders", async () => {
    const call = vi.fn(async (_tool: ToolRef, query: string) => {
      if (query.startsWith("is:unread in:inbox")) return { messages: [{ from: "Dana Okafor", subject: "August numbers" }] };
      if (query === "is:unread") return { resultSizeEstimate: 23 };
      if (query.startsWith("in:inbox")) return { messages: [{ from: "Dana Okafor" }, { from: "Dana Okafor" }, { from: "Hartwell Supply" }] };
      return { resultSizeEstimate: 4 };
    });
    const gmail = await readGmail(call, { id: "gm", server: "gmail", name: "search" }, "week");
    expect(gmail.unread).toBe(23);
    expect(gmail.needs).toBe(1);
    expect(gmail.needsRows).toEqual([{ from: "Dana Okafor", subject: "August numbers" }]);
    expect(gmail.senders[0]).toEqual(["Dana Okafor", 2]);
  });
});
