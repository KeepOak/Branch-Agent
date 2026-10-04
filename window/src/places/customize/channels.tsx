// Customize › Channels (preview 42-placesbp.js ch12, 52-set2p.js): the catalogue of chat apps this engine can
// reach, from its channel plugins (plugins.list channelIds) and channels.status, with each account's state.
// A card opens Set up / Manage: switch the app's plugin on (plugins.setEnabled), start or stop an account
// (channels.start / channels.stop) and sign out (channels.logout).
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { useOperation, useResource } from "../library/data";
import { Status } from "../library/ui";
import { list, Pill, rec, Seg, str } from "./common";
import { ChatLogo } from "../settings/set1/chatapps-logo";
import { ConsentDialog, usePluginAction } from "./catalog";
import { Glyph } from "./glyphs";
import { PairDialog } from "./pairing";

type Group = "popular" | "work" | "more";
const POPULAR = ["telegram", "discord", "slack", "whatsapp", "whatsappbusiness", "email", "messenger", "instagram", "matrix", "signal"];
const WORK = ["mattermost", "rocketchat", "googlechat", "msteams", "zulip", "feishu", "dingtalk", "wecom", "line", "viber"];
const SETUP: Record<Group, string> = { popular: "Two minutes to set up", work: "Text through a webhook", more: "Switch it on" };
const groupOf = (id: string): Group => (POPULAR.includes(id) ? "popular" : WORK.includes(id) ? "work" : "more");
type Account = { accountId: string; name: string; configured: boolean; running: boolean; connected: boolean; lastError: string };
export type App = { id: string; name: string; group: Group; pluginId: string; installed: boolean; enabled: boolean; install: Record<string, unknown> | null; accounts: Account[] };

export function readApps(plugins: unknown, status: unknown): App[] {
  const s = rec(status), labels = rec(s.channelLabels), accounts = rec(s.channelAccounts);
  const apps = new Map<string, App>();
  const add = (id: string, fields: Partial<App>) => {
    const prev = apps.get(id);
    apps.set(id, { id, name: str(labels[id]) || fields.name || prev?.name || id, group: groupOf(id), pluginId: fields.pluginId ?? prev?.pluginId ?? "", installed: fields.installed ?? prev?.installed ?? true, enabled: fields.enabled ?? prev?.enabled ?? true, install: fields.install ?? prev?.install ?? null,
      accounts: list(accounts[id]).map(a => ({ accountId: str(a.accountId), name: str(a.name), configured: a.configured === true, running: a.running === true, connected: a.connected === true, lastError: str(a.lastError) })) });
  };
  for (const p of list(rec(plugins).plugins)) for (const id of Array.isArray(p.channelIds) ? p.channelIds.map(String) : [])
    add(id, { name: str(p.name), pluginId: str(p.id), installed: p.installed === true, enabled: p.enabled === true, install: p.install ? rec(p.install) : null });
  for (const id of [...(Array.isArray(s.channelOrder) ? s.channelOrder.map(String) : []), ...Object.keys(accounts)]) if (!apps.has(id)) add(id, {});
  const order = (a: App) => (a.group === "popular" ? POPULAR.indexOf(a.id) : a.group === "work" ? 100 + WORK.indexOf(a.id) : 1000);
  return [...apps.values()].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}
function stateOf(app: App): { line: string; dot: "on" | "bad" | null } {
  const live = app.accounts.find(a => a.connected);
  if (live) return { line: "Connected · reaches Branch", dot: "on" };
  const broken = app.accounts.find(a => a.lastError);
  if (broken) return { line: `Offline · ${broken.lastError}`, dot: "bad" };
  if (app.accounts.some(a => a.running)) return { line: "Running · not connected yet", dot: null };
  if (app.accounts.some(a => a.configured)) return { line: "Configured · not running", dot: null };
  if (app.id === "imessage") return { line: "Needs a Mac: set it up from a Mac running Branch", dot: null };
  return { line: SETUP[app.group], dot: null };
}

