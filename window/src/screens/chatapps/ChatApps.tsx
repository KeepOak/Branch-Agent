import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, useCapabilityVersion } from "../../connect/capabilities";
import { ChatLogo } from "../../places/settings/set1/chatapps-logo";
import { appOf } from "../../places/settings/set1/chatapps-data";
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
  const shown = CHAT_APPS.filter(a => `${a.name} ${a.id} ${a.group}`.toLowerCase().includes(q));
  return <section className="r1-chatapps" aria-label="Chat apps">
    <h1>Chat apps</h1><p className="r1-ca-lede">Telegram, WhatsApp, Slack and 71 more: who answers, who may message, and how replies arrive.</p>
    {live.error && <p role="alert">{live.error} <button type="button" className="g-ctl" onClick={() => void live.reload()} data-need="channels.status">Try again</button></p>}
    <div className="r1-ca-surface"><section aria-labelledby="r1-ca-your"><h2 id="r1-ca-your">Your chat apps</h2>
      <p role="status">{live.loading ? "Checking your chat apps…" : !live.status ? "Chat app status is unavailable." : CHAT_APPS.some(a => a.channel && appOf(live.status, { id: a.channel, name: a.name, detail: "" }).on) ? "Manage your connected apps below." : "No chat apps connected yet. Choose an app below to get started."}</p>
      <Pairing engine={engine} snapshot={live.pairing} reload={live.reload} />
    </section>
    <section aria-labelledby="r1-ca-all"><h2 id="r1-ca-all">Every chat app</h2>
      <label className="r1-ca-search g-ctl"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search chat apps" placeholder="Search all 74 chat apps" value={query} onChange={e => setQuery(e.target.value)} data-local="search" /></label>
      {GROUPS.map(group => {
        const apps = shown.filter(a => a.group === group);
        return apps.length ? <section className="r1-ca-group" key={group}><h3>{group} <span>{apps.length}</span></h3><div className="r1-ca-grid">{apps.map(app => {
          const state = app.channel ? appOf(live.status, { id: app.channel, name: app.name, detail: "" }) : undefined;
          const connected = state?.on === true;
          const action = connected ? onManage : onSetup;
          const needs = app.id === "whatsappweb" ? ["web.login.start", "web.login.wait"] : ["wizard.start", "wizard.next", "wizard.cancel"];
          const enabled = Boolean(app.channel && action && canAll(engine, connected ? ["channels.status"] : needs));
          const reason = `Setting up ${app.name} comes in a later update.`;
          return <button key={app.id} type="button" className="r1-ca-card g-ctl" aria-disabled={!enabled} data-coming={!enabled ? reason : undefined} title={!enabled ? reason : undefined} data-need={needs.join(" ")} onClick={() => { if (enabled) action?.(app); }}>
            <ChatLogo id={app.channel ?? app.id} name={app.name} size={32} /><span className="r1-ca-text"><b>{app.name}</b><small>{connected ? state?.running ? "Connected" : state?.word : app.estimate ?? "Coming in a later update"}</small></span><span className="r1-ca-action">{!enabled ? "Coming" : connected ? "Manage" : "Set up"}</span>
          </button>;
        })}</div></section> : null;
      })}
      {!shown.length && <p>No chat app matches “{query}”. “A webhook of your own” connects anything else.</p>}
    </section>
    </div>{renderAccess && <section aria-label="Who answers and who may message"><h2>Who answers</h2>{CHAT_APPS.filter(a => a.channel && appOf(live.status, { id: a.channel, name: a.name, detail: "" }).on).map(a => <div key={a.id}>{renderAccess(a)}</div>)}</section>}<ChatAppSettings engine={engine} />
  </section>;
}
