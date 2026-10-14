// Manage <app> (Classic chatapps-manage, chatapps-manage-more): who answers and who may message it, the people let in
// (allowFrom) with Add and Remove and a list to use instead, who is asking here, its live state with Pause and Start
// (kept with channels.<id>.enabled), where its token comes from with Replace, Unlink, Disconnect, and at Advanced its
// commands, groups by ID, health with Check now, accounts with Add another account and every setting it has.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { errorText, record, visible } from "../../places/settings/adapter";
import { Dialog } from "../../shell/Dialog";
import { useLevel } from "../settings/SettingsFrame";
import { Segmented, Toggle } from "../settings/RowView";
import { NATIVE } from "../../places/settings/set1/chatapps-parts";
import type { App } from "../../places/settings/set1/chatapps-data";
import { Access } from "./Access";
import { AppMore } from "./More";
import { Pairing } from "./Pairing";
import { ChatAppRow } from "./Settings";
import { TELEGRAM_ADAPTER } from "./rows";
import { Alert, Hint, Line, Pill, stateOf, toneOf, useCfg, type Cfg } from "./parts";
import { useChatApps } from "./useChatApps";
import type { ChatApp } from "./catalogue";
import "./wizard.css";

const GROUP = "accessGroup:";
const NO_KEY = "Branch has no setting for this yet.";
const SOURCE_WORDS: Record<string, string> = { config: "Kept in the settings file", env: "From an environment variable", file: "From a file", none: "Not set", secretRef: "Kept in Saved passwords" };
const fromEnv = (app: App) => app.accounts.some((a) => (a.botTokenSource ?? a.tokenSource) === "env");
const isLinked = (app: App) => app.accounts.some((a) => a.linked !== undefined);

