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
import { useResource } from "../library/data";
import { Status } from "../library/ui";
import { denyList, denyPatch, Dot, Grey, list, PermRow, rec, Sec, Seg, str, WhoChips, withItem, type Rec } from "./common";
import { CatalogDialog } from "./catalog";
import { Glyph } from "./glyphs";
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
/** Brand marks for well-known connectors (the preview's LOGO table); any other server keeps its line-icon tile. */
const BRANDS: [RegExp, string, string][] = [
  [/^github/i, "#181717", '<path d="M12 4a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 12 4z" fill="#fff"/>'],
  [/^outlook/i, "#0F6CBD", "O"],
  [/^(google-?)?drive|^gdrive/i, "#1FA463", '<path d="M9 4.5h6l6 10.2-3 4.8H6l-3-4.8z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>'],
  [/^brave/i, "#FB542B", "B"],
];
function Mark({ server, size }: { server: Server; size: number }) {
  const brand = BRANDS.find(([re]) => re.test(server.name));
  if (!brand) return <span className={size > 32 ? "cz-tile big" : "cz-tile"}><Glyph name={server.local ? "terminal" : "globe"} size={size > 32 ? undefined : 16} /></span>;
  const [, bg, inner] = brand, glyph = Math.round(size * 0.66);
  return <span className="logo cz-brand" style={{ width: size, height: size, background: bg }} aria-hidden="true">
    {inner.startsWith("<") ? <svg viewBox="0 0 24 24" width={glyph} height={glyph} dangerouslySetInnerHTML={{ __html: inner }} /> : <b style={{ font: `700 ${Math.round(size * 0.38)}px var(--sans)`, color: "#fff" }}>{inner}</b>}
  </span>;
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
export const NO_SERVER_WHY = "Add a server first";
export const TEST_WHY = "This connector cannot be tested yet.";
export const UPDATE_WHY = "This connector cannot be checked for updates yet.";

function ConnectorActs({ server, onRemove }: { server?: Server; onRemove?: () => void }) {
  const testWhy = server ? TEST_WHY : NO_SERVER_WHY;
  const updateWhy = server ? UPDATE_WHY : NO_SERVER_WHY;
  return <div className="cz-acts">
    <Grey reason={testWhy}>Test it</Grey>
    <Grey reason={updateWhy}>Check for updates</Grey>
    {onRemove && <><span className="cz-grow" /><button type="button" className="btn ghost sm" onClick={onRemove}>Remove</button></>}
    {shownWhy(testWhy) && <span className="cz-hint">{shownWhy(testWhy)}</span>}
    {shownWhy(updateWhy) && updateWhy !== testWhy && <span className="cz-hint">{shownWhy(updateWhy)}</span>}
  </div>;
}

export function Connectors({ ctx }: { ctx: ToolsCtx }) {
  const { config } = ctx;
  const servers = config.data ? readServers(config.data.live, config.data.file) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState(false);
  const server = servers.find(s => s.name === chosen) ?? servers[0];
  return <>
    <div className="t9-list">
      <Status {...config} />
      {config.data && !servers.length && <EmptyLine icon={<Glyph name="puzzle" size={22} />}>No connectors yet.</EmptyLine>}
      {servers.map(s => <button key={s.name} type="button" className="t9-item" aria-current={s.name === server?.name} onClick={() => setChosen(s.name)}>
        <Mark server={s} size={32} />
        <span className="grow"><b>{s.name}</b><small>{s.line}</small></span>
        <Dot on={s.enabled && (!ctx.whose || mayUse(ctx, s.name, ctx.whose))} />
      </button>)}
      {config.data && <div className="cz-bar"><button type="button" className="btn ghost sm" disabled={config.loading} onClick={() => { config.reload(); setReloaded(true); }}>Reload connectors</button>
        {reloaded && !config.loading && <small role="status">Reloaded {servers.length} connectors from settings just now. Nothing restarted.</small>}</div>}
    </div>
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
    {config.writeError && <p role="alert" className="cz-error">{config.writeError}</p>}
    {scoped ? <div className="cz-line"><span>{scoped.identity?.name || scoped.name || scoped.id} may use it</span><Switch label={`${scoped.id} may use ${server.name}`} on={mayUse(ctx, server.name, scoped.id)} onChange={on => setWho(scoped.id, on)} /></div>
      : <Sec title="Which Trunks may use it"><WhoChips trunks={trunks} may={id => mayUse(ctx, server.name, id)} toggle={config.busy ? undefined : setWho} reason="Saving…" /></Sec>}
    <ConnectorTools ctx={ctx} server={server} />
    {shows(level, "advanced") && <Sec title="Connection">
      <div className="cz-line"><span>Several calls at once</span><Switch label="Several calls at once" on={server.parallel} onChange={on => setServer({ supportsParallelToolCalls: on })} /></div>
      {!server.local && <div className="cz-line"><span>Check the server’s certificate</span><Switch label="Check the server’s certificate" on={server.sslVerify} onChange={on => setServer({ sslVerify: on })} /></div>}
    </Sec>}
    <ConnectorActs server={server} onRemove={() => setRemoving(true)} />
    {removing && <Dialog title={`Remove ${server.name}?`} onClose={() => setRemoving(false)} footer={<><button type="button" className="btn ghost" onClick={() => setRemoving(false)}>Cancel</button><button type="button" className="btn bad" disabled={config.busy} onClick={() => { void config.patch({ mcp: { servers: { [server.name]: null } } }).then(ok => ok && setRemoving(false)); }}>Remove</button></>}>
      <p className="dlg-p">Trunks stop using it. Its settings are taken out of Branch’s settings file.</p>{config.writeError && <p role="alert" className="cz-error">{config.writeError}</p>}
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
  return <Sec title="What each tool may do">
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
    {ctx.config.writeError && <p role="alert" className="cz-error">{ctx.config.writeError}</p>}
  </Dialog>;
}
