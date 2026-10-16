// Tools › Plugins (preview 42-placesbp.js czp*, 93-g3p.js): installed plugins from plugins.list, the detail from
// plugins.inspect, on/off through plugins.setEnabled (with the engine's capability review), updates through
// plugins.install mode "update", Remove through plugins.uninstall, and "Add a plugin" from the catalogue.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { Switch } from "../../shell/Popover";
import { useResource } from "../library/data";
import { Status } from "../library/ui";
import { Grey, list, Pill, rec, Sec, str, type Rec } from "./common";
import { KindHead, TechnicalOnly } from "./kind-chrome";
import { TechRows } from "./tech-rows";
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
  const [chosen, setChosen] = useState<string | null>(null);
  const q = ctx.query.trim().toLowerCase();
  const rows = readPlugins(ctx.plugins.data).filter(p => p.installed);
  const shown = rows.filter(p => !q || (p.name + " " + p.description).toLowerCase().includes(q));
  const plugin = shown.find(p => p.id === chosen) ?? shown[0];
  const action = usePluginAction(ctx.engine);
  return <>
    <KindHead ctx={ctx} kind="Plugins" count={`${rows.filter(p => p.enabled).length} of ${rows.length} on`}>
      <Status {...ctx.plugins} />
      {ctx.plugins.data != null && !shown.length && <EmptyLine icon={<Glyph name="puzzle" size={22} />}>{q ? "No installed plugin matches." : "No plugins installed yet."}</EmptyLine>}
      {shown.map(p => <div key={p.id} className="cz-rowline" role="listitem">
        <button type="button" className="t9-item" aria-current={p.id === plugin?.id} onClick={() => setChosen(p.id)}>
          <span className="cz-tile"><Glyph name="puzzle" size={16} /></span><span className="grow"><b>{p.name}</b><small>{p.description || FROM[p.origin] || p.id}</small></span>
          {p.state === "error" ? <Pill tone="bad" title={p.error}>Needs a look</Pill> : p.state === "needs-setup" ? <Pill tone="warn">Needs setting up</Pill> : null}
        </button>
        <Switch label={`${p.name} on or off`} on={p.enabled} onChange={on => void action.run("toggle", "plugins.setEnabled", { pluginId: p.id, enabled: on }, ctx.plugins.reload)} />
      </div>)}
      <TechRows ctx={ctx} kind="Plugins" />
      {action.error && <p role="alert" className="cz-error">{action.error}</p>}
      <ConsentDialog action={action} done={ctx.plugins.reload} />
    </KindHead>
    {plugin ? <PluginDetail key={plugin.id} ctx={ctx} plugin={plugin} /> : <div className="t9-detail cz-empty-detail" />}
  </>;
}

