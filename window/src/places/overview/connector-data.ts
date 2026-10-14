// The GitHub and Gmail cards' numbers and rows, from the connectors the person linked. The engine offers each connector's
// tools in tools.effective (the same list Customize › Connectors reads); a search tool on the GitHub or Gmail server is
// called with tools.invoke. A metric whose tool is missing, refused or unreadable is null, and its tile says Coming.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { record, records, text } from "./engine";

export type Range = "today" | "week" | "month" | "year";
const DAYS: Record<Range, number> = { today: 1, week: 7, month: 30, year: 365 };
export type Row = Record<string, unknown>;
export type ToolRef = { id: string; server: string; name: string };

/** The tools the engine offers, each with the server it comes from (tools.effective groups). */
export function offeredTools(effective: unknown): ToolRef[] {
  return records(record(effective).groups).flatMap(g => records(g.tools))
    .map(t => ({ id: text(t.id), server: text(t.mcpServer), name: text(t.mcpToolName) || text(t.id) }))
    .filter(t => t.id !== "" && t.server !== "");
}

/** The search tool on a server: its name says search (or list, for mail). */
export function searchTool(tools: ToolRef[], server: RegExp): ToolRef | undefined {
  const mine = tools.filter(t => server.test(t.server));
  return mine.find(t => /search/i.test(t.name)) ?? mine.find(t => /list/i.test(t.name));
}

/** An MCP tool result: its text content, parsed when it is JSON. */
export function unwrap(output: unknown): unknown {
  const content = Array.isArray(record(output).content) ? (record(output).content as unknown[]) : null;
  if (!content) return output;
  const body = content.map(c => text(record(c).text)).join("");
  try { return JSON.parse(body); } catch { return body; }
}

/** The result list of a search: items, messages or threads, or a bare array. */
export function itemsOf(output: unknown): Row[] {
  const value = unwrap(output);
  if (Array.isArray(value)) return records(value);
  const r = record(value);
  const list = r.items ?? r.messages ?? r.threads ?? r.results;
  return Array.isArray(list) ? records(list) : [];
}

/** How many a search found: its total when the tool gives one, else the rows it returned (null when unreadable). */
export function countOf(output: unknown): number | null {
  const value = unwrap(output);
  const r = record(value);
  for (const key of ["total_count", "resultSizeEstimate", "total"]) if (typeof r[key] === "number") return r[key] as number;
  if (Array.isArray(value) || Array.isArray(r.items) || Array.isArray(r.messages) || Array.isArray(r.threads) || Array.isArray(r.results)) return itemsOf(output).length;
  return null;
}

