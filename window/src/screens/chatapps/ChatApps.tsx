import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, useCapabilityVersion } from "../../connect/capabilities";
import { Coming } from "../../glass/coming";
import { ChatLogo } from "../../places/settings/set1/chatapps-logo";
import { appOf, catalogue, trunksOf } from "../../places/settings/set1/chatapps-data";
import { appRoute, bindingsOf } from "../../places/settings/set1/chatapps-who";
import { useResource } from "../../places/settings/hooks";
import { PairDialog } from "../../places/customize/pairing";
import { Icon } from "../../shell/icons";
import "../../places/settings/set1/chatapps.css";
import { has } from "../../places/inbox/data";
import { useLevel } from "../settings/SettingsFrame";
import { CHAT_APPS, GROUPS, type ChatApp } from "./catalogue";
import { LaterRows } from "../../glass/LaterRows";
import { More } from "./More";
import { Pairing } from "./Pairing";
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

const ALSO = "Also in Branch";

export function ChatApps({ engine, onSetup, onManage, renderAccess }: ChatAppsProps) {
  const [query, setQuery] = useState("");
  const [pairing, setPairing] = useState(false);
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
  // A card's state: working apps (connected, set up here, or offered and waiting for an owner's setup) lead; the rest fold.
  const stateOf = (app: ChatApp) => {
    const state = app.channel ? appOf(live.status, { id: app.channel, name: app.name, detail: "" }) : undefined;
    const on = state?.on === true;
    const qr = app.id === "whatsappweb";
    const needs = qr ? ["web.login.start", "web.login.wait"] : ["wizard.start", "wizard.next", "wizard.cancel"];
    const offered = on ? canAll(engine, ["channels.status"]) : qr ? listed.has("whatsapp") : canAll(engine, needs);
    const locked = !on && offered && !admin;
    const enabled = Boolean(app.channel && (on ? onManage : onSetup) && offered && !locked);
    return { state, on, qr, needs, locked, enabled };
  };
  const working = (app: ChatApp) => { const s = stateOf(app); return s.on || s.enabled || s.locked; };
  const renderCard = (app: ChatApp) => {
    const { state, on, qr, needs, locked, enabled } = stateOf(app);
    const action = on ? onManage : onSetup;
    const reason = locked ? "Setting up " + app.name + " needs full access on this connection." : "Setting up " + app.name + " comes in a later update.";
    const face = <><ChatLogo id={app.channel ?? app.id} name={app.name} size={32} /><span className="r1-ca-text"><b>{app.name}</b><small>{on ? (state?.running ? "Connected" : state?.word) : app.estimate}</small></span><span className="r1-ca-action">{locked ? "Needs full access" : !enabled ? "Coming" : on ? "Manage" : "Set up"}</span></>;
    // Full access is this connection's scope, not a missing call: the card stays greyed with its reason and names its calls.
    if (locked) return <button key={app.id} type="button" className="r1-ca-card g-frost" aria-disabled="true" title={reason} data-need={needs.join(" ")}>{face}</button>;
    // Every other card goes through <Coming> with the calls it makes (R1-10). web.login.* is never in the hello, so
    // WhatsApp (your number) is checked by its channel being listed instead of against the method list.
    const need = on ? ["channels.status"] : needs;
    return <Coming key={app.id} engine={qr && !on ? null : engine} need={need} unwired={!enabled} reason={reason} where={app.name}>
      <button type="button" className="r1-ca-card g-frost" aria-disabled={enabled ? "false" : undefined} onClick={() => { if (enabled) action?.(app); }}>{face}</button>
    </Coming>;
  };
  const groupsOf = (apps: ChatApp[]) => [...GROUPS, ALSO].map(group => {
    const items = apps.filter(a => a.group === group);
    return items.length ? <section className="r1-ca-group" key={group}><h3 className="g-label">{group} <span>{items.length}</span></h3><div className="r1-ca-grid">{items.map(renderCard)}</div></section> : null;
  });
  // A search lists every match; otherwise the apps that work lead and the rest fold into one row.
  const leading = q ? shown : shown.filter(working);
  const later = q ? [] : shown.filter(app => !working(app));

  return <section className="r1-chatapps g-clear" aria-label="Chat apps">
    {live.error && <p role="alert"><span className="g-label">{live.error}</span> <button type="button" onClick={() => void live.reload()} data-need="channels.status">Try again</button></p>}
    <div className="r1-ca-surface g-clear cz-chgrid"><section aria-labelledby="r1-ca-your"><h2 id="r1-ca-your" className="g-label">Your chat apps</h2>
      <p role="status" className="g-label">{live.loading ? "Checking…" : !live.status ? "Talk to Branch from other apps. Each chat app reaches the Trunk you choose; with the gateway on, they work while Branch is closed." : connected.length ? "Talk to Branch from other apps. Each chat app reaches the Trunk you choose; with the gateway on, they work while Branch is closed." : "No chat app is connected yet."}</p>
      {connected.length ? <div className="r1-ca-connected" role="list" aria-label="Connected chat apps">{connected.map(({ app, state }) => (
        <div key={state.id} role="listitem" className="r1-ca-app"><ChatLogo id={state.id} name={state.name} size={32} /><span className="g-label" data-lines><b>{state.name}</b> <small>{state.sub}</small></span>
          <Pill tone={toneOf(state.tone)}>{state.word}</Pill>
          <button type="button" data-need="channels.status" disabled={!onManage} onClick={() => onManage?.(app)}>Open</button></div>
      ))}</div> : null}
      <Pairing engine={engine} snapshot={live.pairing} reload={live.reload} apps={connected.map(c => ({ id: c.state.id, name: c.state.name }))} level={level} trunkFor={trunkFor} />
    </section>
    <section aria-labelledby="r1-ca-all"><h2 id="r1-ca-all" className="g-label">Every chat app</h2>
      <label className="r1-ca-search g-frost"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search chat apps" placeholder="Search all 74 chat apps" value={query} onChange={e => setQuery(e.target.value)} data-local="search" /></label>
      {groupsOf(leading)}
      {later.length ? <LaterRows count={later.length} label={`More chat apps (${later.length})`}>{groupsOf(later)}</LaterRows> : null}
      {!shown.length && <p className="g-label" data-lines>No chat app matches “{query}”. “A webhook of your own” connects anything else.</p>}
    </section>
    {/* preview: the "Your phone" tile after the app groups; Pair a phone opens the pairing code (device.pair.setupCode). */}
    <section className="r1-ca-phone" aria-label="Your phone">
      <span className="r1-ca-app"><Icon name="phone" size={20} /><span className="g-label" data-lines><b>Your phone</b> <small>Answer approvals and talk to Trunks from the Branch app.</small></span>
        <Coming engine={engine} need="device.pair.setupCode" reason="Pair a phone comes in a later update." where="Chat apps › Pair a phone">
          <button type="button" onClick={() => setPairing(true)}>Pair a phone</button>
        </Coming></span>
      {pairing ? <PairDialog engine={engine} close={() => setPairing(false)} /> : null}
    </section>
    </div>{renderAccess && <section aria-label="Who answers and who may message"><h2 className="g-label">Who answers</h2>{connected.length ? connected.map(c => <div key={c.state.id}>{renderAccess(c.app)}</div>) : <p className="r1-ca-hint g-label" data-lines>{live.loading ? "Checking…" : "No chat app is connected yet."}</p>}</section>}
    {level >= 1 ? <More engine={engine} cfg={cfg} apps={connected.map(c => c.state)} all={engineApps} trunks={trunks} level={level} /> : null}
  </section>;
}
