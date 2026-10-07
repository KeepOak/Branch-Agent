// What the thread reads from the engine besides the history: approval details, reactions, helpers and
// whether a model is set up. Each hook loads once per conversation and keeps up with the engine's events.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { isPreparationPending, PreparationRetry, preparationTimeoutLabel } from "../connect/preparation-status";
import { listReactions, readReactions, toChips, type Reaction } from "./actions";
import type { ApprovalDecision } from "./model";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** What `exec.approval.requested` says about one approval beyond the command (engine/ui/src/app/exec-approval.ts). */
export type ApprovalDetails = {
  id: string;
  plugin: boolean;
  title?: string;
  /** A plugin's request: what it will do, in its own words, and the longer detail for the reviewer. */
  description?: string;
  detail?: string;
  expiresAtMs?: number;
  allowedDecisions: ApprovalDecision[];
  security?: string;
  ask?: string;
  resolvedPath?: string;
  sessionKey?: string;
  cwd?: string;
  host?: string;
  command?: string;
  decision?: string;
};

function readDetails(payload: unknown, plugin: boolean): ApprovalDetails | null {
  const p = rec(payload);
  const r = rec(p.request);
  const id = str(p.id);
  if (!id) return null;
  const allowed = Array.isArray(r.allowedDecisions) ? r.allowedDecisions.filter((d): d is ApprovalDecision => d === "allow-once" || d === "allow-always" || d === "deny") : [];
  return {
    id,
    plugin,
    ...(str(r.title) ? { title: str(r.title) } : {}),
    ...(plugin && str(r.description) ? { description: str(r.description) } : {}),
    ...(plugin && str(r.detail) ? { detail: str(r.detail) } : {}),
    ...(typeof p.expiresAtMs === "number" ? { expiresAtMs: p.expiresAtMs } : {}),
    allowedDecisions: allowed.length ? allowed : ["allow-once", "allow-always", "deny"],
    ...(str(r.security) ? { security: str(r.security) } : {}),
    ...(str(r.ask) ? { ask: str(r.ask) } : {}),
    ...(str(r.resolvedPath) ? { resolvedPath: str(r.resolvedPath) } : {}),
    ...(str(r.sessionKey) ? { sessionKey: str(r.sessionKey) } : {}),
    ...(str(r.cwd) ? { cwd: str(r.cwd) } : {}),
    ...(str(r.host) ? { host: str(r.host) } : {}),
    command: str(r.command) || str(r.title),
  };
}

function itemsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const r = rec(result);
  const items = r.items ?? r.approvals;
  return Array.isArray(items) ? items : [];
}

/** Pending approvals' details, from `exec.approval.list` / `plugin.approval.list` and the live events. */
export function useApprovalDetails(engine?: WindowEngine): { details: Map<string, ApprovalDetails>; error: string | null } {
  const [details, setDetails] = useState(() => new Map<string, ApprovalDetails>());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!engine) return;
    const put = (d: ApprovalDetails | null) => d && setDetails((m) => new Map(m).set(d.id, { ...m.get(d.id), ...d }));
    const decide = (id: string, decision: string) =>
      setDetails((m) => (m.has(id) ? new Map(m).set(id, { ...m.get(id)!, decision }) : m));
    const off = engine.onEvent(({ event, payload }) => {
      if (event === "exec.approval.requested") put(readDetails(payload, false));
      else if (event === "plugin.approval.requested") put(readDetails(payload, true));
      else if (event === "exec.approval.resolved" || event === "plugin.approval.resolved") decide(str(rec(payload).id), str(rec(payload).decision));
    });
    Promise.all([engine.request("exec.approval.list", {}), engine.request("plugin.approval.list", {})])
      .then(([execs, plugins]) => {
        itemsOf(execs).forEach((i) => put(readDetails(i, false)));
        itemsOf(plugins).forEach((i) => put(readDetails(i, true)));
      })
      .catch((e: unknown) => setError(errorText(e)));
    return off;
  }, [engine]);
  return { details, error };
}

