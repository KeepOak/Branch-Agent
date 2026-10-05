// Gateway contracts adapted from engine/ui/src/pages/agents/files.ts and engine/src/gateway/server-methods/agents-workspace.ts.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
export type Trunk = { id: string; name?: string; identity?: { name?: string; emoji?: string; theme?: string; avatar?: string; avatarUrl?: string }; createdVia?: string; workspace?: string; model?: { primary?: string } };
export type Trunks = { agents: Trunk[]; defaultId: string; mainKey: string };
export type FileEntry = { name: string; path: string; kind?: "file" | "directory"; size?: number; missing?: boolean; hash?: string; content?: string; encoding?: string; mimeType?: string };
export type Workspace = { path: string; parentPath?: string; entries: FileEntry[]; totalEntries: number; offset: number };
export function trunkName(t: Trunk) { return t.identity?.name || t.name || t.id; }
export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
/** A generation belongs to one screen/selection. Late results never replace a new selection. */
export class RequestGeneration {
  private generation = 0;
  next() { const value = ++this.generation; return () => value === this.generation; }
  retire() { this.generation++; }
}
export function useResource<T>(engine: WindowEngine, method: string | null, params: unknown = {}) {
  const key = JSON.stringify(params);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!method, error: null });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let current = true;
    setState({ data: null, loading: !!method, error: null });
    if (method) void engine.request<T>(method, JSON.parse(key)).then(data => {
      if (current) setState({ data, loading: false, error: null });
    }, error => { if (current) setState({ data: null, loading: false, error: errorText(error) }); });
    return () => { current = false; };
  }, [engine, method, key, revision]);
  return { ...state, reload };
}
export function useOperation(engine: WindowEngine) {
  const generation = useRef(new RequestGeneration());
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const guard = generation.current;
    pending.current = false;
    setBusy(false); setError(null);
    return () => { guard.retire(); pending.current = false; };
  }, [engine]);
  async function run<T>(method: string, params: unknown, done: (result: T) => void) {
    if (pending.current) return;
    pending.current = true;
    const isCurrent = generation.current.next();
    setBusy(true); setError(null);
    try {
      const result = await engine.request<T>(method, params);
      if (result !== null && typeof result === "object" && "ok" in result && result.ok === false) {
        const response = result as { error?: unknown; message?: unknown };
        throw new Error(errorText(response.error ?? response.message ?? "The engine did not apply this change."));
      }
      if (isCurrent()) done(result);
    } catch (error) { if (isCurrent()) setError(errorText(error)); }
    finally { if (isCurrent()) { pending.current = false; setBusy(false); } }
  }
  return { busy, error, run };
}

/** Defensive readers for engine results: a missing or mistyped field reads as empty, never a crash. */
export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const recs = (v: unknown): Rec[] => arr(v).filter(x => x && typeof x === "object" && !Array.isArray(x)) as Rec[];
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const optStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
/** A file entry from agents.files.get / agents.workspace.*, or null when the result has none. */
export function fileOf(result: unknown): FileEntry | null {
  const f = rec(rec(result).file);
  if (!Object.keys(f).length) return null;
  return { ...f, name: str(f.name), path: str(f.path), missing: f.missing === true, content: optStr(f.content), hash: optStr(f.hash), encoding: optStr(f.encoding), mimeType: optStr(f.mimeType) } as FileEntry;
}
/** Workspace entries that have a name and a path. */
export function entriesOf(result: unknown): FileEntry[] {
  return recs(rec(result).entries).filter(e => typeof e.name === "string" && typeof e.path === "string")
    .map(e => ({ name: e.name as string, path: e.path as string, kind: e.kind === "directory" ? "directory" : "file", size: num(e.size), updatedAtMs: num(e.updatedAtMs) } as FileEntry & { updatedAtMs?: number }));
}
/** The Trunks in an agents.list result. */
export function trunksOf(result: unknown): Trunk[] {
  return recs(rec(result).agents).filter(t => typeof t.id === "string" && t.id).map(t => ({ ...t, id: t.id as string, name: optStr(t.name), identity: { ...rec(t.identity), name: optStr(rec(t.identity).name) } } as Trunk));
}
