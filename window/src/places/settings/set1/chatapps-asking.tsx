// Settings › Chat apps › Asking to message (§4.7.10): people waiting to message a Trunk, from channels.pairing.list;
// Approve (with "Tell them" and "make them the owner" where the engine offers them) and Dismiss go to
// channels.pairing.approve / dismiss. Adapted from engine/ui/src/pages/channels/view.pairing.ts.
import { Fragment, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { visible } from "../adapter";
import { Btn, Ctl, Hint, Sec, useLevel, useSaveRunner } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import { ago, type App } from "./chatapps-data";

export type PairAccount = { channel: string; channelLabel: string; accountId: string; accountLabel?: string; notifySupported: boolean };
export type PairRequest = { requestId: string; channel: string; channelLabel: string; accountId: string; accountLabel?: string; senderId: string; senderLabel: string; metadata?: Record<string, string>; createdAt: string; expiresAt: string; notifySupported: boolean };
export type Pairing = { accounts: PairAccount[]; requests: PairRequest[]; commandOwnerConfigured: boolean; limits: { pendingPerAccount: number; ttlMs: number } };
export type Filter = { app: string; acct: string };

const until = (iso: string) => { const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000)); return m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`; };
export const reqLine = (r: PairRequest) => [visible(r.channelLabel), visible(r.accountLabel ?? r.accountId), `asked ${ago(Date.parse(r.createdAt))}`, `expires ${until(r.expiresAt)}`].join(" · ");

type Props = { engine: WindowEngine; apps: App[]; pairing?: Pairing; error?: string; reload: () => Promise<void>; filter: Filter; setFilter: (f: Filter) => void; trunkFor: (channel: string) => string };

export function Asking({ engine, apps, pairing, error, reload, filter, setFilter, trunkFor }: Props) {
  const [approve, setApprove] = useState<PairRequest | null>(null);
  const [dismiss, setDismiss] = useState<PairRequest | null>(null);
  if (!apps.length) return null;
  const all = pairing?.requests ?? [];
  const shown = all.filter((r) => (!filter.app || r.channel === filter.app) && (!filter.acct || r.accountId === filter.acct));
  const accts = (pairing?.accounts ?? []).filter((a) => a.channel === filter.app);
  return (
    <Sec title="Asking to message" right={<span className="n-ca">{all.length}</span>} id="chatapps-asking">
      <div className="acts filt-ca">
        <select className="inp" aria-label="Which app" value={filter.app} onChange={(e) => setFilter({ app: e.target.value, acct: "" })}>
          <option value="">All apps</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="inp" aria-label="Which account" value={filter.acct} disabled={!filter.app} onChange={(e) => setFilter({ ...filter, acct: e.target.value })}>
          <option value="">All accounts</option>{accts.map((a) => <option key={a.accountId} value={a.accountId}>{visible(a.accountLabel ?? a.accountId)}</option>)}
        </select>
      </div>
      {error ? <Hint>{visible(error)}</Hint> : shown.length ? (
        <div className="rows">{shown.map((r) => <RequestRow key={r.requestId} r={r} onApprove={() => setApprove(r)} onDismiss={() => setDismiss(r)} />)}</div>
      ) : <Hint>{all.length ? "No one matches these filters." : "No one is waiting."}</Hint>}
      <Ctl title="Approve by code" sub="Approves the person who was sent that code." off="Branch can’t approve by code from here yet; approve the request above.">
        <span className="code-ca" role="group" aria-label="Approve by code">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Fragment key={i}>{i === 4 ? <i className="dash-ca">-</i> : null}<input className="inp" maxLength={1} disabled aria-label={`Character ${i + 1}`} /></Fragment>)}</span>
      </Ctl>
      {pairing ? <Hint>Requests expire after {Math.round(pairing.limits.ttlMs / 60000)} minutes. Each account holds up to {pairing.limits.pendingPerAccount} waiting.</Hint> : null}
      {approve ? <ApproveDialog engine={engine} r={approve} trunk={trunkFor(approve.channel)} ownerSet={pairing?.commandOwnerConfigured !== false} onClose={() => { setApprove(null); void reload(); }} /> : null}
      {dismiss ? <DismissDialog engine={engine} r={dismiss} onClose={() => { setDismiss(null); void reload(); }} /> : null}
    </Sec>
  );
}

function RequestRow({ r, onApprove, onDismiss }: { r: PairRequest; onApprove: () => void; onDismiss: () => void }) {
  const meta = Object.entries(r.metadata ?? {});
  return (
    <div className="prow req-ca">
      <Logo id={r.channel} name={r.channelLabel} size={30} />
      <span className="grow">
        <b>{visible(r.senderLabel)}</b><small>{reqLine(r)}</small>
        <details className="det-ca"><summary>Details</summary><dl className="kv-ca"><dt>ID</dt><dd>{visible(r.senderId)}</dd>{meta.map(([k, v]) => <Fragment key={k}><dt>{visible(k)}</dt><dd>{visible(v)}</dd></Fragment>)}</dl></details>
      </span>
      <Btn pri sm onClick={onApprove}>Approve</Btn>
      <Btn ghost sm onClick={onDismiss}>Dismiss</Btn>
    </div>
  );
}

function ApproveDialog({ engine, r, trunk, ownerSet, onClose }: { engine: WindowEngine; r: PairRequest; trunk: string; ownerSet: boolean; onClose: () => void }) {
  const level = useLevel();
  const save = useSaveRunner();
  const [tell, setTell] = useState(false);
  const [owner, setOwner] = useState(false);
  const go = async () => {
    const ok = await save(() => engine.request("channels.pairing.approve", { channel: r.channel, accountId: r.accountId, requestId: r.requestId, ...(tell ? { notify: true } : {}), ...(owner ? { bootstrapCommandOwner: true } : {}) }));
    if (ok) onClose();
  };
  return (
    <Dialog title={`Let ${visible(r.senderLabel)} message ${trunk}?`} onClose={onClose} testid="chatapps-approve" footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" onClick={() => void go()}>Approve</button></>}>
      <p className="mono-ca">{[visible(r.senderId), visible(r.channelLabel), visible(r.accountLabel ?? r.accountId)].join(" · ")}</p>
      <div className="info-ca">They can message in direct chats. Groups are separate.</div>
      {r.notifySupported ? <label className="row-ca"><input type="checkbox" checked={tell} onChange={(e) => setTell(e.target.checked)} /><span>Tell them they’re approved</span></label> : null}
      {level >= 1 && !ownerSet ? <label className="row-ca"><input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} /><span>Also make them the owner here<small className="hint">The owner can run owner-only commands and answer approvals from {visible(r.channelLabel)}. Offered only while no owner is set.</small></span></label> : null}
    </Dialog>
  );
}

function DismissDialog({ engine, r, onClose }: { engine: WindowEngine; r: PairRequest; onClose: () => void }) {
  const save = useSaveRunner();
  const go = async () => { if (await save(() => engine.request("channels.pairing.dismiss", { channel: r.channel, accountId: r.accountId, requestId: r.requestId }))) onClose(); };
  return (
    <Dialog title="Dismiss this request?" onClose={onClose} testid="chatapps-dismiss" footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn bad" onClick={() => void go()}>Dismiss</button></>}>
      <p className="dlg-p-ca">They aren’t blocked and can ask again.</p>
    </Dialog>
  );
}
