// People asking to message (channels.pairing.list), as Classic's Asking to message: filter by app and account, each
// request's details, Approve (with "Tell them they're allowed" and "Also make them the owner here" where the engine
// offers them) and Dismiss through channels.pairing.approve / dismiss. Approval by code stays Coming, as in Classic.
import { Fragment, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { Coming } from "../../glass/coming";
import { errorText, visible } from "../../places/settings/adapter";
import { ago } from "../../places/settings/set1/chatapps-data";
import type { Pairing as Snapshot, PairRequest } from "../../places/settings/set1/chatapps-asking";

const APPROVE_LATER = "Approving requests here comes in a later update.";
const DISMISS_LATER = "Dismissing requests here comes in a later update.";
const until = (iso: string) => { const at = Date.parse(iso); if (!Number.isFinite(at)) return ""; const m = Math.max(0, Math.round((at - Date.now()) / 60000)); return m < 60 ? "in " + m + " min" : "in " + Math.round(m / 60) + " h"; };
const reqLine = (r: PairRequest) => [visible(r.channelLabel), visible(r.accountLabel ?? r.accountId), r.createdAt ? "asked " + ago(Date.parse(r.createdAt)) : "", r.expiresAt && until(r.expiresAt) ? "expires " + until(r.expiresAt) : ""].filter(Boolean).join(" · ");
const CODE_LATER = "Approval by code needs a window-safe engine flow.";

type Props = {
  engine: WindowEngine; snapshot?: Snapshot; reload: () => Promise<void>;
  /** The connected apps, for the app and account filters (none in Manage, which shows one app). */
  apps?: { id: string; name: string }[];
  /** Advanced and up offer "Also make them the owner here" while no owner is set. */
  level?: number;
  /** The Trunk that answers in a channel, named in the approval question. */
  trunkFor?: (channel: string) => string;
};

export function Pairing({ engine, snapshot, reload, apps = [], level = 0, trunkFor }: Props) {
  const [pending, setPending] = useState<PairRequest>();
  const [dismiss, setDismiss] = useState(false);
  const [tell, setTell] = useState(false);
  const [owner, setOwner] = useState(false);
  const [filter, setFilter] = useState({ app: "", acct: "" });
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
  const open = (r: PairRequest, d: boolean) => { setPending(r); setDismiss(d); setTell(false); setOwner(false); };
  const all = snapshot?.requests ?? [];
  const shown = all.filter((r) => (!filter.app || r.channel === filter.app) && (!filter.acct || r.accountId === filter.acct));
  const accts = (snapshot?.accounts ?? []).filter((a) => a.channel === filter.app);
  return <section className="r1-ca-pairing" aria-label="Asking to message" id="chatapps-asking"><h3 className="g-label">Asking to message <span>{all.length}</span></h3>
    {apps.length > 1 && snapshot ? <div className="r1-ca-add" role="group" aria-label="Filter requests">
      <select aria-label="Which app" value={filter.app} data-local="" onChange={(e) => setFilter({ app: e.target.value, acct: "" })}><option value="">All apps</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select aria-label="Which account" value={filter.acct} disabled={!filter.app} data-local="" onChange={(e) => setFilter({ ...filter, acct: e.target.value })}><option value="">All accounts</option>{accts.map((a) => <option key={a.accountId} value={a.accountId}>{visible(a.accountLabel ?? a.accountId)}</option>)}</select>
    </div> : null}
    {snapshot ? shown.length ? shown.map(r => <div className="r1-ca-request" key={r.requestId}>
      <span className="g-label" data-lines><b>{r.senderLabel}</b><small>{reqLine(r)}</small></span>
      <details className="r1-ca-details"><summary className="g-label">Details</summary><dl className="r1-ca-facts"><div><dt className="g-label">ID</dt><dd className="g-label">{visible(r.senderId)}</dd></div>{Object.entries(r.metadata ?? {}).map(([k, v]) => <Fragment key={k}><div><dt className="g-label">{visible(k)}</dt><dd className="g-label">{visible(v)}</dd></div></Fragment>)}</dl></details>
      <button type="button" disabled={busy || !canApprove} data-need="channels.pairing.approve" data-coming={canApprove ? undefined : APPROVE_LATER} title={canApprove ? undefined : APPROVE_LATER} onClick={() => open(r, false)}>{canApprove ? "Approve" : "Coming"}</button>
      <button type="button" disabled={busy || !canDismiss} data-need="channels.pairing.dismiss" data-coming={canDismiss ? undefined : DISMISS_LATER} title={canDismiss ? undefined : DISMISS_LATER} onClick={() => open(r, true)}>{canDismiss ? "Dismiss" : "Coming"}</button>
    </div>) : <p className="g-label">{all.length ? "No one matches these filters." : "No one is waiting."}</p> : <p className="g-label">Pairing requests are unavailable.</p>}
    {!!snapshot?.requests.length && (!canApprove || !canDismiss) && <small className="r1-ca-hint g-label" data-lines>{!canApprove ? APPROVE_LATER : DISMISS_LATER}</small>}
    {pending && <div className="g-clear r1-ca-confirm" role="group" aria-label="Confirm approval">
      <p className="g-label" data-lines>{dismiss ? "Dismiss the request from " + pending.senderLabel + "? They aren’t blocked and can ask again." : "Let " + pending.senderLabel + " message " + (trunkFor?.(pending.channel) ?? "Branch") + " through " + pending.channelLabel + "? They can message in direct chats. Groups are separate."}</p>
      {!dismiss && pending.notifySupported ? <label className="r1-ca-check"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /><span className="g-label">Tell them they’re allowed</span></label> : null}
      {!dismiss && level >= 1 && snapshot?.commandOwnerConfigured === false ? <label className="r1-ca-check"><input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} /><span className="g-label" data-lines>Also make them the owner here. The owner can run owner-only commands and answer approvals from {visible(pending.channelLabel)}. Offered only while no owner is set.</span></label> : null}
      <button type="button" data-local="cancel" disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
      <button type="button" disabled={busy} data-need={dismiss ? "channels.pairing.dismiss" : "channels.pairing.approve"} onClick={() => void run({ channel: pending.channel, accountId: pending.accountId, requestId: pending.requestId, ...(!dismiss && tell ? { notify: true } : {}), ...(!dismiss && owner ? { bootstrapCommandOwner: true } : {}) }, dismiss ? "channels.pairing.dismiss" : "channels.pairing.approve")}>{dismiss ? "Dismiss request" : "Approve request"}</button>
    </div>}
    <div className="r1-ca-code" data-coming="Approval by code needs a window-safe engine flow.">
      <label><span className="g-label">Approve by code</span><Coming need="channels.pairing.approve" unwired reason={CODE_LATER} where="Pairing code"><input aria-label="Pairing code" placeholder="Code from the app" disabled /></Coming></label>
      <Coming need="channels.pairing.approve" unwired reason={CODE_LATER} where="Approve by code"><button type="button" disabled>Coming</button></Coming>
      <small className="g-label" data-lines>Approve a request above. Approval by code comes in a later update.</small>
    </div>
    {snapshot?.limits && <p className="r1-ca-hint g-label" data-lines>Requests expire after {Math.round(snapshot.limits.ttlMs / 60000)} minutes. Each account holds up to {snapshot.limits.pendingPerAccount} waiting.</p>}
    {error && <p role="alert" className="g-label" data-lines>{error}</p>}
  </section>;
}
