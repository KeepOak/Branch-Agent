import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, useCapabilityVersion } from "../../connect/capabilities";
import { ChatLogo } from "../../places/settings/set1/chatapps-logo";
import { appOf, catalogue, trunksOf } from "../../places/settings/set1/chatapps-data";
import { appRoute, bindingsOf } from "../../places/settings/set1/chatapps-who";
import { useResource } from "../../places/settings/hooks";
import { has } from "../../places/inbox/data";
import { useLevel } from "../settings/SettingsFrame";
import { CHAT_APPS, GROUPS, type ChatApp } from "./catalogue";
import { More } from "./More";
import { Pairing } from "./Pairing";
import { ChatAppSettings } from "./Settings";
import { connectedOf, Pill, toneOf, useCfg } from "./parts";
import { useChatApps } from "./useChatApps";
import "../../glass/glass.css";
import "./chatapps.css";

export type ChatAppsProps = {
  engine: WindowEngine;
  /** Screen host supplies setup and account management; absent actions remain Coming. */
  onSetup?: (app: ChatApp) => void;
  onManage?: (app: ChatApp) => void;
  renderAccess?: (app: ChatApp) => ReactNode;
};
/** The engine's own setup steps with no app chosen (Classic's All chat apps › Find another app). */
export const ANOTHER_APP: ChatApp = { id: "another", name: "another chat app", group: "Your own" };
const ALSO = "Also in Branch";

