// Settings › Chat apps: rows drawn from tables. Each row names its engine config key, the choices mapped to the
// engine's values and the source project's default; a row the engine has no key for is drawn greyed with why.
// The same tables feed the settings search (CHATAPPS_ROWS).
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Ctl, Field, Pick, Seg, Switch, Hint, type Lv, type RowEntry } from "../kit";

export type Opt = [label: string, value: unknown];
export type Row = {
  t: string; sub?: string; lv?: Lv;
  /** The engine config key; absent with `off`. */
  path?: string;
  kind: "sw" | "seg" | "pick" | "num" | "text" | "lines" | "custom";
  opts?: Opt[]; def?: unknown; unit?: string; ph?: string;
  /** num: the engine stores the value times this (seconds shown, ms stored). */
  scale?: number;
  /** sw: the engine values for on and off, when they aren't true and false. */
  vals?: [on: unknown, off: unknown];
  /** Why it is greyed: the engine has no key for it. */
  off?: string;
  /** custom rows are drawn by the section itself. */
  id?: string;
};
export type Section = { title: string; lv: Lv; hint?: string; after?: string; rows: Row[] };
export type Cfg = { get: (path: string) => unknown; set: (path: string, value: unknown) => Promise<boolean>; loading: boolean };

export const NO_KEY = "Branch has no setting for this yet.";
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The row's current value: what the engine has, else the source default. */
export function current(row: Row, cfg: Cfg): unknown {
  const v = row.path ? cfg.get(row.path) : undefined;
  return v === undefined ? row.def : v;
}

export function KeyRow({ row, cfg }: { row: Row; cfg: Cfg }) {
  const v = current(row, cfg);
  const save = (next: unknown) => { if (row.path && !row.off) void cfg.set(row.path, next); };
  const wideSeg = row.kind === "seg" && (row.opts ?? []).reduce((n, [l]) => n + l.length, 0) > 44;
  const lineAbove = row.kind === "lines" || (row.kind === "text" && !row.unit) || wideSeg;
  return (
    <Ctl title={row.t} sub={row.sub} off={row.off} stack={lineAbove}>
      <RowControl row={row} value={v} save={save} disabled={cfg.loading || Boolean(row.off)} />
    </Ctl>
  );
}

function RowControl({ row, value, save, disabled }: { row: Row; value: unknown; save: (v: unknown) => void; disabled: boolean }) {
  const opts = row.opts ?? [];
  const at = Math.max(0, opts.findIndex(([, ov]) => same(ov, value)));
  if (row.kind === "sw") return <Switch checked={row.vals ? same(value, row.vals[0]) : value === true} label={row.t} disabled={disabled} onChange={(on) => save(row.vals ? row.vals[on ? 0 : 1] : on)} />;
  if (row.kind === "seg") return <Seg label={row.t} value={opts.some(([, ov]) => same(ov, value)) ? String(at) : ""} options={opts.map(([l], i) => ({ id: String(i), label: l }))} disabled={disabled} onChange={(i) => save(opts[Number(i)][1] ?? null)} />;
  if (row.kind === "pick") return <Pick label={row.t} value={String(at)} options={opts.map(([l], i) => ({ id: String(i), label: l }))} disabled={disabled} onChange={(i) => save(opts[Number(i)][1] ?? null)} />;
  if (row.kind === "num") return <Num row={row} value={value} save={save} disabled={disabled} />;
  if (row.kind === "lines") return <Lines label={row.t} value={Array.isArray(value) ? value.map(String) : []} ph={row.ph} disabled={disabled} onCommit={(l) => save(l.length ? l : null)} />;
  return <Field wide label={row.t} value={typeof value === "string" ? value : ""} placeholder={row.ph} disabled={disabled} onCommit={(s) => save(s.trim() ? s : null)} />;
}

/** A number with its unit; empty puts the source default back. */
function Num({ row, value, save, disabled }: { row: Row; value: unknown; save: (v: unknown) => void; disabled: boolean }) {
  const scale = row.scale ?? 1;
  const shown = typeof value === "number" ? String(value / scale) : "";
  return (
    <span className="num-k">
      <Field type="number" label={row.t} value={shown} placeholder={row.ph} disabled={disabled} onCommit={(s) => save(s.trim() === "" ? null : Math.round(Number(s) * scale))} />
      {row.unit ? <small>{row.unit}</small> : null}
    </span>
  );
}

/** One entry per line; saves when it loses focus. */
export function Lines({ label, value, ph, disabled, onCommit }: { label: string; value: string[]; ph?: string; disabled?: boolean; onCommit: (lines: string[]) => void }) {
  const joined = value.join("\n");
  const [draft, setDraft] = useState(joined);
  useEffect(() => setDraft(joined), [joined]);
  const commit = () => { if (draft !== joined) onCommit(draft.split("\n").map((l) => l.trim()).filter(Boolean)); };
  return <textarea className="inp lines-ca" aria-label={label} rows={3} value={draft} placeholder={ph} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />;
}

/** A section of table rows, with its custom rows drawn by `custom`. */
export function TableSec({ sec, cfg, level, custom }: { sec: Section; cfg: Cfg; level: Lv; custom?: (id: string, row: Row) => ReactNode }) {
  const rows = sec.rows.filter((r) => (r.lv ?? sec.lv) <= level);
  return (
    <div className="sec" data-sec={sec.title}>
      <h2>{sec.title}</h2>
      {sec.hint ? <Hint>{sec.hint}</Hint> : null}
      {rows.map((r) => r.kind === "custom" ? <Fragment key={r.id ?? r.t}>{custom?.(r.id ?? r.t, r)}</Fragment> : <KeyRow key={r.t} row={r} cfg={cfg} />)}
      {sec.after ? <Hint>{sec.after}</Hint> : null}
    </div>
  );
}

export function rowsOf(page: string, secs: Section[]): RowEntry[] {
  return secs.flatMap((s) => s.rows.map((r) => ({ page, title: r.t, sec: s.title, lv: r.lv ?? s.lv })));
}
