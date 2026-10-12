import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { errorText } from "../../places/settings/adapter";
import type { Pairing as Snapshot, PairRequest } from "../../places/settings/set1/chatapps-asking";

export function Pairing({ engine, snapshot, reload }: { engine: WindowEngine; snapshot?: Snapshot; reload: () => Promise<void> }) {
  const [pending, setPending] = useState<PairRequest>();
  const [dismiss, setDismiss] = useState(false);
  const [code, setCode] = useState("");
  const [account, setAccount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canApprove = canAll(engine, ["channels.pairing.approve"]);
  const run = async (params: unknown, method = "channels.pairing.approve") => {
    if (busy || !canAll(engine, [method])) return;
    setBusy(true); setError("");
    try { await requestOrComing(engine, method, params); setPending(undefined); setCode(""); await reload(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const accounts = snapshot?.accounts ?? [];
  const selected = accounts.find(a => `${a.channel}:${a.accountId}` === account);
  return <section className="r1-ca-pairing" aria-label="Asking to message"><h3>Asking to message</h3>
    {snapshot ? snapshot.requests.length ? snapshot.requests.map(r => <div className="r1-ca-request" key={r.requestId}><span><b>{r.senderLabel}</b><small>{r.channelLabel} · {r.accountLabel ?? r.accountId}</small></span><button className="g-ctl" type="button" disabled={busy || !canApprove} data-need="channels.pairing.approve" onClick={() => { setPending(r); setDismiss(false); }}>{canApprove ? "Approve" : "Coming"}</button><button type="button" disabled={busy || !canAll(engine, ["channels.pairing.dismiss"])} data-need="channels.pairing.dismiss" onClick={() => { setPending(r); setDismiss(true); }}>{canAll(engine, ["channels.pairing.dismiss"]) ? "Dismiss" : "Coming"}</button></div>) : <p>No one is waiting.</p> : <p>Pairing requests are unavailable.</p>}
    {pending && <div className="g-ctl r1-ca-confirm" role="group" aria-label="Confirm approval"><p>{dismiss ? "Dismiss the request from" : "Let"} {pending.senderLabel}{dismiss ? "?" : ` message Branch through ${pending.channelLabel}?`}</p><button type="button" data-local="cancel" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button><button type="button" disabled={busy} data-need="channels.pairing.approve" onClick={() => void run({ channel: pending.channel, accountId: pending.accountId, requestId: pending.requestId }, dismiss ? "channels.pairing.dismiss" : "channels.pairing.approve")}>{dismiss ? "Dismiss request" : "Approve request"}</button></div>}
    <form className="r1-ca-code" onSubmit={e => { e.preventDefault(); if (selected && code.trim()) void run({ channel: selected.channel, accountId: selected.accountId, code: code.trim() }); }}>
      <label>Approve by code<select aria-label="Pairing account" value={account} onChange={e => setAccount(e.target.value)} disabled={busy || !canApprove} data-local="account"><option value="">Choose an account</option>{accounts.map(a => <option key={`${a.channel}:${a.accountId}`} value={`${a.channel}:${a.accountId}`}>{a.channelLabel} · {a.accountLabel ?? a.accountId}</option>)}</select></label>
      <input aria-label="Pairing code" placeholder="Code from the app" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" disabled={busy || !canApprove} data-local="code" />
      <button type="submit" className="g-ctl" disabled={busy || !selected || !code.trim() || !canApprove} data-need="channels.pairing.approve">{canApprove ? "Approve" : "Coming"}</button>
    </form>
    {snapshot?.limits && <p className="r1-ca-hint">Requests expire after {Math.round(snapshot.limits.ttlMs / 60000)} minutes. Each account holds up to {snapshot.limits.pendingPerAccount} waiting.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
