// Shared pieces for Customize's Tools, Specialists, Channels and Everywhere tabs (preview .t9, .sec, .chip6, .seg).
// Config writes follow the engine's config.patch contract: a minimal merge-patch, the file's hash as baseHash, and
// replacePaths for any array that shrinks (engine/src/gateway/server-methods/config.ts).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import type { WindowEngine } from "../../connect/engine";
import { list, rec, str, type Rec } from "../../composer/engine";
import { errorText, trunkName, type Trunk } from "../library/data";

export { list, rec, str, type Rec };

export type ConfigState = {
  /** The file as written (sourceConfig), so a computed array never writes resolved defaults back. */
  file: Rec;
  /** The resolved config, for showing what is in effect. */
  live: Rec;
  hash?: string;
};

export function readConfig(result: unknown): ConfigState {
  const r = rec(result);
  const file = rec(r.sourceConfig ?? r.parsed ?? r.config);
  return { file, live: rec(r.runtimeConfig ?? r.config ?? file), hash: str(r.hash) || undefined };
}

/** config.get plus serialized config.patch writes; each write uses the latest hash and re-reads after. */
export function useConfig(engine: WindowEngine) {
  const [state, setState] = useState<{ data: ConfigState | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const pending = useRef(false);
  const live = useRef(true);
  const load = useCallback(async () => {
    try {
      const data = readConfig(await engine.request("config.get", {}));
      if (live.current) setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      if (live.current) setState({ data: null, loading: false, error: errorText(error) });
      return null;
    }
  }, [engine]);
  useEffect(() => {
    live.current = true;
    setState({ data: null, loading: true, error: null });
    void load();
    return () => { live.current = false; };
  }, [load]);
  const reload = useCallback(() => { setState(s => ({ ...s, loading: true })); void load(); }, [load]);
  /** Sends one merge-patch. Returns true once the engine confirmed it. */
  const patch = useCallback(async (raw: Rec, replacePaths?: string[]) => {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setWriteError(null);
    try {
      const fresh = await load();
      const result = rec(await engine.request("config.patch", { raw: JSON.stringify(raw), ...(fresh?.hash ? { baseHash: fresh.hash } : {}), ...(replacePaths?.length ? { replacePaths } : {}) }));
      if (result.ok === false) throw new Error(str(result.error) || str(result.message) || "The engine did not apply this change.");
      await load();
      return true;
    } catch (error) {
      if (live.current) setWriteError(errorText(error));
      return false;
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }, [engine, load]);
  return { ...state, reload, patch, busy, writeError };
}
export type Config = ReturnType<typeof useConfig>;

/** The file entry for one Trunk in agents.list, or an empty record. */
export function agentEntry(file: Rec, agentId: string): Rec {
  return list(rec(file.agents).list).find(a => str(a.id) === agentId) ?? {};
}
/** A string list at tools.deny, for every Trunk (agentId null) or one Trunk. */
export function denyList(file: Rec, agentId: string | null): string[] {
  const tools = agentId ? rec(agentEntry(file, agentId).tools) : rec(file.tools);
  return Array.isArray(tools.deny) ? tools.deny.filter((v): v is string => typeof v === "string") : [];
}
/** The merge-patch that sets a deny list, with the replace path the engine asks for when it shrinks. */
export function denyPatch(agentId: string | null, next: string[]): { raw: Rec; replacePaths: string[] } {
  return agentId
    ? { raw: { agents: { list: [{ id: agentId, tools: { deny: next } }] } }, replacePaths: ["agents.list[].tools.deny"] }
    : { raw: { tools: { deny: next } }, replacePaths: ["tools.deny"] };
}
export function withItem(items: string[], item: string, present: boolean): string[] {
  const rest = items.filter(v => v !== item);
  return present ? [...rest, item] : rest;
}

/** A detail section: a small mono capitals heading (preview .sec h2). */
export function Sec({ title, children, testid }: { title: string; children: ReactNode; testid?: string }) {
  return <section className="cz-sec" data-testid={testid}><h2>{title}</h2>{children}</section>;
}
/** A control the engine cannot carry out yet: drawn greyed, its reason in the title (a developer note stays in data-reason only). */
export function Grey({ children, reason, className = "btn sm" }: { children: ReactNode; reason: string; className?: string }) {
  return <button type="button" className={className} disabled title={shownWhy(reason)} data-reason={reason}>{children}</button>;
}
export function Dot({ on }: { on: boolean }) {
  return <span className={on ? "cz-dot on" : "cz-dot"} aria-hidden="true" />;
}
export function Pill({ tone, children, title }: { tone: "ok" | "warn" | "bad" | "idle" | "work"; children: ReactNode; title?: string }) {
  return <span className={"pill cz-pill " + tone} title={title}><i />{children}</span>;
}

/** "Which Trunks may use it": one chip per Trunk, pressed when it may. */
export function WhoChips({ trunks, may, toggle, reason }: { trunks: Trunk[]; may: (id: string) => boolean; toggle?: (id: string, on: boolean) => void; reason?: string }) {
  return <div className="cz-chips" role="group" aria-label="Which Trunks may use it">{trunks.map(t => {
    const on = may(t.id);
    return <button key={t.id} type="button" className="cz-chip" aria-pressed={on} disabled={!toggle} title={toggle ? undefined : shownWhy(reason)} onClick={() => toggle?.(t.id, !on)}>{trunkName(t)}</button>;
  })}</div>;
}

export type Perm = "allowed" | "ask" | "never";
const PERMS: { id: Perm; name: string }[] = [{ id: "allowed", name: "Allowed" }, { id: "ask", name: "Ask first" }, { id: "never", name: "Never" }];
export const ASK_REASON = "Needs a per-tool ask setting in the engine.";
/** One tool's row: its name and Allowed / Ask first / Never. Ask first is greyed: the engine has no per-tool ask. */
export function PermRow({ name, value, change, disabled }: { name: string; value: Perm; change: (v: Perm) => void; disabled?: boolean }) {
  return <div className="cz-perm"><code>{name}</code>
    <div className="cz-seg" role="radiogroup" aria-label={name}>{PERMS.map(p => {
      const off = disabled || p.id === "ask";
      return <button key={p.id} type="button" role="radio" aria-checked={value === p.id} disabled={off} title={p.id === "ask" ? ASK_REASON : undefined} onClick={() => change(p.id)}>{p.name}</button>;
    })}</div></div>;
}

/** A small segmented control (preview .seg with aria-pressed buttons). */
export function Seg<T extends string>({ label, value, options, change, disabled }: { label: string; value: T; options: { id: T; name: string }[]; change: (v: T) => void; disabled?: string }) {
  return <div className="cz-seg" role="radiogroup" aria-label={label}>{options.map(o => <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={!!disabled} title={shownWhy(disabled)} onClick={() => change(o.id)}>{o.name}</button>)}</div>;
}

/** Relative words for a past time: "just now", "3 hours ago", "yesterday". */
export function ago(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} minutes ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Two-letter initials for a logo tile. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
const TINTS = ["#3b6e8f", "#5b6b2f", "#8a4b2a", "#6d4c8f", "#2f6f5b", "#8f3b4b", "#4b5b8f", "#7a6a2a", "#2f5f6f", "#6f2f5f", "#4f6f2f", "#5f4f3f"];
export function Logo({ name, size = 32 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <span className="cz-logo" aria-hidden="true" style={{ width: size, height: size, background: TINTS[h % TINTS.length], fontSize: Math.round(size * 0.38) }}>{initials(name)}</span>;
}