export function Manage({ engine, app, onClose, onSetup }: { engine: WindowEngine; app: ChatApp; onClose: () => void; onSetup: () => void }) {
  const live = useChatApps(engine);
  const cfg = useCfg(engine);
  const [level] = useLevel(engine);
  const ch = app.channel ?? app.id;
  const base = "channels." + ch;
  const state = stateOf(live.status, app);
  const [accountId, setAccountId] = useState("");
  const account = state.accounts.find(a => a.accountId === accountId) ?? state.accounts[0];
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Pause and Start act on the whole app (every account), so they follow the app's state, as Classic's app-wide control does.
  const running = state.running === true && !state.paused;
  const method = running ? "channels.stop" : "channels.start";
  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true); setError("");
    try { await fn(); await live.reload(); return true; }
    catch (e) { setError(errorText(e)); return false; }
    finally { setBusy(false); }
  };
  /** channels.start/stop/logout act on one account; Pause, Start and Disconnect run it for each, as Classic does. */
  const eachAccount = async (m: string) => { const ids = state.accounts.length ? state.accounts.map((a) => a.accountId) : [undefined]; for (const id of ids) await requestOrComing(engine, m, { channel: ch, ...(id ? { accountId: id } : {}) }); };
  const pause = () => void act(async () => {
    const start = !running;
    // Kept with channels.<id>.enabled, so a paused app stays paused after a restart (Classic's Pause). Never sent
    // without that write: the button waits for the settings to load.
    if (!cfg.ready) throw new Error("Settings haven’t loaded yet.");
    if (!(await cfg.set(base + ".enabled", start ? null : false))) throw new Error(cfg.error || "Branch couldn’t save that.");
    await eachAccount(start ? "channels.start" : "channels.stop");
  });
  const unlink = () => void act(async () => { if (!account || !canAll(engine, ["channels.logout"])) return; await requestOrComing(engine, "channels.logout", { channel: ch, accountId: account.accountId }); setConfirm(false); });
  const source = account?.botTokenSource ?? account?.tokenSource ?? "";
  const policy = typeof cfg.get(base + ".dmPolicy") === "string" ? String(cfg.get(base + ".dmPolicy")) : "pairing";
  const pairing = live.pairing ? { ...live.pairing, requests: live.pairing.requests.filter((r) => r.channel === ch) } : undefined;
  const canRun = canAll(engine, [method]);
  return <div className="r1-cw"><Dialog title={"Manage " + app.name} onClose={onClose} clear>
    <p role="status" className="g-label" data-lines>{live.loading ? "Checking connection…" : state.sub}</p>
    {state.accounts.length > 1 && <label><span className="g-label">Account</span><select aria-label="Account" value={account?.accountId ?? ""} onChange={e => { setAccountId(e.target.value); setConfirm(false); }} data-local="account">{state.accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name ?? a.accountId}</option>)}</select></label>}
    <Access engine={engine} app={app} inManage />
    {policy === "pairing" || policy === "allowlist" ? <Approved app={app} state={state} cfg={cfg} base={base} /> : null}
    {policy === "pairing" && pairing ? <Pairing engine={engine} snapshot={pairing} reload={live.reload} level={level} /> : null}
    {ch === "telegram" && <><h3 className="g-label">Behaviour</h3><ChatAppRow engine={engine} row={TELEGRAM_ADAPTER} />
      <Line label="Keep forum topics apart" help="Each topic in a group becomes its own conversation." coming={NO_KEY}><Toggle label="Keep forum topics apart" on disabled onChange={() => undefined} /></Line>
      <Line label="Photos and files reach the task" help={"What you send in " + app.name + " is handed to the Trunk as material."} coming={NO_KEY}><Toggle label="Photos and files reach the task" on disabled onChange={() => undefined} /></Line>
    </>}
    <h3 className="g-label">Connection</h3>
    <div className="r1-ca-app"><Pill tone={state.paused ? "idle" : toneOf(state.tone)}>{state.paused ? "Paused" : state.word}</Pill>{!state.paused && state.tone === "bad" ? <small className="g-label" data-lines>{state.sub}</small> : null}</div>
    {source ? <Line label="Token" help={"Replacing it restarts " + app.name + " with the new one."} ctlNeed="wizard.start"><span className="g-label">{SOURCE_WORDS[source] ?? visible(source)}</span><button type="button" data-need="wizard.start" onClick={onSetup}>Replace</button></Line> : null}
    {[["Sees edited messages", "It answers the latest version."], ["Photo albums as one message", "Not one reply per photo."], ["Online status in " + app.name, "“Online” or “Offline, back soon” in the bot’s description."]].map(([t, s]) => (
      <Line key={t} label={t} help={s} coming={NO_KEY}><Toggle label={t} on={!t.startsWith("Online")} disabled onChange={() => undefined} /></Line>
    ))}
    <Line label="Formatting" coming="Each app’s own formatting is always used."><Segmented label="Formatting" value="own" options={[{ v: "own", label: NATIVE[ch] ?? "Its own styles" }, { v: "plain", label: "Plain text" }]} disabled onChange={() => undefined} /></Line>
    <div className="r1-cw-actions"><button type="button" disabled={busy || !canRun || !cfg.ready} data-need={method + " config.patch"} title={!canRun ? "Changing connection state comes in a later update." : !cfg.ready ? cfg.error || "Reading settings…" : undefined} onClick={pause}>{canRun ? running ? "Pause" : "Start" : "Coming"}</button>{/* preview Manage: Unlink only for a linked account (WhatsApp, Signal: "Linked as …"); Set up again lives under
        Health at Advanced (More.tsx AppMore), and Disconnect below ends the connection for every app (#1049). */}
      {isLinked(state) ? <button type="button" disabled={busy || !account || !canAll(engine, ["channels.logout"])} data-need="channels.logout" onClick={() => setConfirm(true)}>{canAll(engine, ["channels.logout"]) ? "Unlink" : "Coming"}</button> : null}</div>
    {confirm && <section aria-label="Confirm unlink"><p className="g-label" data-lines>Unlink {account?.name ?? app.name}? You’ll need to connect this account again to receive messages.</p><button type="button" disabled={busy} data-local="cancel" onClick={() => setConfirm(false)}>Cancel</button><button type="button" disabled={busy} data-need="channels.logout" onClick={unlink}>Unlink account</button></section>}
    {level >= 1 ? <AppMore engine={engine} app={app} state={state} cfg={cfg} level={level} reload={live.reload} onSetup={onSetup} /> : null}
    <Disconnect engine={engine} app={app} state={state} cfg={cfg} base={base} busy={busy} act={act} eachAccount={eachAccount} onClose={onClose} />
    <Alert text={error || cfg.error || live.error} />
  </Dialog></div>;
}

