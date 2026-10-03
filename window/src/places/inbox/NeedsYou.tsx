// Inbox › Needs you (DESIGN-SPEC §4.6.2.1; preview renderInbox + 41-placesap p20-inbox): status cards above the
// approvals card, the approvals and requests, the questions, then Mentions.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import type { PlaceId } from "../../places-nav/routes";
import type { Level } from "../../places-nav/level";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { agentName } from "../overview/engine";
import { canApprove, has, num, rec, resolveApproval, rows, str, type Needs, type Row } from "./data";
import { ChatRequest, DeviceRequest, NodeRequest } from "./Requests";
import { InboxRow, StatusCard, Tile, minutesAgo, minutesLeft } from "./Rows";
import { whenWord } from "../overview/format";

type Act = (operation: () => Promise<unknown>, message: string) => Promise<boolean>;
export type NeedsProps = { engine: WindowEngine; data: Needs; busy: boolean; act: Act; level: Level; loading: boolean; openConversation: (key: string) => void; openPlace: (place: PlaceId) => void; openSettings?: (page: string) => void };

export const FULL_ACCESS_GAP = "Needs the window’s connection to take the upgraded device key (device.scopes.requestUpgrade).";
const DAY = 864e5;

/** Puts a drafted message into a conversation's composer (window event "branch:compose"), then opens it. */
export function draftTo(sessionKey: string, text: string, open: (key: string) => void): void {
  window.dispatchEvent(new CustomEvent("branch:compose", { detail: { sessionKey, text } }));
  open(sessionKey);
}

/** What counts in the Needs you chip: approvals, requests and questions. Status cards never count. */
export function needsCount(data: Needs | null): number {
  return data ? data.approvals.length + data.proposals.length + data.pairing.length + data.devices.length + data.nodes.length + data.questions.length : 0;
}
export const approvalTitle = (item: Row) => { const r = rec(item.request); return str(r.title) || str(r.commandPreview) || str(r.command) || str(r.description) || "A Trunk needs your answer"; };

function Cards({ data, engine, busy, act, openConversation, openPlace, openSettings }: NeedsProps) {
  const [gone, setGone] = useState<string[]>([]);
  const ask = data.agents.list.find(a => a.id === data.agents.defaultId) ?? data.agents.list[0];
  const askBtn = (text: string) => ask ? <button type="button" className="btn sm" onClick={() => draftTo(`agent:${ask.id}:${data.agents.mainKey}`, text, openConversation)}>Ask {ask.name}</button> : null;
  const stopped = data.sessions.filter(s => s.status === "failed" && s.lastRunError && !s.helper && !s.automation && Date.now() - (s.updatedAt ?? 0) < DAY);
  const failed = data.failed.filter(j => !gone.includes(`${str(j.id)}:${num(rec(j.state).lastRunAtMs) ?? ""}`));
  const one = failed[0], oneState = rec(one?.state);
  const names = data.expired.map(p => str(p.displayName) || str(p.provider));
  const expiredAt = data.expired.flatMap(p => num(rec(p.expiry).expiresAt) ?? [])[0];
  return <div className="ib-cards">
    {data.channels.map(({ channel, label, account }) => <StatusCard key={`${channel}:${str(account.accountId)}`} tone="bad" icon="chat" title={`${label} stopped: ${str(account.lastError)}`} sub={`Messages sent to ${str(account.name) || label}${num(account.lastStopAt) !== undefined ? ` since ${whenWord(num(account.lastStopAt)!)}` : ""} haven’t reached Branch.`}>
      <button type="button" className="btn ghost sm" disabled={busy || !has(engine, "operator.admin")} onClick={() => void act(() => engine.request("channels.stop", { channel, accountId: str(account.accountId) }), `${label} is off.`)}>Turn {label} off</button>
      <button type="button" className="btn pri sm" onClick={() => openPlace("customize")}>Set it up again</button>
    </StatusCard>)}
    {stopped.map(s => <StatusCard key={s.key} icon="chat" lead={<Face size={34} label={agentName(data.agents.list, s.agentId)} />} title={`${agentName(data.agents.list, s.agentId)} stopped: ${s.title}`} sub={s.lastRunError}><button type="button" className="btn pri sm" onClick={() => openConversation(s.key)}>What it needs</button></StatusCard>)}
    {one ? <StatusCard tone="warn" icon="clock" title={failed.length > 1 ? `${failed.length} automations need a look` : `${str(one.name) || "An automation"} failed`} sub={failed.length > 1 ? failed.map(j => str(j.name)).join(" · ") : ["Failed", num(oneState.lastRunAtMs) !== undefined ? whenWord(num(oneState.lastRunAtMs)!) : "", str(oneState.lastError)].filter(Boolean).join(" · ")}>
      {askBtn(`These automations failed: ${failed.map(j => `${str(j.name)} (${str(rec(j.state).lastError) || "no error recorded"})`).join("; ")}. Explain why and how to fix them.`)}<button type="button" className="btn sm" onClick={() => openPlace("automations")}>Open</button>
      <button type="button" className="ib-x" aria-label="Dismiss" title="Dismiss" onClick={() => setGone([...gone, ...failed.map(j => `${str(j.id)}:${num(rec(j.state).lastRunAtMs) ?? ""}`)])}><Icon name="x" /></button>
    </StatusCard> : null}
    {names.length ? <StatusCard tone="warn" icon="key" title={names.length > 1 ? `Sign-ins expired: ${names.join(", ")}` : `Your ${names[0]} sign-in expired`} sub={`${expiredAt !== undefined ? `Expired ${minutesAgo(expiredAt)}. ` : ""}Trunks that use it stop until you sign in again.`}>
      {askBtn(`These sign-ins expired: ${names.join(", ")}. Explain what stops working and how to sign in again.`)}<button type="button" className="btn pri sm" disabled={!openSettings} onClick={() => openSettings?.("accounts")}>Sign in again</button>
    </StatusCard> : null}
    {!has(engine, "operator.admin") ? <StatusCard icon="lock" title="This device has limited access" sub="You can look around, but some changes need an owner’s yes."><button type="button" className="btn pri sm" disabled title={FULL_ACCESS_GAP}>Ask for full access</button></StatusCard> : null}
  </div>;
}

