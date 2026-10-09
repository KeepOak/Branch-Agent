// Customize › Tools › "Get capabilities": one page with five tabs (Skills, Connectors, Plugins, Trunk templates,
// Automations), as the owner-approved capability structure describes. Skills and Plugins list what is built in,
// installed, and available, with Install or Remove. The other three tabs are not built yet. Install and Remove reuse
// the methods the Plugins and Skills kinds already call (plugins.install, plugins.uninstall, skills.install). A skill
// cannot be removed yet: the engine has no skill remove method, so its Remove is greyed out with the reason. Each source
// loads on its own, so a failed catalogue never hides the rows that come from this computer.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { useResource } from "../library/data";
import { Status } from "../library/ui";
import { ConsentDialog, readItems, usePluginAction, type Item } from "./catalog";
import { Grey, list, Pill, rec, str, type Rec } from "./common";
import { Glyph } from "./glyphs";
import { readPlugins, type Plugin } from "./plugins";
import { readSkillRows, type Skill } from "./skills";

export type Tag = "Bundled" | "Installed" | "Available";
type Action = { method: string; params: Rec };
export type GetRow = { id: string; kind: "Plugin" | "Skill"; name: string; summary: string; tag: Tag; permissions: string | null; install: Action | null; installReason: string; remove: Action | null; removeReason: string };

const TABS = ["Skills", "Connectors", "Plugins", "Trunk templates", "Automations"] as const;
type Tab = (typeof TABS)[number];
const KIND_OF_TAB: Partial<Record<Tab, GetRow["kind"]>> = { Skills: "Skill", Plugins: "Plugin" };
const UNAVAILABLE = "This one can't be installed on this computer.";
const NO_INSTALL = "The catalogue gives no way to install it.";
const SKILL_REMOVE = "Needs the engine's skill remove method.";
const ORDER: Tag[] = ["Installed", "Bundled", "Available"];
const TONE = { Bundled: "idle", Installed: "ok", Available: "work" } as const;

function row(r: Pick<GetRow, "id" | "kind" | "name" | "summary" | "tag"> & Partial<GetRow>): GetRow {
  return { permissions: null, install: null, installReason: "", remove: null, removeReason: "", ...r };
}

/** The permissions a manifest declares, in plain words. Null when the entry declares none. */
export function permissionWords(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const p = rec(value);
  const words: string[] = [];
  if (p.network === true) words.push("reach the network");
  if (p.files === "workspace") words.push("read and write files in this Trunk's folder");
  if (p.runCommands === true) words.push("run commands");
  if (p.secrets === true) words.push("use your saved secrets");
  if (p.computerControl === true) words.push("control this computer");
  return words.length ? `Can ${words.join(", ")}.` : "Asks for no permissions.";
}

function pluginInstall(install: Rec | null, unavailable = false): Pick<GetRow, "install" | "installReason"> {
  if (unavailable) return { install: null, installReason: UNAVAILABLE };
  if (!install) return { install: null, installReason: NO_INSTALL };
  return { install: { method: "plugins.install", params: { ...install, enable: true } }, installReason: "" };
}

function pluginRow(p: Plugin): GetRow {
  const head = { id: `plugin:${p.id}`, kind: "Plugin" as const, name: p.name, summary: p.description };
  if (p.origin === "bundled") return row({ ...head, tag: "Bundled" });
  if (p.installed) return row({ ...head, tag: "Installed", remove: p.removable ? { method: "plugins.uninstall", params: { pluginId: p.id } } : null });
  return row({ ...head, tag: "Available", ...pluginInstall(p.install) });
}

function catalogRow(item: Item): GetRow {
  const unavailable = item.action === "unavailable";
  return row({ id: `plugin:${item.id}`, kind: "Plugin", name: item.name, summary: item.summary, tag: "Available", ...pluginInstall(item.install, unavailable) });
}