/** The people let in (allowFrom), one per line with Remove and an Add line, and a list of people to use instead. */
function Approved({ app, state, cfg, base }: { app: ChatApp; state: App; cfg: Cfg; base: string }) {
  const raw = cfg.get(base + ".allowFrom");
  const allow = Array.isArray(raw) ? raw.map(String) : [];
  const held = [...new Set(state.accounts.flatMap((a) => (Array.isArray(a.allowFrom) ? a.allowFrom.map(String) : [])))].filter((x) => x !== "*" && !allow.includes(x));
  const [add, setAdd] = useState("");
  const people = allow.filter((a) => a !== "*" && !a.startsWith(GROUP));
  const group = allow.find((a) => a.startsWith(GROUP))?.slice(GROUP.length) ?? "";
  const lists = Object.keys(record(cfg.get("accessGroups")));
  const put = (next: string[]) => void cfg.set(base + ".allowFrom", next.length ? next : null);
  const plus = () => { const v = add.trim(); if (v && !allow.includes(v)) { put([...allow, v]); setAdd(""); } };
  const ph = "Their " + app.name + " ID or @name";
  return <section className="r1-ca-editor" aria-label="Allowed to message it">
    <h3 className="g-label">Allowed to message it</h3>
    {people.map((who) => <div key={who} className="r1-ca-person"><span className="g-label">{visible(who)}</span><button type="button" disabled={!cfg.ready} data-need="config.patch" onClick={() => put(allow.filter((a) => a !== who))}>Remove</button></div>)}
    {held.map((who) => <div key={"held:" + who} className="r1-ca-person"><span className="g-label">{visible(who)}</span><button type="button" disabled data-coming="Branch can’t remove someone the engine let in yet." title="Branch can’t remove someone the engine let in yet.">Remove</button></div>)}
    {!people.length && !held.length ? <Hint>No one yet.</Hint> : null}
    <Hint>People you approve from a request are kept by the engine and may not be listed here yet.</Hint>
    <div className="r1-ca-add"><input className="r1s-inp" placeholder={ph} aria-label={ph} value={add} disabled={!cfg.ready} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") plus(); }} /><button type="button" disabled={!cfg.ready || !add.trim()} data-need="config.patch" onClick={plus}>Add</button></div>
    <Line label="Use a list" help="Everyone else gets no answer." ctlNeed="config.patch">
      <select className="r1s-inp" aria-label="Use a list" value={group} disabled={!cfg.ready} onChange={(e) => put([...allow.filter((a) => !a.startsWith(GROUP)), ...(e.target.value ? [GROUP + e.target.value] : [])])}>
        <option value="">None</option>{lists.map((l) => <option key={l} value={l}>{visible(l)}</option>)}
      </select>
    </Line>
  </section>;
}

/** Disconnect: stops it and forgets its settings and token (channels.<id> removed). Conversations stay. */
function Disconnect({ engine, app, state, cfg, base, busy, act, eachAccount, onClose }: { engine: WindowEngine; app: ChatApp; state: App; cfg: Cfg; base: string; busy: boolean; act: (fn: () => Promise<unknown>) => Promise<boolean>; eachAccount: (m: string) => Promise<void>; onClose: () => void }) {
  const [ask, setAsk] = useState(false);
  const env = fromEnv(state);
  const stopWith = isLinked(state) ? "channels.logout" : "channels.stop";
  const go = async () => {
    const ok = await act(async () => {
      await eachAccount(stopWith);
      if (!(await cfg.set(base, env ? { enabled: false } : null))) throw new Error(cfg.error || "Branch couldn’t save that.");
    });
    if (ok) { setAsk(false); onClose(); }
  };
  const can = cfg.ready && canAll(engine, [stopWith]);
  return <section className="r1-ca-danger" aria-label={"Disconnect " + app.name}>
    <p className="g-label" data-lines><b>Disconnect {app.name}</b> {env ? "Stops it and keeps it off. Its token comes from this computer’s environment, so remove it there too." : "Stops it and forgets its token and settings. Conversations stay in Branch."}</p>
    <button type="button" disabled={busy || !can} data-need={stopWith + " config.patch"} onClick={() => setAsk(true)}>Disconnect</button>
    {ask ? <div className="r1-ca-confirm" role="group" aria-label="Confirm disconnect"><p className="g-label" data-lines>{env ? "Branch stops listening there and turns it off." : isLinked(state) ? "Branch stops listening there and unlinks this computer." : "Branch stops listening there and deletes its saved token."} You can connect it again later.</p>
      <button type="button" data-local="cancel" disabled={busy} onClick={() => setAsk(false)}>Cancel</button><button type="button" disabled={busy} data-need={stopWith + " config.patch"} onClick={() => void go()}>Disconnect {app.name}</button></div> : null}
  </section>;
}
