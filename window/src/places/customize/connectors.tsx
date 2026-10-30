// Tools › Connectors: the MCP servers in the engine's config (mcp.servers.<name>). On/off, which Trunks may use
// it (a "<server>__*" entry in that Trunk's tools.deny) and each tool's Allowed / Never (toolFilter.exclude),
// all through config.patch. Tools a server offers come from tools.effective for the open conversation.
// TODO(engine-lane): Test it / Check for updates stay greyed until the engine has a connector test method and update check.
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import { shownWhy } from "../../shell/shown-why";
import { Switch } from "../../shell/Popover";
import { trunkName, useResource } from "../library/data";
import { plainError } from "../../shell/plain-error";
import { Status } from "../library/ui";
import { denyList, denyPatch, Grey, list, PermRow, rec, Sec, Seg, str, WhoChips, withItem, type Rec } from "./common";
import { CatalogDialog } from "./catalog";
import { KindHead, TechnicalOnly } from "./kind-chrome";
import { TechRows } from "./tech-rows";
import { Glyph } from "./glyphs";
import { AppLogo, markKey } from "./app-logos";
import type { ToolsCtx } from "./tools";

type Server = { name: string; enabled: boolean; local: boolean; line: string; exclude: string[]; parallel: boolean; sslVerify: boolean };