function skillRow(s: Skill): GetRow {
  const head = { id: `skill:${s.key}`, kind: "Skill" as const, name: s.name, summary: s.description };
  if (s.raw.bundled === true) return row({ ...head, tag: "Bundled" });
  return row({ ...head, tag: "Installed", removeReason: SKILL_REMOVE });
}

/** Skill-library results that are not installed yet. The slug is the install reference. */
function foundRows(result: unknown, installed: Set<string>, scope: Rec): GetRow[] {
  return list(rec(result).results).flatMap(r => {
    const slug = str(r.installRef) || str(r.slug);
    if (!slug || installed.has(slug)) return [];
    const install = { method: "skills.install", params: { ...scope, source: "clawhub", slug } };
    return [row({ id: `skill:${slug}`, kind: "Skill", name: str(r.displayName) || slug, summary: str(r.summary), tag: "Available", install })];
  });
}

/** Declared permissions from catalogue entries, keyed by row id. Only entries that carry one get a line. */
function permissionsByRow(catalog: unknown, found: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const item of list(rec(catalog).items)) map.set(`plugin:${str(item.id)}`, rec(item.catalog).permissions ?? item.permissions);
  for (const r of list(rec(found).results)) {
    const slug = str(r.installRef) || str(r.slug);
    if (slug) map.set(`skill:${slug}`, r.permissions);
  }
  return map;
}

/** The rows for every source, Installed first, then Bundled, then Available. A source with no data contributes nothing. */
export function buildGetRows(input: { plugins: unknown; catalog: unknown; skills: unknown; found: unknown; scope: Rec }): GetRow[] {
  const local = readPlugins(input.plugins);
  const have = new Set(local.map(p => p.id));
  const skills = readSkillRows(input.skills);
  const installed = new Set(skills.flatMap(s => [s.key, s.name]));
  const perms = permissionsByRow(input.catalog, input.found);
  const rows = [
    ...local.map(pluginRow),
    ...readItems(input.catalog).filter(i => !i.installed && !have.has(i.id)).map(catalogRow),
    ...skills.map(skillRow),
    ...foundRows(input.found, installed, input.scope),
  ];
  return rows.map(r => ({ ...r, permissions: permissionWords(perms.get(r.id)) }))
    .sort((a, b) => ORDER.indexOf(a.tag) - ORDER.indexOf(b.tag) || a.name.localeCompare(b.name));
}

type Work = { row: GetRow; verb: "Install" | "Remove" };

