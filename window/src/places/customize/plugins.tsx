// Tools › Plugins (preview 42-placesbp.js czp*, 93-g3p.js): installed plugins from plugins.list, the detail from
// plugins.inspect, on/off through plugins.setEnabled (with the engine's capability review), updates through
// plugins.install mode "update", Remove through plugins.uninstall, and "Add a plugin" from the catalogue.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { Switch } from "../../shell/Popover";
import { useResource } from "../library/data";
import { Status } from "../library/ui";
import { Dot, Grey, list, Pill, rec, Sec, str, type Rec } from "./common";
import { CatalogDialog, ConsentDialog, usePluginAction } from "./catalog";
import { Glyph } from "./glyphs";
import type { ToolsCtx } from "./tools";

export type Plugin = { id: string; name: string; description: string; state: string; enabled: boolean; installed: boolean; version: string; origin: string; install: Rec | null; removable: boolean; error: string };
export function readPlugins(result: unknown): Plugin[] {
  return list(rec(result).plugins).map(p => ({
    id: str(p.id), name: str(p.name) || str(p.id), description: str(p.description), state: str(p.state), enabled: p.enabled === true, installed: p.installed === true,
    version: str(p.version), origin: str(p.origin), install: p.install ? rec(p.install) : null, removable: p.removable !== false && str(p.origin) !== "bundled", error: str(p.error) || str(rec(p.runtime).error),
  }));
}
export function pluginCount(ctx: ToolsCtx): number | null {
  return ctx.plugins.data ? readPlugins(ctx.plugins.data).filter(p => p.installed && p.enabled).length : null;
}
const FROM: Record<string, string> = { bundled: "Comes with Branch", clawhub: "The plugin catalog", npm: "A package", git: "A git repository", local: "A folder on this computer", workspace: "This Trunk’s folder", global: "Installed" };

export function Plugins({ ctx }: { ctx: ToolsCtx }) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const rows = readPlugins(ctx.plugins.data).filter(p => p.installed);
  const shown = rows.filter(p => !q || (p.name + " " + p.description).toLowerCase().includes(q));
  const plugin = shown.find(p => p.id === chosen) ?? shown[0];
  return <>
    <div className="t9-list">
      <label className="cz-search"><Icon name="search" small /><input type="search" aria-label="Search installed plugins" placeholder="Search installed plugins" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <Status {...ctx.plugins} />
      {ctx.plugins.data != null && !shown.length && <EmptyLine icon={<Glyph name="puzzle" size={22} />}>{q ? "No installed plugin matches." : "No plugins installed yet."}</EmptyLine>}
      {shown.map(p => <button key={p.id} type="button" className="t9-item" aria-current={p.id === plugin?.id} onClick={() => setChosen(p.id)}>
        <span className="cz-tile"><Glyph name="puzzle" size={16} /></span><span className="grow"><b>{p.name}</b><small>{p.description || FROM[p.origin] || p.id}</small></span>
        {p.state === "error" ? <Pill tone="bad" title={p.error}>Needs a look</Pill> : p.state === "needs-setup" ? <Pill tone="warn">Needs setting up</Pill> : <Dot on={p.enabled} />}
      </button>)}
    </div>
    {plugin ? <PluginDetail key={plugin.id} ctx={ctx} plugin={plugin} /> : <div className="t9-detail cz-empty-detail" />}
  </>;
}

const PACK: [string, string][] = [["skills", "Skills"], ["tools", "Tools"], ["mcpServers", "Connectors"], ["channels", "Chat apps"], ["providers", "Models"], ["cliCommands", "Commands"]];
function PluginDetail({ ctx, plugin }: { ctx: ToolsCtx; plugin: Plugin }) {
  const inspect = useResource<unknown>(ctx.engine, "plugins.inspect", { pluginId: plugin.id });
  const action = usePluginAction(ctx.engine);
  const [removing, setRemoving] = useState(false);
  const reload = () => { ctx.plugins.reload(); inspect.reload(); };
  const declared = rec(rec(inspect.data).declared);
  const overview = rec(rec(inspect.data).overview);
  return <div className="t9-detail" data-testid="plugin-detail">
    <div className="t9-dh"><span className="cz-tile big"><Glyph name="puzzle" /></span><span className="grow"><b>{plugin.name}</b><small>{[str(overview.publisherName), FROM[plugin.origin]].filter(Boolean).join(" · from ")}</small></span>
      <Switch label={`${plugin.name} on or off`} on={plugin.enabled} onChange={on => void action.run("toggle", "plugins.setEnabled", { pluginId: plugin.id, enabled: on }, reload)} /></div>
    {action.error && <p role="alert" className="cz-error">{action.error}</p>}
    {plugin.error && <div className="cz-card warn"><b>Needs a look</b><small>{plugin.error}</small></div>}
    <Status {...inspect} />
    {inspect.data != null && <Sec title="In this pack">{PACK.map(([key, word]) => { const items = Array.isArray(declared[key]) ? (declared[key] as unknown[]).map(String) : []; return items.length ? <div key={key} className="cz-pack"><span>{word}</span><div>{items.map(i => <code key={i}>{i}</code>)}</div></div> : null; })}
      {PACK.every(([key]) => !(Array.isArray(declared[key]) && (declared[key] as unknown[]).length)) && <p className="cz-hint">It declares nothing for Trunks to use.</p>}</Sec>}
    <Sec title="Where it came from"><dl className="cz-kv"><dt>Version</dt><dd>{plugin.version || "Not given"}</dd><dt>Installed from</dt><dd>{FROM[plugin.origin] || plugin.origin || "Not given"}</dd>
      {shows(ctx.level, "technical") && <><dt>ID</dt><dd><code>{plugin.id}</code></dd></>}</dl></Sec>
    <div className="cz-acts">{plugin.install ? <button type="button" className="btn sm" disabled={!!action.busy} onClick={() => void action.run("update", "plugins.install", { ...plugin.install, mode: "update" }, reload)}>{action.busy === "update" ? "Checking" : "Check for updates"}</button>
      : <Grey reason="It was not installed from a source Branch can update.">Check for updates</Grey>}
      <span className="cz-grow" />{plugin.removable && <button type="button" className="btn ghost sm" onClick={() => setRemoving(true)}>Remove</button>}</div>
    {removing && <Dialog title={`Remove ${plugin.name}?`} onClose={() => setRemoving(false)} footer={<><button type="button" className="btn ghost" onClick={() => setRemoving(false)}>Cancel</button><button type="button" className="btn bad" disabled={!!action.busy} onClick={() => void action.run("remove", "plugins.uninstall", { pluginId: plugin.id }, () => { setRemoving(false); ctx.plugins.reload(); })}>Remove</button></>}>
      <p className="dlg-p">Everything in it goes: its skills, connectors and tools.</p>{action.error && <p role="alert" className="cz-error">{action.error}</p>}
    </Dialog>}
    <ConsentDialog action={action} done={reload} />
  </div>;
}

export function AddPlugin({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  return <CatalogDialog mode="plugin" engine={ctx.engine} close={close} done={ctx.plugins.reload} />;
}
