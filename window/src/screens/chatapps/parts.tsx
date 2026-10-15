// R1 Chat apps: the small pieces the controls ported from Classic Settings › Chat apps share. Config reads and writes go
// through the window's one config store (the same one RowView's useRow and Classic use), so a change here shows in both.
// Every control names the engine call it makes (data-need) and sits on the item 48 clear glass with its text on pills.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll } from "../../connect/capabilities";
import { errorText, record, visible } from "../../places/settings/adapter";
import { configStore, pathKeys } from "../../places/settings/config-store";
import { has } from "../../places/inbox/data";
import type { Row as ClassicRow } from "../../places/settings/set1/chatapps-kit";
import { appOf, catalogue, connectedApps, type App, type ChannelsStatus } from "../../places/settings/set1/chatapps-data";
import { useRow, type Row } from "../settings";
import { Segmented, Toggle } from "../settings/RowView";
import { CHAT_APPS, type ChatApp } from "./catalogue";
import { NEEDS_KEY } from "./rows";

export type Cfg = { get: (path: string) => unknown; set: (path: string, value: unknown) => Promise<boolean>; ready: boolean; error: string };

/** The engine's settings, read and saved through the shared config store; ready only when this connection may save. */
export function useCfg(engine: WindowEngine): Cfg {
  const store = configStore(engine);
  const snap = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap, () => store.snap);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  const [error, setError] = useState("");
  const get = (path: string) => pathKeys(path).reduce<unknown>((v, k) => record(v)[k], snap?.config);
  const set = async (path: string, value: unknown) => {
    setError("");
    try { await store.set(path, value); return true; } catch (e) { setError(errorText(e)); return false; }
  };
  return { get, set, ready: Boolean(snap) && snap?.valid !== false && has(engine, "operator.admin") && canAll(engine, ["config.patch"]), error };
}

/** The engine's connected apps (every channel it runs, not only the R1 four), as R1 catalogue entries: the engine's own
 *  list first, then an R1 app or a channel with accounts the list doesn't name. */
export function connectedOf(status: ChannelsStatus | undefined): { app: ChatApp; state: App }[] {
  const listed = connectedApps(status);
  const seen = new Set(listed.map((a) => a.id));
  const more = [...CHAT_APPS.filter((c) => c.channel).map((c) => ({ id: c.channel!, name: c.name })), ...Object.keys(status?.channelAccounts ?? {}).map((id) => ({ id, name: visible(id) }))]
    .filter((c) => !seen.has(c.id) && (seen.add(c.id), true))
    .map((c) => appOf(status, { ...c, detail: "" })).filter((a) => a.on);
  return [...listed, ...more].map((state) => ({ app: CHAT_APPS.find((c) => c.channel === state.id) ?? { id: state.id, name: state.name, group: "", channel: state.id }, state }));
}
/** One app's live state, named as the engine names it. */
export const stateOf = (status: ChannelsStatus | undefined, app: ChatApp): App =>
  appOf(status, catalogue(status).find((c) => c.id === (app.channel ?? app.id)) ?? { id: app.channel ?? app.id, name: app.name, detail: "" });

/** One settings line in the R1 row look (screens/settings RowView): label, help, its control, and a Coming reason. */
export function Line({ id, label, help, coming, need, ctlNeed, stack, children }: { id?: string; label: ReactNode; help?: ReactNode; coming?: string; need?: string; ctlNeed?: string; stack?: boolean; children?: ReactNode }) {
  return (
    <div id={id} className={"r1s-row r1-ca-line" + (stack ? " r1s-stack" : "")} aria-disabled={coming ? true : undefined} data-coming={coming ? need ?? NEEDS_KEY : undefined} title={coming}>
      <b className="g-label">{label}</b>
      {help ? <small className="g-label" data-lines>{help}</small> : null}
      {children !== undefined && children !== null && children !== false ? <div className="r1s-ctl" data-need={ctlNeed}>{children}</div> : null}
      {coming ? <small className="r1s-note g-label" data-lines>{coming}</small> : null}
    </div>
  );
}

/** A row Classic draws greyed, as an R1 Coming row (RowView draws it with its reason and the call it waits for). */
export function comingRow(id: string, label: string, reason: string, help?: string, control: Row["control"] = "custom", options?: Row["options"], fallback?: unknown): Row {
  return { id: "chatapps." + id, page: "chatapps", card: "Chat apps", label, help, level: 0, ownerLevel: true, control, options, fallback, source: { kind: "coming", need: NEEDS_KEY, reason } };
}

export const Hint = ({ children }: { children: ReactNode }) => <p className="r1-ca-hint g-label" data-lines>{children}</p>;
export const Alert = ({ text }: { text?: string }) => (text ? <p role="alert" className="g-label" data-lines>{visible(text)}</p> : null);
export const Pill = ({ tone, children }: { tone: string; children: ReactNode }) => <span className="r1-ca-pill g-label" data-tone={tone}>{children}</span>;
export const toneOf = (t: string) => (t === "ok" ? "ok" : t === "work" ? "work" : "bad");

/** A text or number box that saves when it is left or Enter is pressed, and only when it changed. */
export function Input({ label, value, kind = "text", unit, placeholder, disabled, onSave }: { label: string; value: string; kind?: "text" | "number"; unit?: string; placeholder?: string; disabled?: boolean; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onSave(draft); };
  return (
    <>
      <input className="r1s-inp" aria-label={label} type={kind} value={draft} placeholder={placeholder} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      {unit ? <span className="r1s-unit g-label">{unit}</span> : null}
    </>
  );
}