export function GetCapabilitiesDialog({ engine, close, done, scope = {} }: { engine: WindowEngine; close: () => void; done: () => void; scope?: Rec }) {
  const [tab, setTab] = useState<Tab>("Skills");
  const [query, setQuery] = useState("");
  const [work, setWork] = useState<Work | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<GetRow | null>(null);
  const q = query.trim().toLowerCase();
  const search = query.trim() ? { query: query.trim() } : {};
  const plugins = useResource<unknown>(engine, "plugins.list");
  const skills = useResource<unknown>(engine, "skills.status", scope);
  const catalog = useResource<unknown>(engine, "plugins.catalog.browse", { ...search, pageSize: 60 });
  const found = useResource<unknown>(engine, "skills.search", { ...search, limit: 30 });
  const action = usePluginAction(engine);
  const kind = KIND_OF_TAB[tab];
  const rows = buildGetRows({ plugins: plugins.data, catalog: catalog.data, skills: skills.data, found: found.data, scope })
    .filter(r => r.kind === kind && (!q || `${r.name} ${r.summary}`.toLowerCase().includes(q)));
  const remote = str(rec(catalog.data).remoteError);
  const refresh = () => { plugins.reload(); skills.reload(); catalog.reload(); found.reload(); done(); };
  const finish = (id: string | null) => () => { setFinished(id); refresh(); };
  const start = (r: GetRow, verb: Work["verb"], a: Action) => { setWork({ row: r, verb }); setFinished(null); void action.run(r.id, a.method, a.params, finish(r.id)); };
  const confirmRemove = (r: GetRow) => { setConfirming(null); if (r.remove) start(r, "Remove", r.remove); };

  return <Dialog wide title="Get capabilities" onClose={close} testid="get-capabilities" footer={<button type="button" className="btn ghost" onClick={close}>Close</button>}>
    <p className="dlg-p">Skills, plugins and more for your Trunks. Permissions are shown in plain words. Lockdown is coming, so nothing is blocked yet.</p>
    <div className="cz-tabs" role="tablist" aria-label="Capabilities">{TABS.map(t => <button key={t} type="button" role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>{t}</button>)}</div>
    {kind ? <>
      <label className="cz-search"><Icon name="search" small /><input type="search" aria-label={`Search ${tab.toLowerCase()}`} placeholder={`Search ${tab.toLowerCase()}`} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <Status {...plugins} /><Status {...skills} /><Status {...catalog} /><Status {...found} />
      {remote && <p className="cz-hint">{remote}</p>}
      {plugins.data != null && !rows.length && <EmptyLine icon={<Icon name="search" />}>{q ? "Nothing matches. Try another search." : "Nothing to show yet."}</EmptyLine>}
      <div className="get-rows">{rows.map(r => <GetRowCard key={r.id} row={r} busy={action.busy === r.id}
        install={() => r.install && start(r, "Install", r.install)} remove={() => setConfirming(r)} />)}</div>
    </> : <EmptyLine icon={<Glyph name="sparkle" size={22} />}>Coming in a later update.</EmptyLine>}
    {work && <ResultDialog work={work} busy={action.busy === work.row.id} error={action.error} finished={finished === work.row.id} close={() => setWork(null)} />}
    {confirming && <Dialog title={`Remove ${confirming.name}?`} onClose={() => setConfirming(null)} testid="get-remove-confirm"
      footer={<><button type="button" className="btn ghost" onClick={() => setConfirming(null)}>Cancel</button><button type="button" className="btn bad" onClick={() => confirmRemove(confirming)}>Remove</button></>}>
      <p className="dlg-p">Trunks lose its tools.</p>
    </Dialog>}
    <ConsentDialog action={action} done={finish(work?.row.id ?? null)} />
  </Dialog>;
}

function GetRowCard({ row: r, busy, install, remove }: { row: GetRow; busy: boolean; install: () => void; remove: () => void }) {
  return <div className="get-row" data-testid="get-row" data-tag={r.tag}>
    <span className="cz-tile"><Glyph name={r.kind === "Plugin" ? "puzzle" : "bolt"} size={16} /></span>
    <span className="grow"><b>{r.name}</b><small>{r.kind}{r.summary ? " · " + r.summary : ""}</small>{r.permissions && <small className="get-perm">{r.permissions}</small>}</span>
    <Pill tone={TONE[r.tag]}>{r.tag}</Pill>
    <div className="cz-acts">{r.install ? <button type="button" className="btn sm" disabled={busy} onClick={install}>{busy ? "Installing" : "Install"}</button>
      : r.installReason ? <Grey reason={r.installReason}>Install</Grey> : null}
      {r.remove ? <button type="button" className="btn ghost sm" disabled={busy} onClick={remove}>Remove</button>
      : r.removeReason ? <Grey className="btn ghost sm" reason={r.removeReason}>Remove</Grey> : null}</div>
  </div>;
}

/** Opens at once when Install or Remove is confirmed, then says what happened. */
function ResultDialog({ work, busy, error, finished, close }: { work: Work; busy: boolean; error: string | null; finished: boolean; close: () => void }) {
  const name = work.row.name;
  const install = work.verb === "Install";
  const said = busy ? `${install ? "Installing" : "Removing"} ${name}…` : finished ? `${name} is ${install ? "installed" : "removed"}.` : "";
  return <Dialog title={`${work.verb} ${name}`} onClose={close} testid="get-result" footer={<button type="button" className="btn pri" disabled={busy} onClick={close}>Done</button>}>
    <p className="dlg-p" role="status">{said}</p>
    {error && <p role="alert" className="cz-error">{error}</p>}
  </Dialog>;
}