function Approval({ item, props }: { item: Row; props: NeedsProps }) {
  const { engine, busy, act, data, openConversation } = props;
  const request = rec(item.request), key = str(request.sessionKey), allow = canApprove(engine);
  const expired = typeof item.expiresAtMs === "number" && item.expiresAtMs <= Date.now();
  const decisions = Array.isArray(request.allowedDecisions) ? request.allowedDecisions : ["allow-once", "deny"];
  const trunk = agentName(data.agents.list, str(request.agentId));
  const detail = str(request.cwd) || str(request.description) || (str(item.kind) === "exec" ? "Command" : str(item.kind) === "branch" ? "Branch change" : "Add-on");
  return <InboxRow lead={<Face size={34} label={trunk} />} title={approvalTitle(item)} sub={`${trunk} · ${detail} · ${minutesLeft(num(item.expiresAtMs))}`}>
    <button type="button" className="btn ghost sm" disabled={!allow || busy || expired || !decisions.includes("deny")} onClick={() => void act(() => resolveApproval(engine, item, "deny"), `Said no. ${trunk} won’t do it.`)}>Don’t</button>
    {key ? <button type="button" className="btn sm" onClick={() => openConversation(key)}>Open</button> : null}
    <button type="button" className="btn pri sm" disabled={!allow || busy || expired || !decisions.includes("allow-once")} onClick={() => void act(() => resolveApproval(engine, item, "allow-once"), "Allowed once.")}>Allow</button>
  </InboxRow>;
}

function Question({ q, props }: { q: Row; props: NeedsProps }) {
  const { engine, busy, act, data, openConversation } = props;
  const list = rows(q.questions), first = list[0] ?? {}, options = rows(first.options);
  const simple = list.length === 1 && options.length > 0 && first.multiSelect !== true && first.isSecret !== true && first.isOther !== true && !first.secretStore;
  const trunk = agentName(data.agents.list, str(q.agentId)), key = str(q.sessionKey);
  const answer = (label: string) => act(() => engine.request("question.resolve", { id: str(q.id), answers: { answers: { [str(first.questionId)]: [label] } } }), "Answered.");
  return <InboxRow lead={<Face size={34} label={trunk} />} title={list.length > 1 ? `${trunk} has ${list.length} questions` : str(first.question)} sub={[trunk, str(first.header), minutesLeft(num(q.expiresAtMs))].filter(Boolean).join(" · ")}>
    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void act(() => engine.request("question.resolve", { id: str(q.id), cancel: true }), "Skipped. The Trunk carries on without an answer.")}>Skip</button>
    {key ? <button type="button" className="btn sm" onClick={() => openConversation(key)}>Open</button> : null}
    {simple ? options.map((o, i) => <button key={str(o.label)} type="button" className={i === options.length - 1 ? "btn pri sm" : "btn sm"} title={str(o.description) || undefined} disabled={busy} onClick={() => void answer(str(o.label))}>{str(o.label)}</button>) : null}
  </InboxRow>;
}

