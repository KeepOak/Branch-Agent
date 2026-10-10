// The plugin catalogue (plugins.catalog.browse / categories) as the preview's "Add a connector" and "Plugins"
// dialogs (93-g3p.js, 42-placesbp.js czp-dlg). Installs go through plugins.install; when the engine asks for a
// capability review first, the person confirms and the install is sent again with acknowledgeCapabilities.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { errorText, useResource } from "../library/data";
import { Status } from "../library/ui";
import { Grey, list, Logo, rec, str, type Rec } from "./common";
import { shownWhy } from "../../shell/shown-why";

export type Item = { id: string; name: string; summary: string; author: string; categories: string[]; action: string; enabled: boolean; installed: boolean; install: Rec | null };
export function readItems(result: unknown): Item[] {
  return list(rec(result).items).map(i => {
    const c = rec(i.catalog), l = rec(i.local);
    const install = l.install ? rec(l.install) : str(c.packageName) ? { source: "clawhub", packageName: str(c.packageName) } : null;
    return { id: str(i.id), name: str(c.name) || str(i.id), summary: str(c.summary), author: str(c.author), categories: Array.isArray(c.categories) ? c.categories.filter((v): v is string => typeof v === "string") : [], action: str(l.action), enabled: l.enabled === true, installed: l.installed === true, install };
  });
}
type Consent = { method: string; params: Rec; token: string; message: string };
/** Runs a plugin mutation; a capability-consent refusal comes back as a review to confirm, not an error. */
export function usePluginAction(engine: WindowEngine) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<Consent | null>(null);
  async function run(key: string, method: string, params: Rec, done: () => void) {
    setBusy(key); setError(null);
    try {
      const result = rec(await engine.request(method, params));
      if (result.ok === false) throw new Error(str(result.error) || str(result.message) || "The engine did not apply this change.");
      setConsent(null); done();
    } catch (e) {
      const details = rec(rec(e).details);
      if (str(details.capabilityConsentCode) && str(details.reviewToken)) setConsent({ method, params, token: str(details.reviewToken), message: errorText(e) });
      else setError(errorText(e));
    } finally { setBusy(null); }
  }
  return { busy, error, consent, run, dismiss: () => setConsent(null) };
}
export type PluginAction = ReturnType<typeof usePluginAction>;
/** The capability review the engine asked for: shows its words and sends the action again once confirmed. */
export function ConsentDialog({ action, done }: { action: PluginAction; done: () => void }) {
  const c = action.consent;
  if (!c) return null;
  return <Dialog title="Let it do more?" onClose={action.dismiss} footer={<><button type="button" className="btn ghost" onClick={action.dismiss}>Not now</button><button type="button" className="btn pri" disabled={!!action.busy} onClick={() => void action.run("consent", c.method, { ...c.params, acknowledgeCapabilities: { reviewToken: c.token } }, done)}>Allow</button></>}>
    <p className="dlg-p">{c.message}</p>
  </Dialog>;
}

const INTENTS = [{ id: "all", name: "All" }, { id: "featured", name: "Featured" }, { id: "trending", name: "Trending" }, { id: "official", name: "Official" }, { id: "bundled", name: "Built in" }];

export function CatalogDialog({ mode, engine, close, ownServer, done }: { mode: "connector" | "plugin"; engine: WindowEngine; close: () => void; ownServer?: () => void; done: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const categories = useResource<unknown>(engine, "plugins.catalog.categories");
  const cats = list(rec(categories.data).categories).map(c => ({ id: str(c.slug), name: str(c.label) })).filter(c => c.id);
  const isIntent = INTENTS.some(i => i.id === filter);
  const browse = useResource<unknown>(engine, "plugins.catalog.browse", { ...(query.trim() ? { query: query.trim() } : {}), ...(isIntent ? { intent: filter } : { category: filter }), pageSize: 60 });
  const items = readItems(browse.data);
  const action = usePluginAction(engine);
  const remote = str(rec(browse.data).remoteError);
  const install = (i: Item) => { if (i.install) void action.run(i.id, "plugins.install", { ...i.install, enable: true }, () => { browse.reload(); done(); }); };
  const tabs = mode === "connector" ? [{ id: "all", name: "All" }, ...cats] : [...INTENTS, ...cats];
  return <Dialog wide title={mode === "connector" ? "Add a connector" : "Plugins"} onClose={close} testid="catalog"
    footer={mode === "connector" ? <><button type="button" className="btn ghost" onClick={close}>Cancel</button><button type="button" className="btn" onClick={ownServer}>Add your own server</button></> : null}>
    <p className="dlg-p">{mode === "connector" ? "Connectors in curated groups, or add your own server." : "A plugin adds everything in it at once, and you can switch parts off afterwards."}</p>
    <div className="cz-top"><label className="cz-search"><Icon name="search" small /><input type="search" aria-label={mode === "connector" ? "Search connectors" : "Search plugins"} placeholder={mode === "connector" ? "Search connectors" : "Search plugins"} value={query} onChange={e => setQuery(e.target.value)} /></label>
      {mode === "connector" && <><Grey reason="Needs the engine's public registry search.">Public registry</Grey><Grey reason="Needs the engine's import from other apps.">Bring in from other apps</Grey></>}</div>
    <div className="cz-tabs" role="tablist" aria-label="Groups">{tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={filter === t.id} onClick={() => setFilter(t.id)}>{t.name}</button>)}</div>
    <Status {...browse} />{remote && <p className="cz-hint">{remote}</p>}
    {action.error && <p role="alert" className="cz-error">{action.error}</p>}
    {browse.data != null && !items.length && <EmptyLine icon={<Icon name="search" />}>{mode === "connector" ? "Nothing matches. Add your own server below." : "No plugins found. Try another search or filter."}</EmptyLine>}
    {groupItems(items, filter === "all" ? cats : []).map(g => <section key={g.id} className="cz-grp-sec">{g.name && <h3 className="cz-grp">{g.name} <span>{g.items.length}</span></h3>}
      <div className="cz-provs">{g.items.map(i => <CatalogCard key={i.id} item={i} busy={action.busy === i.id} install={() => install(i)} />)}</div></section>)}
    <ConsentDialog action={action} done={() => { browse.reload(); done(); }} />
  </Dialog>;
}

/** On "All", cards sit under their first category's heading (preview "WORK 12"); otherwise one plain group. */
function groupItems(items: Item[], cats: { id: string; name: string }[]): { id: string; name: string; items: Item[] }[] {
  if (!cats.length) return [{ id: "all", name: "", items }];
  const groups = cats.map(c => ({ ...c, items: items.filter(i => i.categories[0] === c.id) }));
  const rest = items.filter(i => !cats.some(c => c.id === i.categories[0]));
  return [...groups, { id: "other", name: "Other", items: rest }].filter(g => g.items.length);
}

function CatalogCard({ item, busy, install }: { item: Item; busy: boolean; install: () => void }) {
  const state = item.installed ? (item.enabled ? "On" : "Off") : null;
  const reason = item.action === "unavailable" ? "This one can't be installed on this computer." : !item.install ? "The catalogue gives no way to install it." : undefined;
  return <div className="cz-prov">
    <div className="cz-prov-h"><Logo name={item.name} /><span className="grow"><b>{item.name}</b>{item.author && <small>@{item.author}</small>}</span></div>
    <small>{item.summary}</small>
    {state ? <span className="cz-state">{state}</span>
      : <button type="button" className="btn sm" disabled={busy || !!reason} title={shownWhy(reason)} onClick={install}>{busy ? "Installing" : "Install"}</button>}
  </div>;
}
