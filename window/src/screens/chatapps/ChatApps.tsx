import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, useCapabilityVersion } from "../../connect/capabilities";
import { Coming } from "../../glass/coming";
import { ChatLogo } from "../../places/settings/set1/chatapps-logo";
import { appOf, catalogue } from "../../places/settings/set1/chatapps-data";
import { has } from "../../places/inbox/data";
import { CHAT_APPS, GROUPS, type ChatApp } from "./catalogue";
import { Pairing } from "./Pairing";
import { ChatAppSettings } from "./Settings";
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
export function ChatApps({ engine, onSetup, onManage, renderAccess }: ChatAppsProps) {
  const [query, setQuery] = useState("");
  const live = useChatApps(engine);
  useCapabilityVersion();
  const q = query.trim().toLowerCase();
  // Setup writes engine config: wizard.* and web.login.* are operator.admin in the gateway's method descriptors.
  const admin = has(engine, "operator.admin");
  // web.login.* is never advertised in the hello, so WhatsApp (your number) follows the engine listing its channel.
  const listed = new Set(catalogue(live.status).map(c => c.id));
  const shown = CHAT_APPS.filter(a => `${a.name} ${a.id} ${a.group}`.toLowerCase().includes(q));
  const connected = CHAT_APPS.filter(a => a.channel && appOf(live.status, { id: a.channel, name: a.name, detail: "" }).on);
  return <section className="r1-chatapps g-clear" aria-label="Chat apps">
    <h1 className="g-label">Chat apps</h1><p className="r1-ca-lede g-label" data-lines>Telegram, WhatsApp, Slack and 71 more: who answers, who may message, and how replies arrive.</p>
    {live.error && <p role="alert"><span className="g-label">{live.error}</span> <button type="button" onClick={() => void live.reload()} data-need="channels.status">Try again</button></p>}
    <div className="r1-ca-surface g-clear"><section aria-labelledby="r1-ca-your"><h2 id="r1-ca-your" className="g-label">Your chat apps</h2>
      <p role="status" className="g-label">{live.loading ? "Checking your chat apps…" : !live.status ? "Chat app status is unavailable." : connected.length ? "Manage your connected apps below." : "No chat apps connected yet. Choose an app below to get started."}</p>
      <Pairing engine={engine} snapshot={live.pairing} reload={live.reload} />
    </section>
    <section aria-labelledby="r1-ca-all"><h2 id="r1-ca-all" className="g-label">Every chat app</h2>
      <label className="r1-ca-search g-frost"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search chat apps" placeholder="Search all 74 chat apps" value={query} onChange={e => setQuery(e.target.value)} data-local="search" /></label>
      {GROUPS.map(group => {
        const apps = shown.filter(a => a.group === group);
        return apps.length ? <section className="r1-ca-group" key={group}><h3 className="g-label">{group} <span>{apps.length}</span></h3><div className="r1-ca-grid">{apps.map(app => {
          const state = app.channel ? appOf(live.status, { id: app.channel, name: app.name, detail: "" }) : undefined;
          const connected = state?.on === true;
          const action = connected ? onManage : onSetup;
          const qr = app.id === "whatsappweb";
          const needs = qr ? ["web.login.start", "web.login.wait"] : ["wizard.start", "wizard.next", "wizard.cancel"];
          const offered = connected ? canAll(engine, ["channels.status"]) : qr ? listed.has("whatsapp") : canAll(engine, needs);
          const locked = !connected && offered && !admin;
          const enabled = Boolean(app.channel && action && offered && !locked);
          const reason = locked ? `Setting up ${app.name} needs full access on this connection.` : `Setting up ${app.name} comes in a later update.`;
          const face = <><ChatLogo id={app.channel ?? app.id} name={app.name} size={32} /><span className="r1-ca-text"><b>{app.name}</b><small>{connected ? state?.running ? "Connected" : state?.word : app.estimate ?? "Coming in a later update"}</small></span><span className="r1-ca-action">{locked ? "Needs full access" : !enabled ? "Coming" : connected ? "Manage" : "Set up"}</span></>;
          // Full access is this connection's scope, not a missing call: the card stays greyed with its reason and names its calls.
          if (locked) return <button key={app.id} type="button" className="r1-ca-card g-frost" aria-disabled="true" title={reason} data-need={needs.join(" ")}>{face}</button>;
          // Every other card goes through <Coming> with the calls it makes (R1-10). web.login.* is never in the hello, so
          // WhatsApp (your number) is checked by its channel being listed instead of against the method list.
          const need = connected ? ["channels.status"] : needs;
          return <Coming key={app.id} engine={qr && !connected ? null : engine} need={need} unwired={!enabled} reason={reason} where={app.name}>
            <button type="button" className="r1-ca-card g-frost" aria-disabled={enabled ? "false" : undefined} onClick={() => { if (enabled) action?.(app); }}>{face}</button>
          </Coming>;
        })}</div></section> : null;
      })}
      {!shown.length && <p className="g-label" data-lines>No chat app matches “{query}”. “A webhook of your own” connects anything else.</p>}
    </section>
    </div>{renderAccess && <section aria-label="Who answers and who may message"><h2 className="g-label">Who answers</h2>{connected.length ? connected.map(a => <div key={a.id}>{renderAccess(a)}</div>) : <p className="r1-ca-hint g-label" data-lines>{live.loading ? "Checking your chat apps…" : "Connect a chat app above to choose who answers in it and who may message it."}</p>}</section>}<ChatAppSettings engine={engine} />
  </section>;
}