/** Reactions on this conversation's messages (`session.reactions.list`, `session.reaction` events). */
export function useReactions(engine?: WindowEngine, revision = 0): {
  reactions: Map<string, Reaction[]>;
  apply: (messageId: string, raw: unknown) => void;
  error: string | null;
} {
  const [reactions, setReactions] = useState(() => new Map<string, Reaction[]>());
  const [error, setError] = useState<string | null>(null);
  const [self, setSelf] = useState<string | null>(null);
  useEffect(() => {
    if (!engine?.sessionKey) return;
    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const backoff = new PreparationRetry();
    // Without a signed-in person (users.self is FORBIDDEN) no chip is "yours"; reacting then reports the engine's error.
    engine.request("users.self", {}).then((u) => live && setSelf(str(rec(rec(u).profile).id) || str(rec(rec(u).user).id) || str(rec(u).id) || null), () => live && setSelf(null));
    // A conversation the engine hasn't stored yet has no reactions ("unknown session"); it is read again as the history grows.
    const read = () => void listReactions(engine)
      .then((raw) => {
        if (!live) return;
        backoff.reset();
        setReactions(readReactions(raw, self));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        const delay = isPreparationPending(e) ? backoff.nextDelay() : null;
        setError(isPreparationPending(e) && delay === null ? preparationTimeoutLabel("") : isPreparationPending(e) ? null : errorText(e));
        if (delay !== null) retryTimer = setTimeout(read, delay);
      });
    read();
    const off = engine.onEvent(({ event, payload }) => {
      const p = rec(payload);
      if (event === "session.reaction" && str(p.sessionKey) === engine.sessionKey) {
        setReactions((m) => new Map(m).set(str(p.messageId), toChips(p.reactions, self)));
      }
    });
    return () => {
      live = false;
      if (retryTimer) clearTimeout(retryTimer);
      off();
    };
  }, [engine, self, revision]);
  const apply = (messageId: string, raw: unknown) => setReactions((m) => new Map(m).set(messageId, toChips(raw, self)));
  return { reactions, apply, error };
}

/** One helper (sub-agent) of this conversation, from its `sessions.list` row. */
export type Helper = {
  key: string;
  name: string;
  status: string;
  model?: string;
  task?: string;
  error?: string;
  parent: string;
  steps?: number;
  updatedAt?: number;
  createdAt?: number;
};

function readHelper(row: unknown): Helper {
  const r = rec(row);
  return {
    key: str(r.key),
    name: str(r.label) || str(r.displayName) || str(r.derivedTitle) || str(r.key).split(":").pop() || "",
    status: str(r.status),
    ...(str(r.model) ? { model: str(r.model) } : {}),
    ...(str(r.subject) || str(r.lastMessagePreview) ? { task: str(r.subject) || str(r.lastMessagePreview) } : {}),
    ...(str(r.lastRunError) ? { error: str(r.lastRunError) } : {}),
    ...(typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? { updatedAt: r.updatedAt } : {}),
    ...(typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? { createdAt: r.createdAt } : {}),
    parent: str(r.spawnedBy) || str(r.parentSessionKey),
  };
}

/** The helpers this conversation started, and theirs (the live tree, §4.4.10; DECISIONS.md items 49 and 50). */
export function useHelpers(engine?: WindowEngine): { helpers: Helper[]; error: string | null; refresh: () => void } {
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const root = engine?.sessionKey;
    if (!engine || !root) return;
    let live = true;
    const load = async (key: string, depth: number): Promise<Helper[]> => {
      const rows = rec(await engine.request("sessions.list", { spawnedBy: key, limit: 200 })).sessions;
      // Only sessions this one spawned are helpers; a branch made with "Branch from here" only has it as parent.
      const spawned = (Array.isArray(rows) ? rows : []).filter((r) => str(rec(r).spawnedBy) === key);
      const mine = spawned.map(readHelper).map((h) => ({ ...h, parent: key }));
      const nested = depth < 3 ? await Promise.all(mine.map((h) => load(h.key, depth + 1))) : [];
      return [...mine, ...nested.flat()];
    };
    load(root, 0).then((list) => {
      if (live) { setHelpers(list); setLoadedRoot(root); setError(null); }
    }).catch((e: unknown) => { if (live) { setHelpers([]); setLoadedRoot(root); setError(errorText(e)); } });
    const off = engine.onEvent(({ event, payload }) => {
      const p = rec(payload);
      const s = rec(p.session);
      if (event === "sessions.changed" && (str(s.spawnedBy) || str(p.sessionKey).includes(":subagent:"))) setTick((t) => t + 1);
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, engine?.sessionKey, tick]);
  useEffect(() => {
    if (!engine?.sessionKey || !helpers.some((h) => !h.status || h.status === "running" || h.status === "queued")) return;
    const timer = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(timer);
  }, [engine?.sessionKey, helpers]);
  return { helpers: loadedRoot === engine?.sessionKey ? helpers : [], error: loadedRoot === engine?.sessionKey ? error : null, refresh: () => setTick((t) => t + 1) };
}
