// Inbox reads and writes. Helpers copied from places/automations/runtime.ts (adapted from engine/ui cron and
// approval controllers): engine requests stay authoritative; late reads and duplicate mutations are suppressed.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { agents, sessions, type Agent, type Session } from "../overview/engine";

export type Row = Record<string, unknown>;
export const rec = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
export const str = (v: unknown): string => typeof v === "string" ? v : "";
export const num = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;
export const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(rec) : [];
export const errorText = (v: unknown): string => v instanceof Error ? v.message : str(rec(v).message) || String(v);

/** Whether the connection holds a scope (operator.admin holds every operator scope; write implies session scopes). */
export function has(engine: WindowEngine, scope: string): boolean {
  const s = engine.scopes;
  return s.includes("operator.admin") || s.includes(scope) || (scope === "operator.sessions.write" && s.includes("operator.write"));
}
export const canApprove = (engine: WindowEngine) => has(engine, "operator.approvals");

export async function paged(engine: WindowEngine, method: string, key: string, params: Row = {}): Promise<Row[]> {
  const result: Row[] = [];
  let offset = 0;
  for (;;) {
    const response = rec(await engine.request(method, { ...params, limit: 200, offset }));
    const page = rows(response[key]);
    result.push(...page);
    if (response.hasMore === false || page.length === 0 || (typeof response.total === "number" && result.length >= response.total) || (response.hasMore !== true && page.length < 200)) return result;
    offset += page.length;
  }
}

export async function approvals(engine: WindowEngine): Promise<{ items: Row[]; errors: string[] }> {
  const kinds = ["exec", "plugin", "branch"];
  const results = await Promise.allSettled(kinds.map(kind => engine.request(`${kind}.approval.list`, {})));
  return {
    items: results.flatMap((result, i) => result.status === "fulfilled" ? rows(result.value).map(r => ({ ...r, kind: kinds[i] })) : []),
    errors: results.flatMap((result, i) => result.status === "rejected" ? [`${["Command", "Add-on", "Branch change"][i]} approvals: ${errorText(result.reason)}`] : []),
  };
}
export async function resolveApproval(engine: WindowEngine, item: Row, decision: "allow-once" | "deny") {
  if (typeof item.expiresAtMs === "number" && item.expiresAtMs <= Date.now()) throw new Error("This request expired. Refresh the Inbox.");
  const allowed = rec(item.request).allowedDecisions;
  if (Array.isArray(allowed) && !allowed.includes(decision)) throw new Error("This answer is not offered for this request.");
  const result = rec(await engine.request("approval.resolve", { id: item.id, kind: item.kind === "branch" ? "system-agent" : item.kind, decision }));
  if (result.applied === false) throw new Error("This request was already answered elsewhere. Refresh to read its recorded decision.");
  if (result.applied !== true) throw new Error("The engine did not confirm that this answer was applied. Refresh the Inbox.");
  return result;
}

/** Marks conversations read in batches of the engine's 100-target limit. */
export async function markRead(engine: WindowEngine, list: Session[]): Promise<void> {
  for (let i = 0; i < list.length; i += 100) {
    const targets = list.slice(i, i + 100).map(row => ({ key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}) }));
    const failed = rows(rec(await engine.request("sessions.patchMany", { targets, patch: { unread: false } })).outcomes).filter(o => o.ok === false);
    if (failed.length) throw new Error(`${failed.length} ${failed.length === 1 ? "conversation" : "conversations"} couldn’t be marked read: ${str(rec(failed[0].error).message) || "the engine refused"}.`);
  }
}

export type Needs = {
  approvals: Row[]; proposals: Row[]; pairing: Row[]; ownerSet: boolean; devices: Row[]; nodes: Row[]; questions: Row[]; mentions: Row[];
  failed: Row[]; expired: Row[]; channels: { channel: string; label: string; account: Row }[];
  sessions: Session[]; agents: { defaultId: string; mainKey: string; list: Agent[] }; errors: string[];
};

const settle = async <T,>(label: string, errors: string[], read: () => Promise<T>, empty: T): Promise<T> => {
  try { return await read(); } catch (e) { errors.push(`${label}: ${errorText(e)}`); return empty; }
};

function stoppedChannels(value: unknown): Needs["channels"] {
  const v = rec(value), labels = rec(v.channelLabels);
  return Object.entries(rec(v.channelAccounts)).flatMap(([channel, list]) => rows(list)
    .filter(a => a.enabled !== false && a.configured !== false && str(a.lastError) && a.running !== true && a.connected !== true)
    .map(account => ({ channel, label: str(labels[channel]) || channel, account })));
}

