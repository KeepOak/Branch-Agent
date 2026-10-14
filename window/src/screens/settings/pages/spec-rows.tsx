// Classic Computer & browser keeps its settings as data: one SecSpec per section, one Spec per row (set2/computer-more.tsx).
// This turns those specs into R1 Settings rows on the cards of a native R1 page, so Devices (and later Browser & screen
// and Coding) draw the preview's cards instead of the Classic page. A row with an engine key is an R1 control on that key
// with Classic's own meaning (defaults, on/off values, lists, node commands); a row Classic left out because the engine
// can't do it yet is a Coming row in the row's own words; a section that is a live list (computers, connections) is one
// bare row whose control is Classic's list, drawn without Classic's heading (kit Headless).
import { useEffect, useState, type ReactNode } from "react";
import { KitProvider, Headless, useConfig } from "../../../places/settings/kit";
import type { SettingsPageProps } from "../../../places/settings/index";
import type { Ctx, SecSpec, Spec } from "../../../places/settings/set2/computer-more";
import { Dialog } from "../../../shell/Dialog";
import type { Level, PageId } from "../nav";
import { pageFor } from "../nav";
import type { Control, Row, RowOption } from "../rows";
import { Segmented, Toggle } from "../RowView";
import { useLevel } from "../SettingsFrame";
import type { SlotControl, SlotControlProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";

/** A card of a page and the Classic sections it holds, in order. */
export type CardPlan = [card: string, secs: SecSpec[]][];
const LEVEL_WORD = ["regular", "advanced", "technical"] as const;
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const words = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const LIVE: ReadonlySet<Spec["k"]> = new Set(["sw", "seg", "pick", "num", "text", "list", "cmd", "arg", "copy", "change", "code", "val"]);
const CONTROL: Partial<Record<Spec["k"], Control>> = { sw: "toggle", seg: "segmented", pick: "select", num: "number", text: "text" };
const optionsOf = (s: Spec): RowOption[] | undefined => (s.opts ? s.opts.map((o, i) => ({ v: String(i), label: o.l })) : undefined);
const helpOf = (s: Spec): string | undefined => { const sub = s.sub ?? s.help; return s.tag ? [`${s.tag}.`, sub].filter(Boolean).join(" ") : sub; };

/** The page's rows and the controls that draw them, from its card plan. */
export function specPage(page: PageId, plan: CardPlan): { rows: Row[]; controls: Record<string, SlotControl> } {
  const rows: Row[] = [];
  const controls: Record<string, SlotControl> = {};
  const used = new Set<string>();
  const idOf = (card: string, t: string) => { let id = `${page}.${slug(card)}.${slug(t)}`; for (let i = 2; used.has(id); i++) id = `${page}.${slug(card)}.${slug(t)}-${i}`; used.add(id); return id; };
  for (const [card, secs] of plan) for (const sec of secs) {
    if (sec.body) {
      const id = idOf(card, sec.t);
      rows.push({ id, page, card, label: sec.t, level: sec.lv, ownerLevel: true, control: "custom", bare: true, source: { kind: "slot", calls: [], reason: `${sec.t} comes in a later update.` } });
      const body = sec.body;
      controls[id] = (p) => <ClassicBlock {...p} draw={(c) => <>{sec.hint ? <p className="hint">{sec.hint}</p> : null}{body(c)}</>} />;
    }
    for (const s of sec.rows ?? []) {
      if (s.k === "hint") continue;
      const id = idOf(card, s.t);
      const level = Math.max(sec.lv, s.lv ?? 0) as Level;
      const help = helpOf(s);
      const base = { id, page, card, label: s.t, level, ownerLevel: true as const, ...(help ? { help } : {}) };
      if (s.off) {
        rows.push({ ...base, control: CONTROL[s.k] ?? "custom", ...(optionsOf(s) ? { options: optionsOf(s) } : {}), ...(s.unit ? { unit: s.unit } : {}),
          source: { kind: "coming", need: s.off, reason: `${s.t} comes in a later update.` } });
      } else if (s.k === "custom") {
        rows.push({ ...base, control: "custom", bare: true, source: { kind: "slot", calls: [], reason: `${s.t} comes in a later update.` } });
        const render = s.render;
        controls[id] = (p) => <ClassicBlock {...p} draw={(c) => render?.(c)} />;
      } else if (LIVE.has(s.k)) {
        rows.push({ ...base, control: "custom", source: { kind: "slot", calls: s.k === "code" || s.k === "val" ? [] : ["config.get", "config.patch"], reason: `${s.t} comes in a later update.` } });
        controls[id] = (p) => <SpecControl {...p} s={s} />;
      }
    }
  }
  return { rows, controls };
}

/** The Classic block behind a bare row, at the frame's level, with Classic's save reporting under it. */
function ClassicBlock({ engine, row, onPage, draw }: SlotControlProps & { draw: (c: Ctx) => ReactNode }) {
  const [level] = useLevel(engine);
  const [failed, , report] = useFailure();
  const props: SettingsPageProps = { page: row.page, title: row.label ?? "", level: LEVEL_WORD[level], engine, openSettings: (id) => onPage?.(pageFor(id)) };
  // Classic's row kit styles its rows inside .set-col; here it is a plain block in the R1 card, with no padding of its own.
  return <div className="set-col" data-classic-block="" style={{ display: "block", maxWidth: "none", margin: 0, padding: 0, minWidth: 0 }}>
    <KitProvider level={level} report={report} scope={null}><Headless>{draw({ engine, lv: level, props })}</Headless></KitProvider>
    <Failed text={failed} />
  </div>;
}

/** One Spec row with an engine key, as an R1 control with Classic's meaning. */
function SpecControl({ engine, row, s }: SlotControlProps & { s: Spec }) {
  const cfg = useConfig(engine);
  const [failed, run] = useFailure();
  const key = (s.key ?? "") as string | string[];
  const raw = cfg.get(key);
  const cur = raw === undefined ? s.def : raw;
  const save = (v: unknown, path: string | string[] = key) => void run(() => cfg.set(path, v).then((ok) => { if (!ok) throw new Error("Not saved."); }));
  const at = String((s.opts ?? []).findIndex((o) => same(o.v, cur)));
  const pick = (i: unknown) => save((s.opts ?? [])[Number(i)]?.v ?? null);
  const label = row.label ?? s.t;
  let control: ReactNode = null;
  if (s.k === "sw") { const on = s.on ?? true; control = <Toggle label={label} on={s.is ? s.is(cur) : same(cur, on)} disabled={cfg.loading} onChange={(v) => save(v ? on : (s.offV ?? false))} />; }
  else if (s.k === "seg") control = <Segmented label={label} value={at} options={optionsOf(s) ?? []} disabled={cfg.loading} onChange={pick} />;
  else if (s.k === "pick") control = <select className="r1s-inp" aria-label={label} value={at} disabled={cfg.loading} onChange={(e) => pick(e.target.value)}>
    {at === "-1" ? <option value="-1">{str(cur)}</option> : null}{(s.opts ?? []).map((o, i) => <option key={i} value={String(i)}>{o.l}</option>)}</select>;
  else if (s.k === "num") control = <TextField label={label} value={typeof raw === "number" ? String(raw) : ""} number unit={s.unit} placeholder={s.ph ?? (s.def === undefined ? undefined : String(s.def))}
    onCommit={(t) => { if (!t) return save(null); const n = Number(t); if (Number.isFinite(n) && (s.min === undefined || n >= s.min) && (s.max === undefined || n <= s.max)) save(n); }} />;
  else if (s.k === "text") control = <TextField label={label} value={s.csv ? words(raw).join(", ") : str(raw)} placeholder={s.ph}
    onCommit={(t) => save(!t ? null : s.csv ? t.split(",").map((x) => x.trim()).filter(Boolean) : t)} />;
  else if (s.k === "arg") {
    const args = words(cfg.get("browser.extraArgs"));
    const flag = `${s.arg ?? ""}=`;
    const size = s.arg === "--window-size";
    const found = args.find((a) => a.startsWith(flag))?.slice(flag.length) ?? "";
    control = <TextField label={label} value={size ? found.replace(",", " × ") : found} placeholder={s.ph} onCommit={(v) => {
      const t = size ? v.replace(/\s*[x×,]\s*/i, ",") : v;
      const rest = args.filter((a) => !a.startsWith(flag));
      const next = t ? [...rest, `${flag}${t}`] : rest;
      save(next.length ? next : null, "browser.extraArgs");
    }} />;
  }
  else if (s.k === "cmd") {
    const cmds = s.cmds ?? [];
    const allow = words(cfg.get("gateway.nodes.commands.allow"));
    const deny = words(cfg.get("gateway.nodes.commands.deny"));
    const denied = cmds.some((x) => deny.includes(x));
    const on = s.danger ? cmds.every((x) => allow.includes(x)) && !denied : !denied;
    const without = (a: string[]) => a.filter((x) => !cmds.includes(x));
    control = <Toggle label={label} on={on} disabled={cfg.loading} onChange={(v) => {
      const next = s.danger ? { allow: v ? [...without(allow), ...cmds] : without(allow), deny: without(deny) } : { allow, deny: v ? without(deny) : [...without(deny), ...cmds] };
      save({ allow: next.allow.length ? next.allow : null, deny: next.deny.length ? next.deny : null }, "gateway.nodes.commands");
    }} />;
  }
  else if (s.k === "list") control = <WordList label={label} items={words(raw)} placeholder={s.ph} disabled={cfg.loading} onSave={(next) => save(next.length ? next : null)} />;
  else if (s.k === "copy") { const v = (s.csv ? words(raw).join(", ") : str(raw)) || (s.ph ?? ""); control = <CodeCopy code={v} />; }
  else if (s.k === "code") control = <CodeCopy code={s.code ?? ""} />;
  else if (s.k === "val") control = <span className="r1s-val g-label">{s.val}</span>;
  else if (s.k === "change") control = <Change label={label} value={str(raw)} placeholder={s.ph} bare={s.bare} button={s.btn ?? "Change…"} disabled={cfg.loading} onSave={(v) => save(v || null)} />;
  const local = s.k === "code" || s.k === "val";
  return <>
    {local ? <span className="r1s-own-ctl" data-local="">{control}</span>
      : <Needs engine={engine} need={["config.get", "config.patch"]} where={label}><span className="r1s-own-ctl">{control}</span></Needs>}
    <Failed text={failed} />
  </>;
}

/** A field that saves when it is left or Enter is pressed, and only when the text changed. */
function TextField({ label, value, placeholder, unit, number, onCommit }: { label: string; value: string; placeholder?: string; unit?: string; number?: boolean; onCommit: (t: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text.trim() !== value) onCommit(text.trim()); };
  return <><input className="r1s-inp" aria-label={label} type={number ? "number" : "text"} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
    {unit ? <span className="r1s-unit g-label">{unit}</span> : null}</>;
}

function CodeCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return <><code className="r1s-val">{code}</code><button type="button" className="r1s-btn" data-local="" onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy"}</button></>;
}