export function ChatApps({ engine, onSetup, onManage, renderAccess }: ChatAppsProps) {
  const [query, setQuery] = useState("");
  const live = useChatApps(engine);
  const cfg = useCfg(engine);
  const [level] = useLevel(engine);
  const agents = useResource<Record<string, unknown>>(engine, "agents.list");
  useCapabilityVersion();
  const q = query.trim().toLowerCase();
  // Setup writes engine config: wizard.* and web.login.* are operator.admin in the gateway's method descriptors.
  const admin = has(engine, "operator.admin");
  const engineApps = catalogue(live.status);
  // web.login.* is never advertised in the hello, so WhatsApp (your number) follows the engine listing its channel.
  const listed = new Set(engineApps.map(c => c.id));
  // An app the engine lists under the catalogue's own id is set up through the engine's wizard, as Classic does; an app
  // the engine has that the catalogue doesn't name is listed after the groups.
  // (WhatsApp Business is not the engine's "whatsapp": that one is WhatsApp (your number).)
  const taken = new Set(CHAT_APPS.map(a => a.channel).filter(Boolean));
  const channelOf = (a: ChatApp) => a.channel ?? (listed.has(a.id) && !taken.has(a.id) ? a.id : undefined);
  const named = new Set(CHAT_APPS.map(a => channelOf(a)).filter(Boolean));
  const extra: ChatApp[] = engineApps.filter(c => !named.has(c.id)).map(c => ({ id: c.id, name: c.name, group: ALSO, channel: c.id, estimate: c.detail || undefined }));
  const every = [...CHAT_APPS.map(a => ({ ...a, channel: channelOf(a) })), ...extra];
  const shown = every.filter(a => (a.name + " " + a.id + " " + a.group).toLowerCase().includes(q));
  const connected = connectedOf(live.status);
  const { trunks, defaultId } = trunksOf(agents.data);
  const trunkFor = (ch: string) => { const id = appRoute(bindingsOf({ ...cfg, loading: !cfg.ready }), ch) ?? defaultId; return trunks.find(t => t.id === id)?.name ?? "your Trunk"; };
  const wizard = canAll(engine, ["wizard.start", "wizard.next", "wizard.cancel"]);
  return <section className="r1-chatapps g-clear" aria-label="Chat apps">
    <h1 className="g-label">Chat apps</h1><p className="r1-ca-lede g-label" data-lines>Telegram, WhatsApp, Slack and 71 more: who answers, who may message, and how replies arrive.</p>
    {live.error && <p role="alert"><span className="g-label">{live.error}</span> <button type="button" onClick={() => void live.reload()} data-need="channels.status">Try again</button></p>}
    <div className="r1-ca-surface g-clear"><section aria-labelledby="r1-ca-your"><h2 id="r1-ca-your" className="g-label">Your chat apps</h2>
      <p role="status" className="g-label">{live.loading ? "Checking your chat apps…" : !live.status ? "Chat app status is unavailable." : connected.length ? "Manage your connected apps below." : "No chat apps connected yet. Choose an app below to get started."}</p>
      {connected.length ? <div className="r1-ca-connected" role="list" aria-label="Connected chat apps">{connected.map(({ app, state }) => (
        <div key={state.id} role="listitem" className="r1-ca-app"><ChatLogo id={state.id} name={state.name} size={32} /><span className="g-label" data-lines><b>{state.name}</b> <small>{state.sub}</small></span>
          <Pill tone={toneOf(state.tone)}>{state.word}</Pill>
          <button type="button" data-need="channels.status" disabled={!onManage} onClick={() => onManage?.(app)}>Open</button></div>
      ))}</div> : null}
      <Pairing engine={engine} snapshot={live.pairing} reload={live.reload} apps={connected.map(c => ({ id: c.state.id, name: c.state.name }))} level={level} trunkFor={trunkFor} />
    </section>
    <section aria-labelledby="r1-ca-all"><h2 id="r1-ca-all" className="g-label">Every chat app</h2>
      <label className="r1-ca-search g-frost"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search chat apps" placeholder="Search all 74 chat apps" value={query} onChange={e => setQuery(e.target.value)} data-local="search" /></label>
      {[...GROUPS, ALSO].map(group => {
        const apps = shown.filter(a => a.group === group);
        return apps.length ? <section className="r1-ca-group" key={group}><h3 className="g-label">{group} <span>{apps.length}</span></h3><div className="r1-ca-grid">{apps.map(app => {
          const state = app.channel ? appOf(live.status, { id: app.channel, name: app.name, detail: "" }) : undefined;
          const on = state?.on === true;
          const action = on ? onManage : onSetup;
          const qr = app.id === "whatsappweb";
          const needs = qr ? ["web.login.start", "web.login.wait"] : ["wizard.start", "wizard.next", "wizard.cancel"];
          const offered = on ? canAll(engine, ["channels.status"]) : qr ? listed.has("whatsapp") : canAll(engine, needs);
          const locked = !on && offered && !admin;
          const enabled = Boolean(app.channel && action && offered && !locked);
          const reason = locked ? "Setting up " + app.name + " needs full access on this connection." : "Setting up " + app.name + " comes in a later update.";
          return <button key={app.id} type="button" className="r1-ca-card g-frost" aria-disabled={!enabled} data-coming={!enabled && !locked ? reason : undefined} title={!enabled ? reason : undefined} data-need={needs.join(" ")} onClick={() => { if (enabled) action?.(app); }}>
            <ChatLogo id={app.channel ?? app.id} name={app.name} size={32} /><span className="r1-ca-text"><b>{app.name}</b><small>{on ? state?.running ? "Connected" : state?.word : app.estimate ?? "Coming in a later update"}</small></span><span className="r1-ca-action">{locked ? "Needs full access" : !enabled ? "Coming" : on ? "Manage" : "Set up"}</span>
          </button>;
        })}</div></section> : null;
      })}
      {!shown.length && <p className="g-label" data-lines>No chat app matches “{query}”. “A webhook of your own” connects anything else.</p>}
      {onSetup && wizard ? <p className="r1-ca-acts"><button type="button" data-need="wizard.start wizard.next wizard.cancel" disabled={!admin} title={admin ? undefined : "Setting up a chat app needs full access on this connection."} onClick={() => onSetup(ANOTHER_APP)}>Find another app</button></p> : null}
    </section>
    </div>{renderAccess && <section aria-label="Who answers and who may message"><h2 className="g-label">Who answers</h2>{connected.length ? connected.map(c => <div key={c.state.id}>{renderAccess(c.app)}</div>) : <p className="r1-ca-hint g-label" data-lines>{live.loading ? "Checking your chat apps…" : "Connect a chat app above to choose who answers in it and who may message it."}</p>}</section>}<ChatAppSettings engine={engine} />
    {level >= 1 ? <More engine={engine} cfg={cfg} apps={connected.map(c => c.state)} all={engineApps} trunks={trunks} level={level} /> : null}
  </section>;
}