/** Everything Needs you shows, each source failing on its own. Reads a scope the window lacks are skipped. */
export async function loadNeeds(engine: WindowEngine): Promise<Needs> {
  const errors: string[] = [], pairs = has(engine, "operator.pairing"), asks = has(engine, "operator.questions");
  const [queue, proposals, pairing, devices, nodes, questions, mentions, failed, auth, channels, list, trunks] = await Promise.all([
    approvals(engine),
    settle("Improvements", errors, () => engine.request("skills.proposals.list", {}), {}),
    pairs ? settle("Chat app requests", errors, () => engine.request("channels.pairing.list", {}), {}) : {},
    pairs ? settle("Devices", errors, () => engine.request("device.pair.list", {}), {}) : {},
    pairs ? settle("Computers", errors, () => engine.request("node.pair.list", {}), {}) : {},
    asks ? settle("Questions", errors, () => engine.request("question.list", {}), {}) : {},
    settle("Mentions", errors, () => engine.request("mentions.list", {}), {}),
    settle("Automations", errors, () => paged(engine, "cron.list", "jobs", { lastRunStatus: "error", enabled: "enabled" }), [] as Row[]),
    settle("Sign-ins", errors, () => engine.request("models.authStatus", {}), {}),
    settle("Chat apps", errors, () => engine.request("channels.status", { probe: false }), {}),
    settle("Conversations", errors, () => paged(engine, "sessions.list", "sessions", { includeGlobal: true, includeUnknown: true, includeLastMessage: true, includeDerivedTitles: true, archived: "all" }), [] as Row[]),
    settle("Trunks", errors, () => engine.request("agents.list", {}), {}),
  ]);
  return {
    approvals: queue.items, proposals: rows(rec(proposals).proposals).filter(p => p.status === "pending"), pairing: rows(rec(pairing).requests), ownerSet: rec(pairing).commandOwnerConfigured === true,
    devices: rows(rec(devices).pending), nodes: rows(rec(nodes).pending),
    questions: rows(rec(questions).questions).filter(q => q.status === "pending"), mentions: rows(rec(mentions).items),
    failed, expired: rows(rec(auth).providers).filter(p => p.status === "expired"), channels: stoppedChannels(channels),
    sessions: sessions({ sessions: list }), agents: agents(trunks), errors: [...queue.errors, ...errors],
  };
}

/** Only the sources the Needs you chip counts (for the sidebar badge and window title); failed reads count 0. */
export async function loadNeedsCount(engine: WindowEngine): Promise<number> {
  const pairs = has(engine, "operator.pairing"), asks = has(engine, "operator.questions");
  const read = async (method: string, pick: (v: Row) => unknown[]) => { try { return pick(rec(await engine.request(method, {}))).length; } catch (e) { console.warn(`Inbox count: ${method}`, e); return 0; } };
  const counts = await Promise.all([
    approvals(engine).then(q => q.items.length),
    read("skills.proposals.list", v => rows(v.proposals).filter(p => p.status === "pending")),
    pairs ? read("channels.pairing.list", v => rows(v.requests)) : 0,
    pairs ? read("device.pair.list", v => rows(v.pending)) : 0,
    pairs ? read("node.pair.list", v => rows(v.pending)) : 0,
    asks ? read("question.list", v => rows(v.questions).filter(q => q.status === "pending")) : 0,
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

/** Gateway events that refresh the Inbox. */
export const refreshesInbox = (event: string): boolean => /^(sessions\.|chat$|cron$|.*approval\.|mentions\.changed$|question\.|device\.pair\.|node\.pair\.|plugin\.canopy\.)/.test(event);

export class ActionGate {
  private busy = false;
  async run<T>(action: () => Promise<T>): Promise<{ accepted: false } | { accepted: true; value: T }> {
    if (this.busy) return { accepted: false };
    this.busy = true;
    try { return { accepted: true, value: await action() }; } finally { this.busy = false; }
  }
}

export function usePlaceData<T>(engine: WindowEngine, load: ((engine: WindowEngine) => Promise<T>) | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(load));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0), mounted = useRef(false), gate = useRef(new ActionGate()), currentEngine = useRef(engine);
  currentEngine.current = engine;
  const refresh = useCallback(async () => {
    if (!load) return;
    const id = ++generation.current;
    setLoading(true);
    try { const value = await load(engine); if (mounted.current && id === generation.current) { setData(value); setError(""); } }
    catch (e) { if (mounted.current && id === generation.current) setError(errorText(e)); }
    finally { if (mounted.current && id === generation.current) setLoading(false); }
  }, [engine, load]);
  useEffect(() => {
    mounted.current = true; gate.current = new ActionGate(); setBusy(false); setNotice(""); void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = engine.onEvent(({ event }) => { if (refreshesInbox(event)) { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150); } });
    return () => { mounted.current = false; ++generation.current; clearTimeout(timer); dispose(); };
  }, [engine, refresh]);
  const act = async (operation: () => Promise<unknown>, message: string) => {
    const sourceEngine = engine;
    const current = () => mounted.current && sourceEngine === currentEngine.current;
    try {
      const outcome = await gate.current.run(async () => {
        setBusy(true); setNotice("");
        try {
          const result = rec(await operation());
          if (result.ok === false || result.removed === false) throw new Error(str(result.reason) || "The engine did not apply this action.");
          return result;
        } finally { if (current()) setBusy(false); }
      });
      if (outcome.accepted && current()) { setNotice(message); await refresh(); return true; }
    } catch (e) { if (current()) setNotice(errorText(e)); }
    return false;
  };
  return { data, loading, error, busy, notice, refresh, act };
}
export type PlaceData<T> = ReturnType<typeof usePlaceData<T>>;