/** The date a window of days ago, as the search syntax wants it. */
export function sinceDate(range: Range, now = new Date()): string {
  const d = new Date(now.getTime() - DAYS[range] * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** The GitHub searches for a range, optionally limited to one repository. */
export function githubQueries(range: Range, repo: string, now?: Date) {
  const since = sinceDate(range, now), scope = repo ? ` repo:${repo}` : "";
  return {
    opened: `is:pr author:@me created:>=${since}${scope}`,
    merged: `is:pr is:merged author:@me merged:>=${since}${scope}`,
    reviews: `is:pr reviewed-by:@me updated:>=${since}${scope}`,
    requested: `is:pr is:open review-requested:@me${scope}`,
    mentioned: `is:open mentions:@me${scope}`,
  };
}

/** The Gmail searches for a range. */
export function gmailQueries(range: Range) {
  const days = DAYS[range];
  return {
    unread: "is:unread",
    needs: `is:unread in:inbox newer_than:${days}d`,
    important: `is:important newer_than:${days}d`,
    sent: `in:sent newer_than:${days}d`,
    inbox: `in:inbox newer_than:${days}d`,
  };
}

export type GitHubData = { opened: number | null; merged: number | null; reviews: number | null; requested: Row[]; mentioned: Row[]; repos: string[] };
export type GmailData = { unread: number | null; needs: number | null; important: number | null; sent: number | null; needsRows: Row[]; senders: [string, number][] };
export type WidgetData = { github: GitHubData | null; gmail: GmailData | null };

/** The repository a PR or issue belongs to, as owner/name. */
export function repoOf(item: Row): string {
  const full = text(record(item.repository).full_name) || text(item.repository_full_name) || text(item.full_name);
  if (full) return full;
  const url = text(item.repository_url) || text(item.html_url);
  const parts = url.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}`.replace(/#.*$/, "") : "";
}

/** The sender of a mail, its name when there is one. */
function senderOf(item: Row): string {
  const from = text(item.from) || text(item.sender) || text(record(item.from).name);
  return from.replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "").trim();
}

/** Who wrote the most of the inbox rows, most first. */
export function topSenders(items: Row[], count = 4): [string, number][] {
  const tally = new Map<string, number>();
  for (const item of items) {
    const who = senderOf(item);
    if (who) tally.set(who, (tally.get(who) ?? 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, count);
}

type Call = (tool: ToolRef, query: string) => Promise<unknown>;

/** Reads the GitHub numbers and rows through the GitHub search tool. */
export async function readGitHub(call: Call, tool: ToolRef, range: Range, repo: string, now?: Date): Promise<GitHubData> {
  const q = githubQueries(range, repo, now);
  const settle = async (query: string) => call(tool, query).then(r => r, () => null);
  const [opened, merged, reviews, requested, mentioned] = await Promise.all([q.opened, q.merged, q.reviews, q.requested, q.mentioned].map(settle));
  const requestedRows = requested === null ? [] : itemsOf(requested);
  const mentionedRows = mentioned === null ? [] : itemsOf(mentioned);
  const repos = [...new Set([...requestedRows, ...mentionedRows].map(repoOf).filter(Boolean))].sort();
  return {
    opened: opened === null ? null : countOf(opened), merged: merged === null ? null : countOf(merged), reviews: reviews === null ? null : countOf(reviews),
    requested: requestedRows.slice(0, 3), mentioned: mentionedRows.slice(0, 3), repos,
  };
}

/** Reads the Gmail numbers, the mail that needs a reply, and the senders through the Gmail search tool. */
export async function readGmail(call: Call, tool: ToolRef, range: Range): Promise<GmailData> {
  const q = gmailQueries(range);
  const settle = async (query: string) => call(tool, query).then(r => r, () => null);
  const [unread, needs, important, sent, inbox] = await Promise.all([q.unread, q.needs, q.important, q.sent, q.inbox].map(settle));
  const needsRows = needs === null ? [] : itemsOf(needs);
  return {
    unread: unread === null ? null : countOf(unread), needs: needs === null ? null : countOf(needs),
    important: important === null ? null : countOf(important), sent: sent === null ? null : countOf(sent),
    needsRows: needsRows.slice(0, 3), senders: inbox === null ? [] : topSenders(itemsOf(inbox)),
  };
}

/** The connectors' data for the Overview, read once per range and repository. Each card is null until its tools answer. */
export function useWidgetData(engine: WindowEngine, sessionKey: string | null, range: Range, repo: string): WidgetData {
  const [data, setData] = useState<WidgetData>({ github: null, gmail: null });
  useEffect(() => {
    let live = true;
    if (!sessionKey) { setData({ github: null, gmail: null }); return; }
    const call: Call = async (tool, query) => {
      const result = record(await engine.request("tools.invoke", { name: tool.id, args: { query, q: query, maxResults: 50 }, sessionKey }));
      if (result.ok !== true || result.requiresApproval === true) throw new Error("not readable");
      return result.output;
    };
    engine.request("tools.effective", { sessionKey }).then(effective => {
      const tools = offeredTools(effective);
      const gh = searchTool(tools, /github/i), gm = searchTool(tools, /gmail|google/i);
      if (!live) return;
      setData({ github: null, gmail: null });
      if (gh) readGitHub(call, gh, range, repo).then(github => { if (live) setData(d => ({ ...d, github })); });
      if (gm) readGmail(call, gm, range).then(gmail => { if (live) setData(d => ({ ...d, gmail })); });
    }, () => undefined);
    return () => { live = false; };
  }, [engine, sessionKey, range, repo]);
  return data;
}
