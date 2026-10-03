// Needs you › requests (preview 41-placesap reqRowPD18 and its dialogs): a chat-app sender asking to message
// your Trunks (channels.pairing.*), a device asking to connect (device.pair.*), a computer offering new
// abilities (node.pair.*). None of them counts in "Allow all".
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { shows, type Level } from "../../places-nav/level";
import { has, num, str, type Row } from "./data";
import { InboxRow, Tile, minutesAgo, minutesLeft } from "./Rows";

type Act = (operation: () => Promise<unknown>, message: string) => Promise<boolean>;
type Props = { engine: WindowEngine; busy: boolean; act: Act; level: Level };

const SCOPE_WORDS: Record<string, string> = {
  "operator.read": "See your Trunks and conversations",
  "operator.write": "Send messages to your Trunks",
  "operator.approvals": "Answer approvals",
  "operator.questions": "Answer your Trunks’ questions",
  "operator.pairing": "Let other devices connect",
  "operator.admin": "Needs an owner’s yes: change settings",
  "operator.talk": "Talk to your Trunks by voice",
};
const risky = (line: string) => /run commands|owner’s yes/i.test(line);
const iso = (v: unknown) => { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : undefined; };

export function ChatRequest({ engine, busy, act, row, ownerSet }: Props & { row: Row; ownerSet: boolean }) {
  const [review, setReview] = useState(false);
  const [notify, setNotify] = useState(false);
  const [owner, setOwner] = useState(false);
  const key = { channel: str(row.channel), accountId: str(row.accountId), requestId: str(row.requestId) };
  const sender = str(row.senderLabel) || str(row.senderId), app = str(row.channelLabel) || str(row.channel);
  const allow = () => act(() => engine.request("channels.pairing.approve", { ...key, ...(notify ? { notify: true } : {}), ...(owner ? { bootstrapCommandOwner: true } : {}) }), `${sender} can message your Trunks on ${app}.`).then(ok => { if (ok) setReview(false); });
  const sub = [str(row.accountLabel), minutesAgo(iso(row.createdAt)) && `asked ${minutesAgo(iso(row.createdAt))}`, minutesLeft(iso(row.expiresAt))].filter(Boolean).join(" · ");
  return <>
    <InboxRow lead={<Tile icon="chat" />} title={`${sender} wants to message your Trunks on ${app}`} sub={sub}>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void act(() => engine.request("channels.pairing.dismiss", key), "Removed. They can ask again.")}>Don’t</button>
      <button type="button" className="btn sm" onClick={() => setReview(true)}>Review</button>
      <button type="button" className="btn pri sm" disabled={busy} onClick={() => void allow()}>Allow</button>
    </InboxRow>
    {review ? <Dialog title={`Let ${sender} message your Trunks?`} onClose={() => setReview(false)} footer={<><button type="button" className="btn ghost" onClick={() => setReview(false)}>Cancel</button><button type="button" className="btn pri" disabled={busy} onClick={() => void allow()}>Allow</button></>}>
      <p className="ib-p">They can talk to your Trunks in direct messages. It doesn’t let them into groups.</p>
      <label className="check"><input type="checkbox" checked={notify} disabled={row.notifySupported === false} onChange={e => setNotify(e.target.checked)} /> Tell them once you’ve said yes</label>
      {!ownerSet ? <><label className="check"><input type="checkbox" checked={owner} disabled={!has(engine, "operator.admin")} onChange={e => setOwner(e.target.checked)} /> Also make them the first command owner</label><p className="ib-hint ib-indent">Command owners can run owner-only commands and approve risky actions.</p></> : null}
    </Dialog> : null}
  </>;
}