export function ChannelsTab({ engine, openSettings }: { engine: WindowEngine; openSettings?: (page: string) => void }) {
  const status = useResource<unknown>(engine, "channels.status", { probe: false });
  const plugins = useResource<unknown>(engine, "plugins.list");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"all" | Group>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const apps = readApps(plugins.data, status.data);
  const q = query.trim().toLowerCase();
  const shown = apps.filter(a => (group === "all" || a.group === group) && (!q || a.name.toLowerCase().includes(q)));
  const app = apps.find(a => a.id === open);
  const reload = () => { status.reload(); plugins.reload(); };
  return <div className="cz-page" data-testid="channels">
    <p className="cz-lede">Talk to Branch from other apps. Each chat app reaches the Trunk you choose; with the gateway on, they work while Branch is closed.</p>
    <div className="cz-top"><label className="cz-search"><Icon name="search" small /><input type="search" aria-label="Search chat apps" placeholder={`Search ${apps.length} chat apps`} value={query} onChange={e => setQuery(e.target.value)} /></label>
      <Seg label="Which chat apps" value={group} change={setGroup} options={[{ id: "all", name: "All" }, { id: "popular", name: "Popular" }, { id: "work", name: "Work chat" }, { id: "more", name: "More" }]} /></div>
    <Status {...status} />
    <Status {...plugins} />
    {status.data != null && plugins.data != null && !shown.length && <EmptyLine icon={<Icon name="search" />}>{q ? "No chat app by that name." : "No chat apps yet."}</EmptyLine>}
    <div className="cz-chgrid">{shown.map(a => { const st = stateOf(a); return <button key={a.id} type="button" className={st.dot === "on" ? "cz-ch on" : "cz-ch"} onClick={() => setOpen(a.id)}>
      <ChatLogo id={a.id} name={a.name} size={32} /><span className="grow"><b>{a.name}</b><small>{st.line}</small></span>{st.dot && <span className={"cz-dot cz-ch-dot " + st.dot} aria-hidden="true" />}</button>; })}</div>
    <div className="cz-tile-card cz-phone"><span className="cz-tile"><Glyph name="phone" size={16} /></span><span className="grow"><b>Your phone</b><small>Answer approvals and talk to Trunks from the Branch app.</small></span><button type="button" className="btn pri sm" onClick={() => setPairing(true)}>Pair a phone</button></div>
    {app && <ChannelDialog engine={engine} app={app} close={() => setOpen(null)} reload={reload} openSettings={openSettings} />}
    {pairing && <PairDialog engine={engine} close={() => setPairing(false)} />}
  </div>;
}

function ChannelDialog({ engine, app, close, reload, openSettings }: { engine: WindowEngine; app: App; close: () => void; reload: () => void; openSettings?: (page: string) => void }) {
  const op = useOperation(engine);
  const plugin = usePluginAction(engine);
  const configured = app.accounts.some(a => a.configured);
  const sub = app.group === "popular" ? "Popular" : app.group === "work" ? "Work chat · webhook" : "More apps";
  return <Dialog wide title={`${configured ? "Manage" : "Set up"} ${app.name}`} onClose={close} testid="channel" footer={<button type="button" className="btn" onClick={close}>Done</button>}>
    <div className="cz-prov-h"><ChatLogo id={app.id} name={app.name} size={40} /><span className="grow"><b>{app.name}</b><small>{sub}</small></span></div>
    {(op.error || plugin.error) && <p role="alert" className="cz-error">{op.error || plugin.error}</p>}
    {!app.installed ? <div className="cz-line"><span>{app.name} isn’t installed.</span>{app.install ? <button type="button" className="btn pri sm" disabled={!!plugin.busy} onClick={() => void plugin.run("install", "plugins.install", { ...app.install, enable: true }, reload)}>Install</button> : <span className="cz-hint">It can’t be installed from here.</span>}</div>
      : !app.enabled && app.pluginId ? <div className="cz-line"><span>{app.name} is switched off.</span><button type="button" className="btn pri sm" disabled={!!plugin.busy} onClick={() => void plugin.run("on", "plugins.setEnabled", { pluginId: app.pluginId, enabled: true }, reload)}>Switch it on</button></div>
      : !configured ? <div className="cz-line"><span>Connecting {app.name} needs its sign-in details, entered in Settings.</span>{openSettings && <button type="button" className="btn pri sm" onClick={() => openSettings("chatapps")}>Set it up</button>}</div> : null}
    {app.accounts.filter(a => a.configured).map(a => <div key={a.accountId} className="cz-account">
      <div className="cz-line"><span><b>{a.name || (a.accountId === "default" ? app.name : a.accountId)}</b><small>{a.lastError || (a.running ? "It is running." : "It is stopped.")}</small></span>
        <Pill tone={a.connected ? "ok" : a.lastError ? "bad" : "idle"}>{a.connected ? "Online" : "Offline"}</Pill>
        {a.running ? <button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("channels.stop", { channel: app.id, accountId: a.accountId }, reload)}>Pause</button>
          : <button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("channels.start", { channel: app.id, accountId: a.accountId }, reload)}>Start</button>}</div>
      <div className="cz-danger"><span><b>Disconnect {app.name}</b><small>Stops it and forgets its sign-in. Conversations stay in Branch.</small></span><button type="button" className="btn sm" disabled={op.busy} onClick={() => void op.run("channels.logout", { channel: app.id, accountId: a.accountId }, reload)}>Disconnect</button></div>
    </div>)}
    <ConsentDialog action={plugin} done={reload} />
  </Dialog>;
}
