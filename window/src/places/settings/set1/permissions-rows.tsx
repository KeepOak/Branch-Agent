// Settings › Permissions, the row tables (§4.7.11): every section is data (title, level, hint, rows), drawn by a few
// generic rows that read and save one engine config path at once. The same tables feed the settings search, so the
// search can never drift from the page. A row the engine has no key for is drawn greyed with its reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import type { RecordValue } from "../adapter";
import { Btn, Ctl, Field, Pick, Pill, Sec, Seg, Switch, Val, useConfig, useLevel, useSaved, type Lv, type Opt, type RowEntry } from "../kit";
import type { ApprovalsFile } from "./permissions-file";

export type Cfg = ReturnType<typeof useConfig>;
/** What a custom row gets: the engine, the config rows and the exec approvals file. */
export type Ctx = {
  engine: WindowEngine; cfg: Cfg; ap: ApprovalsFile; openApprovals: () => void;
  /** The Trunks (agents.list) and the other computers (node.list). */
  trunks: RecordValue[]; nodes: RecordValue[];
  /** "Rules for": this computer, or a node id. */
  rulesFor: string; setRulesFor: (id: string) => void;
  /** agents.list as read, and a re-read after the mode changes. */
  agents?: RecordValue; reloadAgents: () => Promise<void>;
};

/** A greyed control: what to draw, disabled, beside the reason. */
export type Dead = { sw: boolean } | { btn: string } | { seg: string[]; v?: string } | { num: string; unit?: string } | { text: string } | { pick: string[] } | { field: string; btn: string } | { none: true };
type Base = { t: string; sub?: string; lv?: Lv; words?: string; when?: (c: Cfg) => boolean };
export type Row =
  | (Base & { k: "sw"; path: string; def: boolean; subOff?: string; read?: (c: Cfg) => boolean; save?: (c: Cfg, on: boolean) => unknown })
  | (Base & { k: "seg" | "pick"; path: string; def: string; opts: Opt[]; subOf?: (v: string) => string; read?: (c: Cfg) => string; save?: (c: Cfg, v: string) => unknown })
  | (Base & { k: "num"; path: string; def?: number; unit?: string; ph?: string; scale?: number; min?: number; max?: number; save?: (c: Cfg, n: number | null) => unknown })
  | (Base & { k: "off"; why: string; c: Dead; stack?: boolean })
  | (Base & { k: "code"; code: string | ((c: Cfg) => string) })
  | (Base & { k: "pill"; word: string })
  | (Base & { k: "el"; el: (x: Ctx) => ReactNode });
/** `tail` draws after the section (outside its card), such as the Lockdown box. */
export type Section = { title: string; group?: string; showHeading?: boolean; lv: Lv; hint?: string; rows: Row[]; tail?: (x: Ctx) => ReactNode };

/** The reasons rows are greyed, in one place. */
export const WHY = {
  key: "Branch has no setting for this yet.",
  os: "Windows permissions open from the Branch app on your computer.",
  desk: "This runs in the Branch app on your computer.",
  guard: "The engine doesn’t report this guard, so Branch can’t say it is on.",
  lock: "The engine has no Lockdown switch yet.",
  pin: "The engine has no app lock or PIN yet.",
  test: "The engine can’t test a rule before a Trunk tries it yet.",
  policy: "The engine can’t read a company policy file yet.",
  money: "The engine has no spending limits yet.",
};

const valueOf = (c: Cfg, path: string): unknown => c.get(path);

function SwRow({ r, c }: { r: Extract<Row, { k: "sw" }>; c: Cfg }) {
  const raw = valueOf(c, r.path);
  const on = r.read ? r.read(c) : typeof raw === "boolean" ? raw : r.def;
  const save = (v: boolean) => void (r.save ? r.save(c, v) : c.set(r.path, v));
  return <Ctl title={r.t} sub={!on && r.subOff ? r.subOff : r.sub}><Switch checked={on} label={r.t} disabled={c.loading} onChange={save} /></Ctl>;
}

function ChoiceRow({ r, c }: { r: Extract<Row, { k: "seg" | "pick" }>; c: Cfg }) {
  const raw = valueOf(c, r.path);
  const v = r.read ? r.read(c) : typeof raw === "string" ? raw : r.def;
  const save = (id: string) => void (r.save ? r.save(c, id) : c.set(r.path, id));
  const Control = r.k === "seg" ? Seg : Pick;
  return <Ctl title={r.t} sub={r.subOf ? r.subOf(v) || undefined : r.sub}><Control label={r.t} value={v} options={r.opts} disabled={c.loading} onChange={save} /></Ctl>;
}

