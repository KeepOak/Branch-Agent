import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { errorText } from "../../places/settings/adapter";
import { appOf } from "../../places/settings/set1/chatapps-data";
import { Dialog } from "../../shell/Dialog";
import { Access } from "./Access";
import { ChatAppRow } from "./Settings";
import { TELEGRAM_ADAPTER } from "./rows";
import { useChatApps } from "./useChatApps";
import type { ChatApp } from "./catalogue";
import "./wizard.css";

export function Manage({ engine, app, onClose, onSetup }: { engine: WindowEngine; app: ChatApp; onClose: () => void; onSetup: () => void }) {
  const live = useChatApps(engine);
  const state = appOf(live.status, { id: app.channel!, name: app.name, detail: "" });
  const [accountId, setAccountId] = useState("");
  const account = state.accounts.find(a => a.accountId === accountId) ?? state.accounts[0];
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = account?.running === true || account?.connected === true;
  const method = running ? "channels.stop" : "channels.start";
  const run = async (action: string) => {
    if (busy || !account || !canAll(engine, [action])) return;
    setBusy(true); setError("");
    try { await requestOrComing(engine, action, { channel: app.channel, accountId: account.accountId }); setConfirm(false); await live.reload(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <div className="r1-cw"><Dialog title={`Manage ${app.name}`} onClose={onClose} clear>
    <p role="status" className="g-label" data-lines>{live.loading ? "Checking connection…" : state.sub}</p>
    {state.accounts.length > 1 && <label><span className="g-label">Account</span><select aria-label="Account" value={account?.accountId ?? ""} onChange={e => { setAccountId(e.target.value); setConfirm(false); }} data-local="account">{state.accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name ?? a.accountId}</option>)}</select></label>}
    <Access engine={engine} app={app} />
    {app.id === "telegram" && <><h3 className="g-label">Behaviour</h3><ChatAppRow engine={engine} row={TELEGRAM_ADAPTER} /></>}
    <div className="r1-cw-actions"><button type="button" disabled={busy || !account || !canAll(engine, [method])} data-need={method} title={!canAll(engine, [method]) ? "Changing connection state comes in a later update." : undefined} onClick={() => void run(method)}>{canAll(engine, [method]) ? running ? "Pause" : "Resume" : "Coming"}</button><button type="button" disabled={busy} data-local="setup" onClick={onSetup}>Set up again</button><button type="button" disabled={busy || !account || !canAll(engine, ["channels.logout"])} data-need="channels.logout" onClick={() => setConfirm(true)}>{canAll(engine, ["channels.logout"]) ? "Unlink" : "Coming"}</button></div>
    {confirm && <section aria-label="Confirm unlink"><p className="g-label" data-lines>Unlink {account?.name ?? app.name}? You’ll need to connect this account again to receive messages.</p><button type="button" disabled={busy} data-local="cancel" onClick={() => setConfirm(false)}>Cancel</button><button type="button" disabled={busy} data-need="channels.logout" onClick={() => void run("channels.logout")}>Unlink account</button></section>}
    {(error || live.error) && <p role="alert" className="g-label" data-lines>{error || live.error}</p>}
  </Dialog></div>;
}
