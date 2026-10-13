import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { Coming } from "../../glass/coming";
import { errorText } from "../../places/settings/adapter";
import type { Pairing as Snapshot, PairRequest } from "../../places/settings/set1/chatapps-asking";

const APPROVE_LATER = "Approving requests here comes in a later update.";
const DISMISS_LATER = "Dismissing requests here comes in a later update.";
const CODE_LATER = "Approval by code needs a window-safe engine flow.";

export function Pairing({ engine, snapshot, reload }: { engine: WindowEngine; snapshot?: Snapshot; reload: () => Promise<void> }) {
  const [pending, setPending] = useState<PairRequest>();
  const [dismiss, setDismiss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canApprove = canAll(engine, ["channels.pairing.approve"]);
  const canDismiss = canAll(engine, ["channels.pairing.dismiss"]);
  const run = async (params: unknown, method = "channels.pairing.approve") => {
    if (busy || !canAll(engine, [method])) return;
    setBusy(true); setError("");
    try { await requestOrComing(engine, method, params); setPending(undefined); await reload(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return <section className="r1-ca-pairing" aria-label="Asking to message"><h3 className="g-label">Asking to message</h3>
    {snapshot ? snapshot.requests.length ? snapshot.requests.map(r => <div className="r1-ca-request" key={r.requestId}><span className="g-label" data-lines><b>{r.senderLabel}</b><small>{r.channelLabel} · {r.accountLabel ?? r.accountId}</small></span><button type="button" disabled={busy || !canApprove} data-need="channels.pairing.approve" data-coming={canApprove ? undefined : APPROVE_LATER} title={canApprove ? undefined : APPROVE_LATER} onClick={() => { setPending(r); setDismiss(false); }}>{canApprove ? "Approve" : "Coming"}</button><button type="button" disabled={busy || !canDismiss} data-need="channels.pairing.dismiss" data-coming={canDismiss ? undefined : DISMISS_LATER} title={canDismiss ? undefined : DISMISS_LATER} onClick={() => { setPending(r); setDismiss(true); }}>{canDismiss ? "Dismiss" : "Coming"}</button></div>) : <p className="g-label">No one is waiting.</p> : <p className="g-label">Pairing requests are unavailable.</p>}
    {!!snapshot?.requests.length && (!canApprove || !canDismiss) && <small className="r1-ca-hint g-label" data-lines>{!canApprove ? APPROVE_LATER : DISMISS_LATER}</small>}
    {pending && <div className="g-clear r1-ca-confirm" role="group" aria-label="Confirm approval"><p className="g-label" data-lines>{dismiss ? "Dismiss the request from" : "Let"} {pending.senderLabel}{dismiss ? "?" : ` message Branch through ${pending.channelLabel}?`}</p><button type="button" data-local="cancel" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button><button type="button" disabled={busy} data-need="channels.pairing.approve" onClick={() => void run({ channel: pending.channel, accountId: pending.accountId, requestId: pending.requestId }, dismiss ? "channels.pairing.dismiss" : "channels.pairing.approve")}>{dismiss ? "Dismiss request" : "Approve request"}</button></div>}
    <div className="r1-ca-code" data-coming="Approval by code needs a window-safe engine flow.">
      <label><span className="g-label">Approve by code</span><Coming need="channels.pairing.approve" unwired reason={CODE_LATER} where="Pairing code"><input aria-label="Pairing code" placeholder="Code from the app" disabled /></Coming></label>
      <Coming need="channels.pairing.approve" unwired reason={CODE_LATER} where="Approve by code"><button type="button" disabled>Coming</button></Coming>
      <small className="g-label" data-lines>Approve a request above. Approval by code comes in a later update.</small>
    </div>
    {snapshot?.limits && <p className="r1-ca-hint g-label" data-lines>Requests expire after {Math.round(snapshot.limits.ttlMs / 60000)} minutes. Each account holds up to {snapshot.limits.pendingPerAccount} waiting.</p>}
    {error && <p role="alert" className="g-label" data-lines>{error}</p>}
  </section>;
}
