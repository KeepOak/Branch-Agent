// Adapted from engine/ui cron controllers and extensions/workboard/browser runtime:
// engine requests remain authoritative; late reads and duplicate mutations are suppressed.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
export type Row = Record<string, unknown>;
export const rec = (v: unknown): Row => v && typeof v === "object" ? v as Row : {};
export const str = (v: unknown): string => typeof v === "string" ? v : "";
export const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(rec) : [];
export const errorText = (v: unknown): string => v instanceof Error ? v.message : str(rec(v).message) || String(v);
export const time = (v: unknown): string => typeof v === "number" && v > 0 ? new Date(v).toLocaleString() : "Not recorded";
export const canWrite = (engine: WindowEngine) => engine.scopes.includes("operator.admin") || engine.scopes.includes("operator.write");
export const canApprove = (engine: WindowEngine) => engine.scopes.includes("operator.admin") || engine.scopes.includes("operator.approvals");
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
export async function sessions(engine: WindowEngine) {
  return paged(engine, "sessions.list", "sessions", { includeGlobal: true, includeUnknown: true, includeLastMessage: true, includeDerivedTitles: true, archived: "all" });
}
export async function approvals(engine: WindowEngine): Promise<{ items: Row[]; errors: string[] }> {
  const kinds = ["exec", "plugin", "branch"];
  const results = await Promise.allSettled(kinds.map(kind => engine.request(`${kind}.approval.list`, {})));
  return { items: results.flatMap((result, i) => result.status === "fulfilled" ? rows(result.value).map(r => ({ ...r, kind: kinds[i] })) : []), errors: results.flatMap((result, i) => result.status === "rejected" ? [`${["Command", "Add-on", "Branch change"][i]} approvals: ${errorText(result.reason)}`] : []) };
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
export class ActionGate {
  private busy = false;
  async run<T>(action: () => Promise<T>): Promise<{ accepted: false } | { accepted: true; value: T }> {
    if (this.busy) return { accepted: false };
    this.busy = true;
    try { return { accepted: true, value: await action() }; } finally { this.busy = false; }
  }
}
/** Gateway events that refresh the places; Canopy's plugin broadcasts as plugin.canopy.<event> (engine/extensions/canopy change-events.ts). */
export const refreshesPlaces = (event: string): boolean => /^(sessions\.|chat$|cron$|.*approval\.|plugin\.canopy\.)/.test(event);
export function usePlaceData<T>(engine: WindowEngine, load: (engine: WindowEngine) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0), mounted = useRef(false), gate = useRef(new ActionGate()), currentEngine = useRef(engine);
  currentEngine.current = engine;
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    if (engine.connected === false) { setLoading(false); setError(""); return; }
    setLoading(true);
    setError("");
    try { const value = await load(engine); if (mounted.current && id === generation.current) { setData(value); setError(""); } }
    catch (e) { if (mounted.current && id === generation.current) setError(errorText(e)); }
    finally { if (mounted.current && id === generation.current) setLoading(false); }
  }, [engine, load]);
  useEffect(() => {
    mounted.current = true; gate.current = new ActionGate(); setBusy(false); setData(null); setNotice(""); void refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = engine.onEvent(({ event }) => { if (refreshesPlaces(event)) { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 150); } });
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
          if (result.ok === false || result.removed === false || result.aborted === false) throw new Error(str(result.reason) || "The engine did not apply this action.");
          return result;
        } finally { if (current()) setBusy(false); }
      });
      if (outcome.accepted && current()) { setNotice(message); await refresh(); return true; }
    } catch (e) { if (current()) setNotice(errorText(e)); }
    return false;
  };
  return { data, loading, error, busy, notice, refresh, act };
}
