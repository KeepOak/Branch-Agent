// Settings › Appearance › Themes (§4.7.3.1): every theme the engine has (themes.list: built in, from plugins, yours),
// shown in Daylight or Moonlight; pick one (themes.set), make, edit, copy, share, paste or delete your own
// (themes.import; a deletion clears its users.prefs entry, "ui.themeDefinition.<id>").
import { useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { Icon } from "../../../shell/icons";
import { errorText, list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, useLevel } from "../kit";
import { BUILTIN, DEFAULT_THEME, EF_KEYS, isHex, pairOfDefinition, SLATE, type Ef, type Mode, type Pair } from "./appearance-look";

export type ThemeDesc = { id: string; name: string; description?: string; source: "builtin" | "plugin" | "user"; modes?: Mode[] };
export type Current = { id: string; mode?: string; effectiveMode?: Mode; overrides?: { id?: string; mode?: string } };
export type Extra = Partial<Record<string, { light?: Partial<Ef>; dark?: Partial<Ef> }>>;
export type Themes = { list: ThemeDesc[]; current: Current | null; pairOf: (id: string) => Pair | undefined; loading: boolean; error?: string; reload: () => Promise<void> };

export const PALETTE_ICON = <svg className="i s" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.5 17 3 12 3z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="7.5" cy="11" r="1.2" fill="currentColor" /><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" /><circle cx="15" cy="7.5" r="1.2" fill="currentColor" /></svg>;
export const GROUP: Record<ThemeDesc["source"], string> = { builtin: "Branch", plugin: "From plugins", user: "Yours" };
export const localId = (id: string) => id.replace(/^user\//, "");
/** A theme's name as the window shows it: the default theme draws with the window's own Branch Slate colours. */
export const themeName = (t: Pick<ThemeDesc, "id" | "name">) => (t.id === DEFAULT_THEME ? "Branch Slate" : visible(t.name));

/** The engine's themes, with the colours of each (built in from the table, the rest from themes.get). */
export function useThemes(engine: WindowEngine, extra: Extra): Themes {
  const res = useResource<RecordValue>(engine, "themes.list", {});
  const [defs, setDefs] = useState<Record<string, RecordValue>>({});
  const themes = useMemo(() => list(res.data?.themes) as unknown as ThemeDesc[], [res.data]);
  useEffect(() => {
    for (const t of themes) {
      if (t.source === "builtin" || defs[t.id]) continue;
      engine.request("themes.get", { id: t.id }).then(
        (r) => setDefs((d) => ({ ...d, [t.id]: record(record(r).definition) })),
        (e: unknown) => console.warn(`The colours of ${t.id} couldn’t be read:`, errorText(e)),
      );
    }
  }, [engine, themes, defs]);
  const pairOf = (id: string): Pair | undefined => BUILTIN[id] ?? (defs[id] ? pairOfDefinition(defs[id], extra[localId(id)]) : undefined);
  const current = res.data?.current ? (record(res.data.current) as unknown as Current) : null;
  return { list: themes, current, pairOf, loading: res.loading, error: res.error, reload: res.reload };
}

/** A small drawing of a look: the list, a few lines of text, a card and an accent button. */
export function Swatch({ c }: { c: Ef }) {
  return (
    <span className="sw6" aria-hidden="true" style={{ ["--a" as string]: c.side, ["--b" as string]: c.bg, ["--c" as string]: c.raise, ["--d" as string]: c.ink, ["--e" as string]: c.accent, ["--g" as string]: c.line }}>
      <i className="s1" /><i className="s2"><em /><em /><u /><b /></i>
    </span>
  );
}

/** The theme code people paste on another computer: {"branchTheme":1,"name":…,"light":{…},"dark":{…}}. */
export const themeCode = (name: string, p: Pair) => JSON.stringify({ branchTheme: 1, name, light: p.light, dark: p.dark });
export function readThemeCode(txt: string): { name: string; pair: Pair } | null {
  let o: RecordValue;
  try { o = record(JSON.parse(txt)); } catch { return null; } // not JSON: not a theme code
  const clean = (m: unknown) => { const r = record(m); return EF_KEYS.every((k) => isHex(r[k])) ? (Object.fromEntries(EF_KEYS.map((k) => [k, String(r[k]).toLowerCase()])) as Ef) : null; };
  const light = clean(o.light), dark = clean(o.dark);
  if (o.branchTheme !== 1 || !light || !dark) return null;
  return { name: String(o.name || "Pasted theme").slice(0, 40), pair: { light, dark } };
}

type DialogProps = {
  themes: Themes; currentId: string; mode: Mode; contrast: boolean;
  onContrast: (on: boolean) => void; onPick: (id: string) => Promise<boolean>; onMake: () => void; onEdit: (t: ThemeDesc) => void;
  onImport: (name: string, pair: Pair) => Promise<boolean>; onDelete: (t: ThemeDesc) => Promise<boolean>; onClose: () => void;
};
type Sub = { kind: "code" | "delete"; t: ThemeDesc } | { kind: "paste" } | null;

export function ThemesDialog(p: DialogProps) {
  const level = useLevel();
  const [tab, setTab] = useState("All");
  const [q, setQ] = useState("");
  const [prev, setPrev] = useState<Mode>(p.mode);
  const [sub, setSub] = useState<Sub>(null);
  const all = p.themes.list;
  const tabs = ["All", "Branch", ...(all.some((t) => t.source === "plugin") ? ["From plugins"] : []), "Yours"];
  const shown = all.filter((t) => (tab === "All" || GROUP[t.source] === tab) && (!q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase())));
  if (sub) return <ThemeSubDialog {...p} sub={sub} back={() => setSub(null)} />;
  const foot = (
    <div className="gal-foot ap-k">
      <label className="chk-k"><input type="checkbox" checked={p.contrast} onChange={(e) => p.onContrast(e.target.checked)} /> More contrast</label>
      <span className="grow" />
      {level >= 1 ? <Btn sm disabled title="The engine can’t fetch a theme from a link yet.">Import from a link</Btn> : null}
      <Btn sm onClick={() => setSub({ kind: "paste" })}>Paste a theme code</Btn>
      <Btn pri sm onClick={p.onMake}>{PALETTE_ICON}Make your own</Btn>
      <p className="hint">{`The ${all.length} themes come with Branch, its plugins and you, each in Daylight and Moonlight. Picking one keeps your light or dark choice. Picking a theme also puts the accent and fonts back to the theme’s own.`}</p>
    </div>
  );
  return (
    <Dialog title="Themes" wide onClose={p.onClose} footer={foot}>
      <div className="gal-top ap-k"><span className="tabs" role="tablist">{tabs.map((g) => <button key={g} className="tab" type="button" role="tab" aria-selected={g === tab} onClick={() => setTab(g)}>{g}{g === "Yours" ? <span className="n">{all.filter((t) => t.source === "user").length}</span> : null}</button>)}</span></div>
      <div className="gal-bar ap-k">
        <label className="gal-q"><Icon name="search" small /><input className="inp" placeholder={`Search ${all.length} themes`} value={q} aria-label="Search themes" onChange={(e) => setQ(e.target.value)} /></label>
        <span className="sseg" role="group" aria-label="Show the themes in">{([["light", "Daylight"], ["dark", "Moonlight"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={prev === v} onClick={() => setPrev(v)}>{l}</button>)}</span>
      </div>
      <div className="themes6 ap-k">
        {shown.map((t) => <ThemeCard key={t.id} t={t} p={p} prev={prev} setSub={setSub} />)}
        {!shown.length && q.trim() ? <p className="hint">No theme has that name.</p> : null}
        {tab === "All" || tab === "Yours" ? <button className="theme6 make" type="button" onClick={p.onMake}>{PALETTE_ICON}<b>Make your own</b><small>Pick every colour</small></button> : null}
      </div>
    </Dialog>
  );
}

function ThemeCard({ t, p, prev, setSub }: { t: ThemeDesc; p: DialogProps; prev: Mode; setSub: (s: Sub) => void }) {
  const pair = p.themes.pairOf(t.id) ?? SLATE;
  const mine = t.source === "user";
  return (
    <div className="theme6" aria-current={p.currentId === t.id}>
      <button className="theme6-b" type="button" aria-pressed={p.currentId === t.id} aria-label={themeName(t)} title={visible(t.description ?? "")} onClick={() => void p.onPick(t.id)}>
        <Swatch c={pair[prev]} /><b>{themeName(t)}</b><small>{GROUP[t.source]}</small>
      </button>
      {mine ? (
        <span className="my-acts">
          <button type="button" onClick={() => p.onEdit(t)}>Edit</button>
          <button type="button" onClick={() => void p.onImport(`${t.name} copy`.slice(0, 40), pair)}>Copy</button>
          <button type="button" onClick={() => setSub({ kind: "code", t })}>Code</button>
          <button type="button" onClick={() => setSub({ kind: "delete", t })}>Delete</button>
        </span>
      ) : null}
    </div>
  );
}

function ThemeSubDialog(p: DialogProps & { sub: NonNullable<Sub>; back: () => void }) {
  if (p.sub.kind === "paste") return <PasteDialog {...p} />;
  if (p.sub.kind === "code") return <CodeDialog t={p.sub.t} pair={p.themes.pairOf(p.sub.t.id) ?? SLATE} back={p.back} />;
  const t = p.sub.t;
  const del = async () => { if (await p.onDelete(t)) p.back(); };
  return (
    <Dialog title={`Delete ${visible(t.name)}?`} onClose={p.back} footer={<><Btn ghost onClick={p.back}>Keep it</Btn><Btn className="bad" onClick={() => void del()}>Delete</Btn></>}>
      <p className="ap-p">It is removed from your themes. Anything using it goes back to the default theme.</p>
    </Dialog>
  );
}

function CodeDialog({ t, pair, back }: { t: ThemeDesc; pair: Pair; back: () => void }) {
  const code = themeCode(t.name, pair);
  const [said, setSaid] = useState("Select the code below to copy it. Paste it on another computer (Themes › Paste a theme code) or send it to a friend.");
  useEffect(() => {
    navigator.clipboard?.writeText(code).then(
      () => setSaid("Copied. Paste it on another computer (Themes › Paste a theme code) or send it to a friend."),
      (e: unknown) => console.warn("The theme code wasn’t copied:", errorText(e)),
    );
  }, [code]);
  return (
    <Dialog title={`${visible(t.name)}: theme code`} onClose={back} footer={<Btn pri onClick={back}>Done</Btn>}>
      <p className="ap-p">{said}</p>
      <textarea className="inp code6" readOnly rows={6} value={code} aria-label="Theme code" />
    </Dialog>
  );
}

function PasteDialog(p: DialogProps & { back: () => void }) {
  const [txt, setTxt] = useState("");
  const [why, setWhy] = useState("");
  const go = async () => {
    const t = readThemeCode(txt);
    if (!t) { setWhy("That isn’t a Branch theme code. It starts with {\"branchTheme\":1."); return; }
    if (await p.onImport(t.name, t.pair)) p.back();
  };
  return (
    <Dialog title="Paste a theme code" onClose={p.back} footer={<><Btn ghost onClick={p.back}>Cancel</Btn><Btn pri onClick={() => void go()}>Add theme</Btn></>}>
      <textarea className="inp code6" rows={6} value={txt} placeholder={'{"branchTheme":1,"name":…}'} aria-label="Theme code" onChange={(e) => setTxt(e.target.value)} />
      {why ? <p className="hint" role="alert">{why}</p> : null}
    </Dialog>
  );
}

/** A new id for a theme of your own: its name in lower case, and a time stamp so two of a name never clash. */
export function newThemeId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";
  return `${slug}-${Date.now().toString(36)}`;
}