/** One entry per line, saved when the box is left (Classic's lines rows). */
export function LinesBox({ label, value, placeholder, disabled, onCommit }: { label: string; value: string[]; placeholder?: string; disabled?: boolean; onCommit: (lines: string[]) => void }) {
  const joined = value.join("\n");
  const [draft, setDraft] = useState(joined);
  useEffect(() => setDraft(joined), [joined]);
  const commit = () => { if (draft !== joined) onCommit(draft.split("\n").map((l) => l.trim()).filter(Boolean)); };
  return <textarea className="r1s-inp r1-ca-lines" aria-label={label} rows={3} value={draft} placeholder={placeholder} disabled={disabled} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />;
}

/** "Names that wake it" and other lines rows of the table, through the row's own hook. */
export function LinesRow({ engine, row }: { engine: WindowEngine; row: Row }) {
  const view = useRow(engine, row);
  return (
    <Line id={"row-" + row.id} label={view.label} help={view.help} stack ctlNeed="config.patch">
      <LinesBox label={view.label} value={Array.isArray(view.value) ? view.value.map(String) : []} disabled={view.state !== "ready"} onCommit={(lines) => void view.set(lines.length ? lines : null).catch(() => undefined)} />
      {view.state === "error" || view.state === "blocked" ? <small className="g-label">{view.reason}</small> : null}
    </Line>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A Classic table row (chatapps-kit Row) drawn with the R1 controls: the same key, choices, default, unit and scale, and
 *  greyed with Classic's reason where the engine has no key. Used where the key depends on the app (Manage, Each app). */
export function KeyLine({ cfg, row, id }: { cfg: Cfg; row: ClassicRow; id?: string }) {
  const stored = row.path ? cfg.get(row.path) : undefined;
  const value = stored === undefined ? row.def : stored;
  const coming = row.off ?? (row.path ? undefined : NEEDS_KEY);
  const disabled = Boolean(coming) || !cfg.ready;
  const save = (next: unknown) => { if (row.path && !row.off) void cfg.set(row.path, next); };
  const opts = row.opts ?? [];
  const at = opts.findIndex(([, ov]) => same(ov, value));
  let control: ReactNode;
  if (row.kind === "sw") control = <Toggle label={row.t} on={row.vals ? same(value, row.vals[0]) : value === true} disabled={disabled} onChange={(on) => save(row.vals ? row.vals[on ? 0 : 1] : on)} />;
  else if (row.kind === "seg" && opts.length <= 4) control = <Segmented label={row.t} value={at < 0 ? undefined : at} options={opts.map(([label], i) => ({ v: i, label }))} disabled={disabled} onChange={(i) => save(opts[Number(i)]?.[1] ?? null)} />;
  else if (row.kind === "seg" || row.kind === "pick") control = (
    <select className="r1s-inp" aria-label={row.t} value={String(Math.max(0, at))} disabled={disabled} onChange={(e) => save(opts[Number(e.target.value)]?.[1] ?? null)}>
      {opts.map(([label], i) => <option key={label} value={String(i)}>{label}</option>)}
    </select>
  );
  else if (row.kind === "num") {
    const scale = row.scale ?? 1;
    control = <Input label={row.t} kind="number" unit={row.unit} placeholder={row.ph} disabled={disabled} value={typeof value === "number" ? String(value / scale) : ""} onSave={(s) => { if (s.trim() === "") save(null); else if (Number.isFinite(Number(s))) save(Math.round(Number(s) * scale)); }} />;
  } else if (row.kind === "lines") control = <LinesBox label={row.t} value={Array.isArray(value) ? value.map(String) : []} placeholder={row.ph} disabled={disabled} onCommit={(l) => save(l.length ? l : null)} />;
  else control = <Input label={row.t} unit={row.unit} placeholder={row.ph} disabled={disabled} value={typeof value === "string" ? value : ""} onSave={(s) => save(s.trim() ? s : null)} />;
  const stack = row.kind === "lines" || (row.kind === "text" && !row.unit) || (row.kind === "seg" && opts.length > 3);
  return <Line id={id} label={row.t} help={row.sub} coming={coming} stack={stack} ctlNeed={coming ? undefined : "config.patch"}>{control}</Line>;
}

export type Entry = [app: string, id: string];
export const appName = (apps: { id: string; name: string }[], id: string) => (id === "*" ? "Every app" : apps.find((a) => a.id === id)?.name ?? visible(id));

/** People named per app, with Remove and an Add line (owners, who may use commands, a list's members). */
export function PeopleList({ apps, entries, every, onChange, ph, disabled }: { apps: { id: string; name: string }[]; entries: Entry[]; every?: boolean; onChange: (e: Entry[]) => void; ph: string; disabled?: boolean }) {
  const choices = [...apps.map((a) => ({ id: a.id, label: a.name })), ...(every ? [{ id: "*", label: "Every app" }] : [])];
  const [app, setApp] = useState(choices[0]?.id ?? "");
  const [who, setWho] = useState("");
  const add = () => { const v = who.trim(); if (v && app) { onChange([...entries, [app, v]]); setWho(""); } };
  return (
    <div className="r1-ca-people">
      {entries.length ? entries.map(([a, n], i) => (
        <div key={a + ":" + n + ":" + i} className="r1-ca-person"><span className="g-label">{appName(apps, a)} · {visible(n)}</span><button type="button" disabled={disabled} data-need="config.patch" onClick={() => onChange(entries.filter((_, j) => j !== i))}>Remove</button></div>
      )) : <Hint>No one yet.</Hint>}
      <div className="r1-ca-add">
        <select aria-label="App" value={app} disabled={disabled} data-local="" onChange={(e) => setApp(e.target.value)}>{choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <input className="r1s-inp" placeholder={ph} aria-label={ph} value={who} disabled={disabled} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button type="button" disabled={disabled || !who.trim() || !app} data-need="config.patch" onClick={add}>Add</button>
      </div>
    </div>
  );
}
