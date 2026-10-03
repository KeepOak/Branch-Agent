// Shared bits for the set2 Settings pages (computer, secrets, usage, gateway, self, seasons, updates, achievements,
// advanced, developer): engine reads that follow events, a copy row, key/value lists and dates in the person's words.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Btn, Ctl } from "../kit";
import { errorText, record, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import "./set2.css";

export { useResource };
export type { RecordValue };

/** A resource that reloads whenever one of the named engine events arrives. While it reloads, the last answer
 *  stays on screen (no flash back to "loading"); an error replaces it. */
export function useLive<T>(engine: WindowEngine, method: string, params: unknown, events: string[]) {
  const res = useResource<T>(engine, method, params);
  const { reload } = res;
  const key = events.join("|");
  const last = useRef<T | undefined>(undefined);
  if (res.data !== undefined) last.current = res.data;
  if (res.error) last.current = undefined;
  useEffect(() => engine.onEvent((e) => { if (key.split("|").some((name) => e.event === name || e.event.startsWith(`${name}.`))) void reload(); }), [engine, key, reload]);
  return { ...res, data: res.data ?? last.current };
}

/** An engine call started from a button: busy while it runs, then the engine's error or nothing. */
export function useCall() {
  const [state, setState] = useState<{ busy: boolean; error?: string; note?: string }>({ busy: false });
  const run = async <T,>(call: () => Promise<T>, note?: (result: T) => string | undefined): Promise<T | undefined> => {
    setState({ busy: true });
    try {
      const result = await call();
      setState({ busy: false, note: note?.(result) });
      return result;
    } catch (error) {
      setState({ busy: false, error: errorText(error) });
      return undefined;
    }
  };
  return { ...state, run, clear: () => setState({ busy: false }) };
}

/** The line under a button group: the engine's error, or what just happened. */
export function CallLine({ call }: { call: { error?: string; note?: string } }) {
  if (call.error) return <p className="hint s2-err" role="alert">{call.error}</p>;
  return call.note ? <p className="hint" role="status">{call.note}</p> : null;
}

const DAY = 86_400_000;
/** "today 9:00 AM", "yesterday 4:12 PM", "Sep 20, 9:02 AM". */
export function when(ms: unknown, now = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return `today ${time}`;
  if (ms >= start.getTime() - DAY) return `yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
/** "Sep 20, 2026". */
export function day(ms: unknown): string {
  return typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
/** "3 days", "5 hours", "12 minutes". */
export function span(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} ${min === 1 ? "minute" : "minutes"}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"}`;
  const d = Math.floor(h / 24);
  return `${d} days`;
}
/** "412 MB", "1.1 GB". */
export function bytes(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i >= 3 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
export function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
export function rec(value: unknown): RecordValue { return record(value); }

/** Copies text to the clipboard; says so in the button for a moment. */
export function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState<"" | "ok" | "no">("");
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(""), 1600); return () => clearTimeout(t); }, [done]);
  const copy = () => { navigator.clipboard.writeText(text).then(() => setDone("ok"), () => setDone("no")); };
  return <Btn sm ghost onClick={copy}>{done === "ok" ? "Copied" : done === "no" ? "Couldn’t copy" : label}</Btn>;
}

/** A row that shows a command or address with a Copy button. */
export function CodeRow({ title, code, sub }: { title: string; code: string; sub?: ReactNode }) {
  return <Ctl title={title} sub={sub}><code className="s2-code">{code}</code><CopyBtn text={code} /></Ctl>;
}

/** A small definition list (Technical readouts). Empty values are left out. */
export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== "" && v !== null && v !== undefined);
  return shown.length ? <dl className="s2-kv">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl> : null;
}

/** The icon tile at the start of a list row. */
export function Tile({ children }: { children: ReactNode }) { return <span className="ico-tile">{children}</span>; }

/** The page's level as a number: 0 Regular, 1 Advanced, 2 Technical. */
export function lvOf(level: string): 0 | 1 | 2 { return level === "technical" ? 2 : level === "advanced" ? 1 : 0; }

/** Opens a place (and optionally one of its tabs) through the shell's navigation event. */
export function openPlace(place: string, tab?: string): void {
  window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place, ...(tab ? { tab } : {}) } }));
}