function NumRow({ r, c }: { r: Extract<Row, { k: "num" }>; c: Cfg }) {
  const saved = useSaved();
  const raw = valueOf(c, r.path);
  const scale = r.scale ?? 1;
  const shown = typeof raw === "number" ? String(raw / scale) : r.def !== undefined ? String(r.def) : "";
  const commit = (text: string) => {
    const put = (n: number | null) => void (r.save ? r.save(c, n) : c.set(r.path, n));
    if (!text.trim()) return put(null);
    const n = Number(text);
    if (!Number.isInteger(n) || (r.min !== undefined && n < r.min) || (r.max !== undefined && n > r.max)) {
      return saved.failed(`${r.t}: use a whole number${r.min !== undefined ? ` from ${r.min}` : ""}${r.max !== undefined ? ` to ${r.max}` : ""}.`);
    }
    put(n * scale);
  };
  return <Ctl title={r.t} sub={r.sub}><Field label={r.t} type="number" value={shown} placeholder={r.ph} disabled={c.loading} onCommit={commit} />{r.unit ? <small className="pm-unit">{r.unit}</small> : null}</Ctl>;
}

const NOOP = () => undefined;
/** The greyed control itself (the row's `off` line says why). */
export function deadControl(d: Dead, label: string): ReactNode {
  if ("none" in d) return null;
  if ("field" in d) return <><input className="inp" aria-label={label} placeholder={d.field} disabled /><Btn sm disabled>{d.btn}</Btn></>;
  if ("sw" in d) return <Switch checked={d.sw} label={label} disabled onChange={NOOP} />;
  if ("btn" in d) return <Btn sm disabled>{d.btn}</Btn>;
  if ("seg" in d) return <Seg label={label} value={d.v ?? d.seg[0]} options={d.seg.map((s) => ({ id: s, label: s }))} disabled onChange={NOOP} />;
  if ("num" in d) return <><input className="inp" aria-label={label} placeholder={d.num} disabled />{d.unit ? <small className="pm-unit">{d.unit}</small> : null}</>;
  if ("text" in d) return <textarea className="inp" aria-label={label} placeholder={d.text} rows={2} disabled />;
  if ("pick" in d) return <Pick label={label} value={d.pick[0]} options={d.pick.map((s) => ({ id: s, label: s }))} disabled onChange={NOOP} />;
  return null;
}

export function RowView({ r, x }: { r: Row; x: Ctx }) {
  const c = x.cfg;
  if (r.when && !r.when(c)) return null;
  switch (r.k) {
    case "sw": return <SwRow r={r} c={c} />;
    case "seg": case "pick": return <ChoiceRow r={r} c={c} />;
    case "num": return <NumRow r={r} c={c} />;
    // A greyed row ("off") is not drawn: it has no path to working and reads as protection that is not there.
    case "off": return null;
    case "code": return <Ctl title={r.t} sub={r.sub}><Val code>{typeof r.code === "string" ? r.code : r.code(c)}</Val></Ctl>;
    case "pill": return <Ctl title={r.t} sub={r.sub}><Pill tone="ok">{r.word}</Pill></Ctl>;
    case "el": return <>{r.el(x)}</>;
  }
}

/** One section at the level in view: its rows at or below that level, in order. */
export function SectionView({ s, x }: { s: Section; x: Ctx }) {
  const lv = useLevel();
  if (s.lv > lv) return null;
  const rows = s.rows.filter((r) => (r.lv ?? 0) <= lv && r.k !== "off");
  if (!rows.length && !s.tail) return null;
  return (
    <>
      {rows.length ? <Sec title={s.title} group={s.group} showHeading={s.showHeading} hint={s.hint}>{rows.map((r) => <RowView key={r.t} r={r} x={x} />)}</Sec> : null}
      {s.tail ? s.tail(x) : null}
    </>
  );
}

/** The search entries for a set of sections. */
export function rowsOf(sections: Section[]): RowEntry[] {
  return sections.flatMap((s) => s.rows.filter((r) => r.k !== "off").map((r) => ({ page: "permissions", title: r.t, sec: s.title, group: s.group ?? s.title, lv: Math.max(s.lv, r.lv ?? 0) as Lv, ...(r.words ? { words: r.words } : {}) })));
}
