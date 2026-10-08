// The plug: this conversation's tools (DESIGN-SPEC §4.3.3), switched per conversation with
// sessions.patch { toolOverrides }, as OpenClaw's composer plus menu does
// (ui/src/pages/chat/components/chat-composer-plus-menu.ts, composer-capability-catalog.ts, lib/config/mcp-servers.ts).
import { list, rec, str, type Rec } from "./engine";
import { visible } from "../places/settings/adapter";

export type ToolOverrides = {
  mcpServers?: Record<string, boolean>;
  mcpToolsDeny?: Record<string, string[]>;
  skills?: Record<string, boolean>;
  webSearch?: boolean;
};

export type Connector = { name: string; enabled: boolean; line: string };
export type SkillRow = { key: string; name: string; line: string; baseEnabled: boolean; problem?: "Not running" | "Needs a key" };
export type ConnectorTool = { name: string; line: string };

/** Connectors are the MCP servers in the engine's config (`mcp.servers`). */
export function readConnectors(configResult: unknown): Connector[] {
  const r = rec(configResult);
  const config = rec(r.runtimeConfig ?? r.config);
  const servers = rec(rec(config.mcp).servers);
  return Object.entries(servers).map(([name, value]) => {
    const server = rec(value);
    const local = typeof server.command === "string";
    return { name, enabled: server.enabled !== false, line: local ? `Local command · ${str(server.command)}` : "Remote server" };
  });
}

/** Whether web search is on for the whole app (config tools.web.search.enabled; on unless set off). */
export function readWebSearchBase(configResult: unknown): boolean {
  const r = rec(configResult);
  const config = rec(r.runtimeConfig ?? r.config);
  return rec(rec(rec(config.tools).web).search).enabled !== false;
}

function skillProblem(s: Rec): SkillRow["problem"] {
  const missing = rec(s.missing);
  if (Array.isArray(missing.env) && missing.env.length > 0) {
    return "Needs a key";
  }
  const anyMissing = Object.values(missing).some((v) => Array.isArray(v) && v.length > 0);
  return anyMissing || s.eligible === false ? "Not running" : undefined;
}

/** Human-facing skill names; the engine key stays unchanged. */
function skillLabel(name: string): string {
  const label = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(name)
    ? name.replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase())
    : name;
  return visible(label);
}

/** Skills from skills.status that this Trunk may use, with why one can't run. */
export function readSkills(result: unknown): SkillRow[] {
  return list(rec(result).skills)
    .filter((s) => s.modelVisible !== false && s.blockedByAllowlist !== true && s.blockedByAgentFilter !== true)
    .map((s) => ({
      key: str(s.skillKey) || str(s.name),
      name: skillLabel(str(s.name)),
      line: str(s.description),
      baseEnabled: s.disabled !== true,
      problem: skillProblem(s),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A connector's tools as tools.effective lists them (MCP groups only). */
export function readConnectorTools(result: unknown, server: string): ConnectorTool[] | null {
  const groups = list(rec(result).groups).filter((g) => str(g.source) === "mcp");
  const tools = groups.flatMap((g) => list(g.tools)).filter((t) => str(t.serverName) === server || str(t.pluginId) === server || str(t.id).startsWith(`${server}__`));
  return tools.length > 0 ? tools.map((t) => ({ name: str(t.label) || str(t.id), line: str(t.description) })) : null;
}

export function readOverrides(row: Rec): ToolOverrides {
  const o = rec(row.toolOverrides);
  return o as ToolOverrides;
}

export function isOn(base: boolean, override: boolean | undefined): boolean {
  return override ?? base;
}

/** The overrides after one switch; a switch set back to the Trunk's own value drops its entry. */
export function toggle(o: ToolOverrides, kind: "mcpServers" | "skills", name: string, on: boolean, base: boolean): ToolOverrides {
  const current = { ...(o[kind] ?? {}) };
  if (on === base) {
    delete current[name];
  } else {
    current[name] = on;
  }
  return tidy({ ...o, [kind]: current });
}

export function setWebSearch(o: ToolOverrides, on: boolean, base: boolean): ToolOverrides {
  const next = { ...o };
  if (on === base) {
    delete next.webSearch;
  } else {
    next.webSearch = on;
  }
  return tidy(next);
}

/** Drops empty maps, so "nothing changed here" is exactly an empty overlay. */
export function tidy(o: ToolOverrides): ToolOverrides {
  const out: ToolOverrides = {};
  if (o.mcpServers && Object.keys(o.mcpServers).length) out.mcpServers = o.mcpServers;
  if (o.mcpToolsDeny && Object.keys(o.mcpToolsDeny).length) out.mcpToolsDeny = o.mcpToolsDeny;
  if (o.skills && Object.keys(o.skills).length) out.skills = o.skills;
  if (o.webSearch !== undefined) out.webSearch = o.webSearch;
  return out;
}

/** How many things differ here from the Trunk's own settings ("<n> changed here"). */
export function changedCount(o: ToolOverrides): number {
  return (
    Object.keys(o.mcpServers ?? {}).length +
    Object.values(o.mcpToolsDeny ?? {}).reduce((n, tools) => n + tools.length, 0) +
    Object.keys(o.skills ?? {}).length +
    (o.webSearch !== undefined ? 1 : 0)
  );
}

export function changedWords(n: number): string {
  return `${n} changed here`;
}

/** The patch value: null when nothing differs, so the session holds no overlay. */
export function patchValue(o: ToolOverrides): ToolOverrides | null {
  return changedCount(o) === 0 ? null : tidy(o);
}

export function matchesQuery(name: string, line: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q) || line.toLowerCase().includes(q);
}