function Mentions({ props }: { props: NeedsProps }) {
  const { engine, data, busy, act, openConversation, openSettings } = props;
  if (!data.mentions.length) return null;
  const dismiss = (id: string) => act(() => engine.request("mentions.dismiss", { ids: [id] }), "Dismissed.");
  return <section className="ib-sec">
    <div className="ib-sec-h"><h2>Mentions</h2><button type="button" className="ib-link" disabled={!openSettings} onClick={() => openSettings?.("notifications")}>Notification settings</button></div>
    <div className="ib-list">{data.mentions.map(m => <InboxRow key={str(m.id)} lead={<span className="initial ib-me">{(str(m.senderLabel) || "?").slice(0, 1).toUpperCase()}</span>} title={`${(str(m.senderLabel) || "Someone").split(" ")[0]} mentioned you`} sub={[str(m.sessionTitle), num(m.createdAt) !== undefined ? whenWord(num(m.createdAt)!) : "", str(m.excerpt)].filter(Boolean).join(" · ")}>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void dismiss(str(m.id))}>Dismiss</button>
      <button type="button" className="btn sm" onClick={() => { openConversation(str(m.sessionKey)); void dismiss(str(m.id)); }}>Open</button>
    </InboxRow>)}</div>
    <p className="ib-hint ib-after">Mentions go after 7 days.</p>
  </section>;
}

export function NeedsYou(props: NeedsProps) {
  const { data, engine, busy, act, loading } = props;
  const [confirmAll, setConfirmAll] = useState(false);
  const pending = data.approvals, allow = canApprove(engine);
  const requests = data.pairing.length + data.devices.length + data.nodes.length;
  const empty = !pending.length && !requests && !data.questions.length && !data.proposals.length;
  return <>
    <Cards {...props} />
    {pending.length > 1 ? <div className="ib-bulk"><button type="button" className="btn" disabled={!allow || busy} onClick={() => setConfirmAll(true)}>Allow all {pending.length}…</button></div> : null}
    {confirmAll ? <section className="ib-confirm" aria-label="Allow all requests"><b>Allow all {pending.length}?</b><ul>{pending.map(item => <li key={`${str(item.kind)}:${str(item.id)}`}>{approvalTitle(item)}</li>)}</ul><p className="ib-hint">Each Trunk still asks next time. Device, computer and chat-app requests are left for you to answer.</p><div className="ib-acts"><button type="button" className="btn ghost sm" disabled={busy} onClick={() => setConfirmAll(false)}>Cancel</button><button type="button" className="btn pri sm" disabled={busy || !allow} onClick={() => void act(async () => { for (const item of pending) await resolveApproval(engine, item, "allow-once"); setConfirmAll(false); }, "All listed requests answered once.")}>Allow all {pending.length}</button></div></section> : null}
    {!allow && pending.length ? <p className="ib-hint">You can look, but answering requests needs approval permission.</p> : null}
    {!empty ? <div className="ib-list">
      {pending.map(item => <Approval key={`${str(item.kind)}:${str(item.id)}`} item={item} props={props} />)}
      {data.questions.map(q => <Question key={str(q.id)} q={q} props={props} />)}
      {data.pairing.map(row => <ChatRequest key={str(row.requestId)} engine={engine} busy={busy} act={act} level={props.level} row={row} ownerSet={data.ownerSet} />)}
      {data.devices.map(row => <DeviceRequest key={str(row.requestId)} engine={engine} busy={busy} act={act} level={props.level} row={row} others={data.devices.filter(d => d !== row)} />)}
      {data.proposals.map(p => <InboxRow key={str(p.id)} lead={<Tile icon="check" />} title="Branch wants to improve itself" sub={`${str(p.title)} · ${str(p.kind) === "update" ? "a change to a skill" : "a new skill"} · waiting for you`}><button type="button" className="btn sm" onClick={() => props.openPlace("customize")}>Review</button></InboxRow>)}
      {data.nodes.map(row => <NodeRequest key={str(row.requestId)} engine={engine} busy={busy} act={act} level={props.level} row={row} />)}
    </div> : !loading ? <EmptyLine icon={<Icon name="inbox" />}>Nothing is waiting for you. Trunks show up here when they need a yes.</EmptyLine> : null}
    <Mentions props={props} />
  </>;
}
