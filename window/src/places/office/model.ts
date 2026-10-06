import type { Contact } from "@branch/gateway-protocol";

export type OfficeAgent = {
  id: string; name: string; kind: "trunk" | "grafted" | "group";
  state: "working" | "reading" | "waiting" | "needs_you" | "resting" | "offline";
  activity?: string; needsYou?: number; unread?: boolean; colorHint?: string;
  members?: string[]; subagents?: { id: string; label: string; state: "working" }[];
};
export type OfficeLink = { from: string; to: string; at: number };
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const str = (v: unknown): string => typeof v === "string" ? v : "";
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(obj) : [];

/** Live session.message metadata marks a Grafted speaker with the engine's A2A sender identity. */
export function a2aVisit(payload: unknown, now = Date.now()): OfficeLink | null {
  const event = obj(payload), sender = obj(obj(event.message).sender), identity = obj(sender.identity);
  const from = str(sender.id) || str(identity.id), to = str(event.agentId);
  return identity.pluginId === "a2a" && from && to ? { from: `a2a:${from}`, to, at: now } : null;
}

/** sessions.list projects hasActiveRun from the live run registry; contacts supplies room/guest presence. */
export function officeRoster(agentsValue: unknown, sessionsValue: unknown, contactsValue: unknown, outsideValue?: unknown): { agents: OfficeAgent[]; openKey: Map<string, string> } {
  const trunks = rows(obj(agentsValue).agents).filter(t => str(t.id) && t.kind !== "system").map(t => ({
    id: str(t.id), name: str(obj(t.identity).name) || str(t.name) || str(t.id),
    colour: str(obj(t.identity).colour), paused: t.paused === true,
  }));
  const sessions = rows(obj(sessionsValue).sessions);
  const contacts = (Array.isArray(obj(contactsValue).contacts) ? obj(contactsValue).contacts as Contact[] : []).filter(c => !c.archivedAt);
  const outside = new Map(rows(obj(outsideValue).agents).map(agent => [str(agent.contactId), agent]));
  const keys = new Map<string, string>();
  for (const c of contacts) if (c.kind === "trunk") keys.set(str(c.face?.agentId) || c.id.replace(/^trunk:/, ""), c.threadKey);
  const agents: OfficeAgent[] = trunks.map(t => {
    const mine = sessions.filter(s => str(s.agentId) === t.id);
    const active = mine.filter(s => s.hasActiveRun === true || (Array.isArray(s.activeRunIds) && s.activeRunIds.length > 0));
    const children = active.filter(s => str(s.parentSessionKey) || str(s.spawnedBy));
    const contact = contacts.find(c => c.kind === "trunk" && (c.face?.agentId === t.id || c.id === `trunk:${t.id}`));
    const needs = mine.filter(s => s.needsYou === true).length + Number(contact?.needsYou && !mine.some(s => s.needsYou === true));
    const activity = str(obj(active[0]?.activitySummary).text) || str(active[0]?.lastMessagePreview);
    const reading = active.some(s => /^(read|grep|search|web_fetch)$/i.test(str(s.activeTool)));
    return { id: t.id, name: t.name, kind: "trunk", state: needs ? "needs_you" : active.length ? reading ? "reading" : "working" : t.paused ? "offline" : "resting",
      activity, needsYou: needs, unread: Boolean(contact?.threadUnread || contact?.unreadTopics), colorHint: t.colour,
      subagents: children.map(s => ({ id: str(s.key), label: str(s.label) || str(s.displayName) || "Job", state: "working" as const })) };
  });
  for (const c of contacts) {
    if (c.kind === "outside") agents.push({ id: c.id, name: c.name, kind: "grafted", state: outside.get(c.id)?.online === false ? "offline" : c.needsYou ? "needs_you" : c.working ? "working" : "resting", needsYou: Number(c.needsYou), unread: c.threadUnread || c.unreadTopics > 0, activity: c.preview?.kind === "message" ? c.preview.text : c.preview?.title });
    if (c.kind === "group" || c.kind === "chatGroup") agents.push({ id: c.id, name: c.name, kind: "group", state: "resting", needsYou: Number(c.needsYou), unread: c.threadUnread || c.unreadTopics > 0, members: c.face?.members });
    if (c.kind !== "trunk") keys.set(c.id, c.threadKey);
  }
  for (const t of trunks) if (!keys.has(t.id)) keys.set(t.id, `agent:${t.id}:${str(obj(agentsValue).mainKey) || "main"}`);
  return { agents, openKey: keys };
}