function DeviceDialog({ engine, busy, act, row, others, level, close }: Props & { row: Row; others: Row[]; close: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 1500); return () => clearTimeout(t); }, []);
  const id = str(row.requestId), name = str(row.displayName) || str(row.deviceId) || "New device";
  const asks = (Array.isArray(row.scopes) ? row.scopes : []).map(s => SCOPE_WORDS[str(s)] || str(s)).filter(Boolean);
  const decide = (method: string, message: string) => act(() => engine.request(method, { requestId: id }), message).then(ok => { if (ok) close(); });
  const all = (method: string, message: string) => act(async () => { for (const r of [row, ...others]) await engine.request(method, { requestId: str(r.requestId) }); }, message).then(ok => { if (ok) close(); });
  const { publicKey: _key, ...details } = row;
  return <Dialog wide title="Allow this device?" onClose={close} footer={<>
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void decide("device.pair.reject", "Not allowed. The device can ask again.")}>Don’t</button>
    <button type="button" className="btn ghost" onClick={close}>Later</button>
    <button type="button" className="btn pri" disabled={!armed || busy} onClick={() => void decide("device.pair.approve", `${name} is connected.`)}>Allow</button></>}>
    <div className="ib-devw"><Tile icon={str(row.deviceFamily).toLowerCase().includes("phone") ? "phone" : "plug"} /><span className="ib-grow"><b>{name}</b><small>{[str(row.platform), str(row.role)].filter(Boolean).join(" · ")}</small></span>{row.isRepair === true ? <span className="ib-pill warn">Already paired: allowing replaces its key</span> : null}</div>
    <h3 className="ib-h3">What it asks to do</h3>
    {asks.length ? <ul className="ib-asks">{asks.map(a => <li key={a} className={risky(a) ? "warn" : ""}>{a}</li>)}</ul> : <p className="ib-hint">It asks for no access beyond connecting.</p>}
    {shows(level, "technical") ? <details className="ib-det"><summary>Details</summary><pre>{JSON.stringify(details, null, 1)}</pre></details> : null}
    {others.length ? <div className="ib-more"><small>{others.length} more waiting</small><button type="button" className="btn sm" disabled={busy} onClick={() => void all("device.pair.approve", "Every waiting device is allowed.")}>Allow all</button><button type="button" className="btn ghost sm" disabled={busy} onClick={() => void all("device.pair.reject", "None of them was allowed. They can ask again.")}>Don’t allow any</button></div> : null}
  </Dialog>;
}

export function DeviceRequest(props: Props & { row: Row; others: Row[] }) {
  const { engine, busy, act, row } = props;
  const [open, setOpen] = useState(false);
  const name = str(row.displayName) || str(row.deviceId) || "New device";
  const sub = [str(row.platform), str(row.role), num(row.ts) !== undefined ? `asked ${minutesAgo(num(row.ts))}` : ""].filter(Boolean).join(" · ");
  return <>
    <InboxRow lead={<Tile icon={str(row.deviceFamily).toLowerCase().includes("phone") ? "phone" : "plug"} />} title={<button type="button" className="ib-title-btn" onClick={() => setOpen(true)}>{name} wants to connect{row.isRepair === true ? " again" : ""}</button>} sub={sub}>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void act(() => engine.request("device.pair.reject", { requestId: str(row.requestId) }), "Not allowed. The device can ask again.")}>Don’t</button>
      <button type="button" className="btn pri sm" onClick={() => setOpen(true)}>Allow</button>
    </InboxRow>
    {open ? <DeviceDialog {...props} close={() => setOpen(false)} /> : null}
  </>;
}

export function NodeRequest({ engine, busy, act, row }: Props & { row: Row }) {
  const [review, setReview] = useState(false);
  const id = str(row.requestId), name = str(row.displayName) || str(row.nodeId) || "A computer";
  const adds = [...(Array.isArray(row.commands) ? row.commands : []), ...(Array.isArray(row.caps) ? row.caps : [])].map(str).filter(Boolean);
  const decide = (method: string, message: string) => act(() => engine.request(method, { requestId: id }), message).then(ok => { if (ok) setReview(false); });
  const allow = () => decide("node.pair.approve", `Allowed. Trunks can use ${name}’s new abilities.`);
  const deny = () => decide("node.pair.reject", "Not allowed. Trunks keep the abilities it had before.");
  return <>
    <InboxRow lead={<Tile icon="plug" />} title={`${name} wants to offer new abilities`} sub={adds.length ? `${adds.length} new: ${adds.slice(0, 2).join(", ")}` : str(row.platform)}>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void deny()}>Don’t</button>
      <button type="button" className="btn sm" onClick={() => setReview(true)}>Review</button>
      <button type="button" className="btn pri sm" disabled={busy} onClick={() => void allow()}>Allow</button>
    </InboxRow>
    {review ? <Dialog title="Allow this computer’s new abilities?" onClose={() => setReview(false)} footer={<><button type="button" className="btn ghost" disabled={busy} onClick={() => void deny()}>Don’t</button><button type="button" className="btn pri" disabled={busy} onClick={() => void allow()}>Allow</button></>}>
      <p className="ib-p">This computer is asking to add abilities your Trunks could use.</p>
      {adds.length ? <ul className="ib-asks">{adds.map(a => <li key={a} className={/exec|run|shell|system/i.test(a) ? "warn" : ""}>{a}</li>)}</ul> : <p className="ib-hint">Nothing new asked for.</p>}
      <p className="ib-hint">Until allowed, Trunks see only the abilities it had before.</p>
    </Dialog> : null}
  </>;
}