const PACK: [string, string][] = [["skills", "Skills"], ["tools", "Tools"], ["mcpServers", "Connectors"], ["channels", "Chat apps"], ["providers", "Models"], ["cliCommands", "Commands"]];
function PluginDetail({ ctx, plugin }: { ctx: ToolsCtx; plugin: Plugin }) {
  const inspect = useResource<unknown>(ctx.engine, "plugins.inspect", { pluginId: plugin.id });
  const action = usePluginAction(ctx.engine);
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState<"installed" | "settings">("installed");
  const reload = () => { ctx.plugins.reload(); inspect.reload(); };
  const declared = rec(rec(inspect.data).declared);
  const overview = rec(rec(inspect.data).overview);
  return <div className="t9-detail" data-testid="plugin-detail">
    <div className="t9-dh"><span className="cz-tile big"><Glyph name="puzzle" /></span><span className="grow"><b>{plugin.name}</b><small>{[str(overview.publisherName), FROM[plugin.origin]].filter(Boolean).join(" · from ")}</small></span>
      <Switch label={`${plugin.name} on or off`} on={plugin.enabled} onChange={on => void action.run("toggle", "plugins.setEnabled", { pluginId: plugin.id, enabled: on }, reload)} /></div>
    {action.error && <p role="alert" className="cz-error">{action.error}</p>}
    {plugin.error && <div className="cz-card warn"><b>Needs a look</b><small>{plugin.error}</small></div>}
    <TechnicalOnly><div className="cz-tabs" role="tablist" aria-label="Plugin"><button type="button" role="tab" aria-selected={tab === "installed"} onClick={() => setTab("installed")}>Installed</button><button type="button" role="tab" aria-selected={tab === "settings"} onClick={() => setTab("settings")}>Plugin settings</button></div></TechnicalOnly>
    {tab === "settings" && shows(ctx.level, "technical") ? <PluginSettings /> : <>
    <Status {...inspect} />
    {inspect.data != null && <Sec title="Set it up">{PACK.map(([key, word]) => { const items = Array.isArray(declared[key]) ? (declared[key] as unknown[]).map(String) : []; return items.length ? <div key={key} className="cz-pack"><span>{word}</span><div>{items.map(i => <code key={i}>{i}</code>)}</div></div> : null; })}
      {PACK.every(([key]) => !(Array.isArray(declared[key]) && (declared[key] as unknown[]).length)) && <p className="cz-hint">Nothing here for this Trunk.</p>}</Sec>}
    <Sec title="Safety check"><dl className="cz-kv"><dt>Preflight</dt><dd>Not checked yet</dd><dt>Malware scan</dt><dd>Not checked yet</dd><dt>Fingerprint</dt><dd>Not checked yet</dd><dt>Hidden instructions</dt><dd>Not checked yet</dd></dl></Sec>
    <Sec title="Version & updates"><dl className="cz-kv"><dt>Version</dt><dd>{plugin.version}</dd><dt>Installed from</dt><dd>{FROM[plugin.origin] || plugin.origin}</dd>
      {shows(ctx.level, "technical") && <><dt>ID</dt><dd><code>{plugin.id}</code></dd></>}</dl>
      <div className="cz-acts">{plugin.install ? <button type="button" className="btn sm" disabled={!!action.busy} onClick={() => void action.run("update", "plugins.install", { ...plugin.install, mode: "update" }, reload)}>{action.busy === "update" ? "Checking" : "Check for updates"}</button> : <Grey reason="Checking this plugin for updates comes in a later update.">Check for updates</Grey>}</div></Sec>
    <Sec title="Actions"><div className="cz-acts"><Grey reason="Copying a plugin’s seed comes in a later update.">Copy seed</Grey><Grey reason="Downloading a plugin comes in a later update.">Download</Grey><Grey reason="Copying a plugin to another Trunk comes in a later update.">Copy to another Trunk</Grey><Grey reason="Testing a plugin from here comes in a later update.">Test it</Grey><span className="cz-grow" />{plugin.removable && <button type="button" className="btn ghost sm" onClick={() => setRemoving(true)}>Remove</button>}</div></Sec>
    {removing && <Dialog title={`Remove ${plugin.name}?`} onClose={() => setRemoving(false)} footer={<><button type="button" className="btn ghost" onClick={() => setRemoving(false)}>Cancel</button><button type="button" className="btn bad" disabled={!!action.busy} onClick={() => void action.run("remove", "plugins.uninstall", { pluginId: plugin.id }, () => { setRemoving(false); ctx.plugins.reload(); })}>Remove</button></>}>
      <p className="dlg-p">Everything in it goes: its skills, connectors and tools.</p>{action.error && <p role="alert" className="cz-error">{action.error}</p>}
    </Dialog>}
    </>}
    <ConsentDialog action={action} done={reload} />
  </div>;
}

/** Plugin settings (preview 38573, 28207): how it runs, where it is on, its start link, a test, and what it may do.
 *  The engine has no per-plugin settings yet, so each control is Coming with its reason. */
function PluginSettings() {
  const ON_IN = ["Every folder", "Only folders you pick", "Every folder except some", "Only in conversations you attach it to"];
  const PERMS = ["Add context to prompts", "Read conversation content", "Choose the model for its helpers"];
  return <>
    <Sec title="How it runs"><dl className="cz-kv"><dt>What it listens to</dt><dd>Not set</dd>
      <dt>What it stores</dt><dd><Grey reason="Clearing what a plugin stores comes in a later update.">Clear</Grey></dd>
      <dt>Where it runs</dt><dd>Not set</dd></dl></Sec>
    <Sec title="On in"><div className="cz-seg-row">{ON_IN.map(o => <Grey key={o} className="btn sm" reason="Choosing where a plugin is on comes in a later update.">{o}</Grey>)}</div>
      <small>Off: on wherever its Trunks work.</small></Sec>
    <Sec title="A start link"><div className="cz-acts"><Grey reason="Copying a plugin’s start link comes in a later update.">Copy</Grey>
      <Grey reason="Choosing who may use a start link comes in a later update.">Everyone</Grey><Grey reason="Choosing who may use a start link comes in a later update.">Owners only</Grey><Grey reason="Choosing who may use a start link comes in a later update.">Off</Grey></div></Sec>
    <Sec title="Test against your tasks first"><div className="cz-line"><span>Runs a test set with and without it and compares, before you turn it on.</span><Grey reason="Running a plugin test set comes in a later update.">Run</Grey></div></Sec>
    <Sec title="Permissions"><p className="cz-hint">Plugins from outside Branch may read conversations only after you allow it.</p>
      {PERMS.map(p => <div key={p} className="cz-perm"><code>{p}</code><div className="cz-seg" role="radiogroup" aria-label={p}>
        <Grey reason="Changing what a plugin may do comes in a later update.">Allowed</Grey><Grey reason="Changing what a plugin may do comes in a later update.">Never</Grey></div></div>)}
    </Sec>
  </>;
}

export function AddPlugin({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  return <CatalogDialog mode="plugin" engine={ctx.engine} close={close} done={ctx.plugins.reload} />;
}
