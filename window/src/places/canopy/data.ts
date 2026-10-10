// Canopy's live data (DESIGN-SPEC §4.6.7): one list of every run, from the engine's own records.
// Sources: sessions.list, the approval queues, cron.list / cron.runs, canopy.cards.list (engine/extensions/canopy),
// agents.list, node.list and computer.status. Nothing here is sample data; an absent source leaves its part empty.
import type { WindowEngine } from "../../connect/engine";
import { approvals, errorText, paged, rec, rows, sessions, str, type Row } from "../automations/runtime";

export type Why = "you" | "card" | "access" | "room" | "failed";
export const BLOCK: Record<Why, [string, string]> = { you: ["wait", "Waiting for you"], card: ["idle", "Waiting on another card"], access: ["warn", "Missing access"], room: ["warn", "Out of room or budget"], failed: ["bad", "It failed"] };

export type Trunk = { id: string; name: string };
/** `counted` is false when no engine record ties runs to this computer, so no run count is drawn for it. */
export type Computer = { id: string; name: string; state: "ok" | "sleep" | "off"; lastSeen?: number; counted?: false };
export type CanopyData = {
  sessions: Row[]; pending: Row[]; jobs: Row[]; runs: Row[]; cards: Row[]; boards: Row[];
  trunks: Trunk[]; defaultTrunk: string; mainKey: string; nodes: Row[]; computer: Row | null;
  cardsError: string; errors: string[];
  /** The signed-in viewer's profile id (users.self); empty when the connection has no signed-in person. */
  viewer: string;
};

const SOURCES = ["Conversations", "Approvals", "Upcoming schedules", "Run history", "Cards", "Trunks", "Computers", "This computer's own computer", "You"];

/** Reads every source at once; one failing source is reported and leaves only its part empty. */
export async function loadCanopy(engine: WindowEngine): Promise<CanopyData> {
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const results = await Promise.allSettled([
    sessions(engine), approvals(engine), paged(engine, "cron.list", "jobs", {}),
    paged(engine, "cron.runs", "entries", { scope: "all", sortDir: "desc" }), engine.request("canopy.cards.list", {}),
    engine.request("agents.list", {}), engine.request("node.list", {}), engine.request("computer.status", {}), engine.request("users.self", {}),
  ]);
  const value = (i: number) => { const r = results[i]; return r.status === "fulfilled" ? r.value : null; };
  const failed = (i: number) => { const r = results[i]; return r.status === "rejected" ? errorText(r.reason) : ""; };
  const errors = results.flatMap((r, i) => r.status === "rejected" && i !== 4 && i !== 8 ? [`${SOURCES[i]}: ${errorText(r.reason)}`] : []);
  const pending = value(1) as Awaited<ReturnType<typeof approvals>> | null;
  const agents = rec(value(5));
  const trunks = rows(agents.agents).map(a => ({ id: str(a.id), name: str(rec(a.identity).name) || str(a.name) || str(a.id) }));
  return {
    sessions: rows(value(0)), pending: pending?.items ?? [], jobs: rows(value(2)),
    runs: rows(value(3)).filter(r => Number(r.ts) >= midnight.getTime()),
    cards: rows(rec(value(4)).cards), boards: rows(rec(value(4)).boards), cardsError: failed(4),
    trunks, defaultTrunk: str(agents.defaultId), mainKey: str(agents.mainKey) || "main",
    nodes: rows(rec(value(6)).nodes), computer: value(7) === null ? null : rec(value(7)), viewer: str(rec(rec(value(8)).profile).id),
    errors: [...errors, ...(pending?.errors ?? [])],
  };
}

export const trunkName = (d: Pick<CanopyData, "trunks">, id: string) => d.trunks.find(t => t.id === id)?.name || id || "Trunk";
export const sessionTitle = (row: Row) => str(row.label) || str(row.displayName) || str(row.derivedTitle) || "Conversation";

/** The computers a run can be on: this computer first, then your other computers, then cloud computers (§4.6.7 strip). */
export function computers(d: Pick<CanopyData, "nodes" | "computer" | "sessions">): Computer[] {
  const list: Computer[] = [{ id: "this", name: "This computer", state: "ok" }];
  if (d.computer?.configured === true) list.push({ id: "desktop", name: "Private computer", state: d.computer.available === true ? "ok" : "off", counted: false });
  for (const n of d.nodes) {
    if (n.gatewayLocal === true || !str(n.nodeId)) continue;
    const seen = Number(n.lastSeenAtMs ?? n.lastDisconnectedAtMs ?? n.lastConnectedAtMs) || undefined;
    list.push({ id: str(n.nodeId), name: str(n.displayName) || str(n.nodeId), state: n.connected === true ? "ok" : "off", lastSeen: seen });
  }
  for (const s of d.sessions) {
    const p = rec(s.placement), provider = str(p.providerId);
    if (!provider || ["local", "requested"].includes(str(p.state)) || list.some(c => c.id === "cloud:" + provider)) continue;
    list.push({ id: "cloud:" + provider, name: `${provider.charAt(0).toUpperCase()}${provider.slice(1)} computer`, state: ["active", "starting", "syncing", "provisioning"].includes(str(p.state)) ? "ok" : "sleep" });
  }
  return list;
}

/** Which computer a conversation runs on: its command computer, else its cloud placement, else this computer. */

/** A real ratio only: helpers done of all, or a goal's tokens used of its budget. Never invented. */





export const cardBoard = (card: Row) => str(rec(rec(card.metadata).automation).boardId) || "default";
export const isArchived = (card: Row) => !!rec(card.metadata).archivedAt;
export const sessionsBoardIds = (boards: Row[]) => new Set(boards.filter(b => b.kind === "sessions").map(b => str(b.id)));

/** Why a blocked card is stuck, from its own record: a failed attempt, an unfinished card it waits for, or you. */
export function whyOf(card: Row, cards: Row[]): { why: Why; detail: string } {
  const meta = rec(card.metadata), attempts = rows(meta.attempts), last = attempts[attempts.length - 1];
  const notice = rows(meta.notifications).filter(n => n.kind === "failed").pop();
  const detail = str(last?.error) || str(notice?.message);
  if (last?.status === "failed" || Number(meta.failureCount) > 0) return { why: "failed", detail };
  const waits = waitsFor(card).filter(id => cards.find(c => str(c.id) === id)?.status !== "done");
  if (waits.length) return { why: "card", detail: detail || str(cards.find(c => str(c.id) === waits[0])?.title) };
  return { why: "you", detail };
}

export const waitsFor = (card: Row) => rows(rec(card.metadata).links).filter(l => l.type === "parent" || l.type === "blocked_by").map(l => str(l.targetCardId)).filter(Boolean);