export function readServers(live: Rec, file: Rec): Server[] {
  const servers = rec(rec(live.mcp).servers);
  const written = rec(rec(file.mcp).servers);
  return Object.entries(servers).map(([name, value]) => {
    const s = rec(value);
    const own = rec(written[name]);
    const local = typeof s.command === "string";
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [];
    const exclude = rec(own.toolFilter ?? s.toolFilter).exclude;
    return {
      name, enabled: s.enabled !== false, local,
      line: local ? `Local command · ${[str(s.command), ...args].join(" ")}` : `Remote server${str(s.url) ? " · " + str(s.url) : ""}`,
      exclude: Array.isArray(exclude) ? exclude.filter((v): v is string => typeof v === "string") : [],
      parallel: s.supportsParallelToolCalls === true, sslVerify: s.sslVerify !== false,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
/** A connector named for a known app shows that app's logo (app-logos.tsx); any other server keeps its line-icon tile. */
function Mark({ server, size }: { server: Server; size: number }) {
  if (markKey(server.name)) return <AppLogo name={server.name} size={size} />;
  return <span className={size > 32 ? "cz-tile big" : "cz-tile"}><Glyph name={server.local ? "terminal" : "globe"} size={size > 32 ? undefined : 16} /></span>;
}
const wildcard = (server: string) => `${server}__*`;
function mayUse(ctx: ToolsCtx, server: string, agentId: string) {
  const file = ctx.config.data?.file ?? {};
  return !denyList(file, null).includes(wildcard(server)) && !denyList(file, agentId).includes(wildcard(server));
}
export function connectorCount(ctx: ToolsCtx): number | null {
  const data = ctx.config.data;
  if (!data) return null;
  return readServers(data.live, data.file).filter(s => s.enabled && (!ctx.whose || mayUse(ctx, s.name, ctx.whose))).length;
}

/** Person-facing reasons for the greyed Test it / Check for updates controls (shownWhy keeps developer notes out of sight). */
export const NO_SERVER_WHY = "Testing a connector comes in a later update.";
export const TEST_WHY = "Testing a connector comes in a later update.";
export const UPDATE_WHY = "Checking a connector for updates comes in a later update.";

function ConnectorActs({ server, onRemove }: { server?: Server; onRemove?: () => void }) {
  const testWhy = server ? TEST_WHY : NO_SERVER_WHY;
  const updateWhy = server ? UPDATE_WHY : NO_SERVER_WHY;
  return <div className="cz-acts">
    <Grey reason={testWhy}>Test it</Grey>
    <Grey reason={updateWhy}>Check for updates</Grey>
    {onRemove && <><span className="cz-grow" /><button type="button" className="btn ghost sm" onClick={onRemove}>Remove</button></>}
    <TechnicalOnly>{shownWhy(testWhy) && <span className="cz-hint">{shownWhy(testWhy)}</span>}
      {shownWhy(updateWhy) && updateWhy !== testWhy && <span className="cz-hint">{shownWhy(updateWhy)}</span>}</TechnicalOnly>
  </div>;
}

export function Connectors({ ctx }: { ctx: ToolsCtx }) {
  const { config } = ctx;
  const servers = config.data ? readServers(config.data.live, config.data.file) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState(false);
  const q = ctx.query.trim().toLowerCase();
  const shown = servers.filter(s => !q || `${s.name} ${s.line}`.toLowerCase().includes(q));
  const server = shown.find(s => s.name === chosen) ?? shown[0];
  const on = servers.filter(s => s.enabled && (!ctx.whose || mayUse(ctx, s.name, ctx.whose))).length;
  const setEnabled = (name: string, enabled: boolean) => void config.patch({ mcp: { servers: { [name]: { enabled } } } });
  return <>
    <KindHead ctx={ctx} kind="Connectors" count={`${on} of ${servers.length} on`}>
      {ctx.toCommunity && <div className="cz-acts-top">
        <button type="button" className="btn sm" onClick={() => ctx.toCommunity?.("mcp")}>Bring in from other apps</button>
        <button type="button" className="btn sm" onClick={() => ctx.toCommunity?.("mcp")}>Public registry</button>
        <button type="button" className="btn sm" onClick={() => ctx.openAdd("Connectors")}>Add your own server</button>
      </div>}
      {config.data && <div className="cz-bar"><button type="button" className="btn ghost sm" disabled={config.loading} onClick={() => { config.reload(); setReloaded(true); }}>Reload connectors</button>
        {reloaded && !config.loading && <small role="status">Reloaded {servers.length} connectors from settings just now. Nothing restarted.</small>}</div>}
      <Status {...config} />
      {config.data && !servers.length && <EmptyLine icon={<Glyph name="puzzle" size={22} />}>Nothing here for this Trunk.</EmptyLine>}
      {shown.map(s => <div key={s.name} className="cz-rowline" role="listitem">
        <button type="button" className="t9-item" aria-current={s.name === server?.name} onClick={() => setChosen(s.name)}>
          <Mark server={s} size={32} />
          <span className="grow"><b>{s.name}</b><small>{s.line}</small></span>
        </button>
        <Switch label={`${s.name} on or off`} on={s.enabled} onChange={next => setEnabled(s.name, next)} />
      </div>)}
      <TechRows ctx={ctx} kind="Connectors" />
    </KindHead>
    {server ? <ConnectorDetail key={server.name} ctx={ctx} server={server} /> : <div className="t9-detail cz-empty-detail"><ConnectorActs /></div>}
  </>;
}

function ConnectorDetail({ ctx, server }: { ctx: ToolsCtx; server: Server }) {
  const { config, trunks, whose, level } = ctx;
  const [removing, setRemoving] = useState(false);
  const file = config.data?.file ?? {};
  const setWho = (agentId: string, on: boolean) => { const p = denyPatch(agentId, withItem(denyList(file, agentId), wildcard(server.name), !on)); void config.patch(p.raw, p.replacePaths); };
  const setServer = (fields: Rec) => void config.patch({ mcp: { servers: { [server.name]: fields } } });
  const scoped = whose ? trunks.find(t => t.id === whose) : undefined;
  return <div className="t9-detail" data-testid="connector-detail">
    <div className="t9-dh"><Mark server={server} size={40} />
      <span className="grow"><b>{server.name}</b><small>{server.line}</small></span>
      <Switch label={`${server.name} on or off`} on={server.enabled} onChange={on => setServer({ enabled: on })} />
    </div>
    {config.writeError && <p role="alert" className="cz-error">{plainError(config.writeError)}</p>}
    {scoped ? <div className="cz-line"><span>{scoped.identity?.name || scoped.name || scoped.id} may use it</span><Switch label={`${scoped.id} may use ${server.name}`} on={mayUse(ctx, server.name, scoped.id)} onChange={on => setWho(scoped.id, on)} /></div>
      : <Sec title="Who may use it"><WhoChips trunks={trunks} may={id => mayUse(ctx, server.name, id)} toggle={config.busy ? undefined : setWho} reason="Saving…" /></Sec>}
    <ConnectorTools ctx={ctx} server={server} />
    <Sec title="Set it up">
      {shows(level, "advanced") && <>
        <h3 className="cz-h3">Connection</h3>
        <div className="cz-line"><span>Several calls at once</span><Switch label="Several calls at once" on={server.parallel} onChange={on => setServer({ supportsParallelToolCalls: on })} /></div>
        {!server.local && <div className="cz-line"><span>Check the server’s certificate</span><Switch label="Check the server’s certificate" on={server.sslVerify} onChange={on => setServer({ sslVerify: on })} /></div>}
        <TechnicalOnly>
        <div className="cz-line"><span>Only these tools<small>None picked: every tool.</small></span><Grey reason="Choosing which tools a connector may offer comes in a later update.">Choose</Grey></div>
        <div className="cz-line"><span>Never these tools<small>Hidden tools are not offered at all.</small></span><Grey reason="Choosing tools a connector may never offer comes in a later update.">Choose</Grey></div>
        <div className="cz-line"><span>Client certificate</span><Grey reason="Choosing a client certificate comes in a later update.">Choose a file</Grey></div>
        <div className="cz-line"><span>Client key</span><Grey reason="Choosing a client key comes in a later update.">Choose a file</Grey></div>
        </TechnicalOnly>
      </>}
      {shows(level, "technical") && <>
        <h3 className="cz-h3">Its settings</h3>
        <p className="cz-hint">Edits save at once; the connection restarts the next time it is used.</p>
        <div className="cz-line"><span>Accounts<small>Connecting an account to a connector comes in a later update.</small></span><Grey reason="Connecting an account to a connector comes in a later update.">Change</Grey></div>
        <h3 className="cz-h3">Where these are used</h3>
        {trunks.map(t => <div key={t.id} className="cz-line"><span>{trunkName(t)}</span><span className="cz-tag">{server.enabled && mayUse(ctx, server.name, t.id) ? "Working" : "Off"}</span></div>)}
        <h3 className="cz-h3">What it offers</h3>
        <p className="cz-hint">Resources a Trunk can read, and prompts it brings.</p>
        <h3 className="cz-h3">How it runs</h3>
        <div className="cz-line"><span>Give up on a call after</span><Grey reason="Setting how long a call may wait comes in a later update.">Set</Grey></div>
        <div className="cz-line"><span>Pick up new tools when the server changes them</span><Grey className="switch" reason="Picking up new tools comes in a later update."><span /></Grey></div>
        <div className="cz-line"><span>Use the instructions it sends<small>Up to 512 characters, added to what the Trunk reads.</small></span><Grey reason="Editing the instructions a connector sends comes in a later update.">Edit</Grey></div>
        <div className="cz-line"><span>Let it ask your model<small>For servers that need a model’s answer to work.</small></span><Grey className="switch" reason="Letting a connector ask a model comes in a later update."><span /></Grey></div>
        <div className="cz-line"><span>Let it ask you questions<small>A card in the conversation with the fields it needs.</small></span><Grey className="switch" reason="Letting a connector ask questions comes in a later update."><span /></Grey></div>
        <div className="cz-line"><span>Start automations from its events<small>Signed events only.</small></span><Grey className="switch" reason="Starting automations from a connector’s events comes in a later update."><span /></Grey></div>
      </>}
    </Sec>
    <Sec title="Safety check"><dl className="cz-kv"><dt>Preflight</dt><dd>Not checked yet</dd><dt>Malware scan</dt><dd>Not checked yet</dd><dt>Fingerprint</dt><dd>Not checked yet</dd><dt>Hidden instructions</dt><dd>Not checked yet</dd></dl></Sec>
    <TechnicalOnly><Sec title="Version & updates"><div className="cz-acts"><Grey reason={UPDATE_WHY}>Check for updates</Grey></div></Sec></TechnicalOnly>
    <Sec title="Actions"><div className="cz-acts">
      <Grey reason="Copying a connector’s seed comes in a later update.">Copy seed</Grey><Grey reason="Downloading a connector comes in a later update.">Download</Grey>
      <Grey reason="Copying a connector to another Trunk comes in a later update.">Copy to another Trunk</Grey><Grey reason={TEST_WHY}>Test it</Grey>
      <span className="cz-grow" /><button type="button" className="btn ghost sm" onClick={() => setRemoving(true)}>Remove</button>
    </div></Sec>
    {removing && <Dialog title={`Remove ${server.name}?`} onClose={() => setRemoving(false)} footer={<><button type="button" className="btn ghost" onClick={() => setRemoving(false)}>Cancel</button><button type="button" className="btn bad" disabled={config.busy} onClick={() => { void config.patch({ mcp: { servers: { [server.name]: null } } }).then(ok => ok && setRemoving(false)); }}>Remove</button></>}>
      <p className="dlg-p">Trunks stop using it. Its settings are taken out of Branch’s settings file.</p>{config.writeError && <p role="alert" className="cz-error">{plainError(config.writeError)}</p>}
    </Dialog>}
  </div>;
}

/** "What each tool may do": the tools this server offers in the open conversation, plus any it already excludes. */
function ConnectorTools({ ctx, server }: { ctx: ToolsCtx; server: Server }) {
  const sessionKey = ctx.engine.sessionKey;
  const effective = useResource<unknown>(ctx.engine, sessionKey ? "tools.effective" : null, { sessionKey });
  const offered = list(rec(effective.data).groups).flatMap(g => list(g.tools)).filter(t => str(t.mcpServer) === server.name).map(t => str(t.mcpToolName) || str(t.id));
  const names = [...new Set([...offered, ...server.exclude])].sort();
  const setPerm = (tool: string, never: boolean) => {
    const next = withItem(server.exclude, tool, never);
    void ctx.config.patch({ mcp: { servers: { [server.name]: { toolFilter: { exclude: next } } } } }, [`mcp.servers.${server.name}.toolFilter.exclude`]);
  };
  return <Sec title="What it may do"><h3 className="cz-h3">What each tool may do</h3>
    {!sessionKey ? <p className="cz-hint">Open a conversation to see what it offers.</p> : <Status {...effective} />}
    {effective.data != null && !names.length && <p className="cz-hint">It hasn’t offered any tools in this conversation.</p>}
    {names.map(t => <PermRow key={t} name={t} value={server.exclude.includes(t) ? "never" : "allowed"} disabled={ctx.config.busy} change={v => setPerm(t, v === "never")} />)}
  </Sec>;
}

export function AddConnector({ ctx, close }: { ctx: ToolsCtx; close: () => void }) {
  const [own, setOwn] = useState(false);
  return own ? <OwnServer ctx={ctx} back={() => setOwn(false)} close={close} /> : <CatalogDialog mode="connector" engine={ctx.engine} close={close} ownServer={() => setOwn(true)} done={() => { ctx.plugins.reload(); ctx.config.reload(); }} />;
}

function OwnServer({ ctx, back, close }: { ctx: ToolsCtx; back: () => void; close: () => void }) {
  const [how, setHow] = useState<"local" | "web">("local");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const taken = !!ctx.config.data && name.trim() in rec(rec(ctx.config.data.live.mcp).servers);
  const ready = /^[\w.-]+$/.test(name.trim()) && target.trim() && !taken;
  const add = async () => {
    const parts = target.trim().split(/\s+/);
    const entry = how === "local" ? { command: parts[0], ...(parts.length > 1 ? { args: parts.slice(1) } : {}) } : { url: target.trim() };
    if (await ctx.config.patch({ mcp: { servers: { [name.trim()]: entry } } })) close();
  };
  return <Dialog title="Add your own server" onClose={close} footer={<><button type="button" className="btn ghost" onClick={back}>Back</button><button type="button" className="btn pri" disabled={!ready || ctx.config.busy} onClick={() => void add()}>Add server</button></>}>
    <div className="cz-field"><span>How it runs</span><Seg label="How it runs" value={how} change={setHow} options={[{ id: "local", name: "A program on this computer" }, { id: "web", name: "A web address" }]} /></div>
    <label className="cz-field"><span>Name</span><input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="files" /></label>
    {taken && <p className="cz-error">A connector with that name already exists.</p>}
    <label className="cz-field"><span>{how === "local" ? "Command" : "Address"}</span><input className="inp" value={target} onChange={e => setTarget(e.target.value)} placeholder={how === "local" ? "npx -y @modelcontextprotocol/server-filesystem ~/Documents" : "https://"} /></label>
    {ctx.config.writeError && <p role="alert" className="cz-error">{plainError(ctx.config.writeError)}</p>}
  </Dialog>;
}