/** Words kept in a list (networks, commands): each with Remove, and Add. */
function WordList({ label, items, placeholder, disabled, onSave }: { label: string; items: string[]; placeholder?: string; disabled?: boolean; onSave: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const t = draft.trim(); if (!t) return; if (!items.includes(t)) onSave([...items, t]); setDraft(""); };
  return <span className="r1s-own-ctl">
    <ul className="r1s-items">{items.map((i) => <li key={i} className="r1s-item"><span className="r1s-item-t g-label">{i}</span>
      <button type="button" className="r1s-link" aria-label={`Remove ${i}`} disabled={disabled} onClick={() => onSave(items.filter((x) => x !== i))}>Remove</button></li>)}</ul>
    <span className="r1s-acts"><input className="r1s-inp" aria-label={`${label}: add`} placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
      <button type="button" className="r1s-btn" disabled={!draft.trim() || disabled} onClick={add}>Add</button></span>
  </span>;
}

/** A value shown as code with a button that changes it in a small sheet; empty goes back to the default. */
function Change({ label, value, placeholder, bare, button, disabled, onSave }: { label: string; value: string; placeholder?: string; bare?: boolean; button: string; disabled?: boolean; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const done = () => { onSave(draft.trim()); setOpen(false); };
  return <>
    {bare ? null : <code className="r1s-val">{value || placeholder}</code>}
    <button type="button" className="r1s-btn" disabled={disabled} onClick={() => { setDraft(value); setOpen(true); }}>{button}</button>
    {open ? <Dialog title={label} onClose={() => setOpen(false)} footer={<><button type="button" className="r1s-btn" onClick={() => setOpen(false)}>Cancel</button><button type="button" className="r1s-btn" onClick={done}>Save</button></>}>
      <input className="r1s-inp" aria-label={label} autoFocus placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") done(); }} />
    </Dialog> : null}
  </>;
}

