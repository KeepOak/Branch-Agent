// People › Live now (§4.6.5.1): who is online, then a card per run happening now, with a read-only Watch.
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import { Face } from "../../face/Face";
import { Dialog } from "../../shell/Dialog";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../library/data";
import { sharedConnections } from "../overview/engine";
import { ACTIVITY_WORD, activeProfiles, activityOf, deviceName, firstName, nameOf, ownerCounts, presence, presenceOf, profiles, rec, recs, rows, str, trunkNames, type Profile, type Row } from "./data";
import { Avatar, Empty, Glyph, Status } from "./ui";

/** No engine method lets someone ask to join another person's run yet. */
export const ASK_TO_JOIN_OFF = "Needs the engine's ask-to-join method.";
const ONLINE = "Online";
const SHARED_OWNER_TIP = "Connected with Branch’s key or a tunnel, not a personal sign-in.";

type Res = ReturnType<typeof useResource<unknown>>;
type LiveProps = { engine: WindowEngine; users: Res; runs: Res; me: string | null; openConversation: (key: string) => void; onPerson: (id: string) => void };

export function LiveNow({ engine, users, runs, me, openConversation, onPerson }: LiveProps) {
  const live = useResource<unknown>(engine, "system-presence");
  const counts = useResource<unknown>(engine, "sessions.list", { limit: 1, includeOwnerSessionCounts: true });
  const trunks = useResource<unknown>(engine, "agents.list");
  const [watch, setWatch] = useState<Row | null>(null);
  const people = activeProfiles(profiles(users.data));
  const conns = presence(live.data);
  // a helper rides inside its parent run (the preview shows one card per run, never one per helper)
  const working = rows(runs.data).filter(r => r.working && !r.helper);
  const names = trunkNames(trunks.data);
  const others = people.filter(p => p.id !== me && presenceOf(conns, p.id).length > 0);
  const tally = ownerCounts(counts.data);
  const keyed = sharedConnections(live.data).length;
  return <>
    <Status {...users} />
    {(others.length > 0 || keyed > 0) && <div className="pp-online" role="group" aria-label={ONLINE}>
      <span className="pp-onl">{ONLINE}</span>
      {others.map(p => { const act = activityOf(presenceOf(conns, p.id)); const c = tally.find(t => t.profileId === p.id);
        return <button key={p.id} type="button" className="pp-chip" onClick={() => onPerson(p.id)}>
          <Avatar id={p.id} name={nameOf(p)} size={24} activity={act} label={act ? ACTIVITY_WORD[act] : undefined} />
          <b>{firstName(nameOf(p))}</b>{c && <small>{c.open} open · {c.running} running</small>}
        </button>; })}
      {keyed > 0 && <span className="pp-chip pp-keyed" tabIndex={0} title={SHARED_OWNER_TIP}><Glyph name="key" /><b>Shared owner</b><small>{keyed} {keyed === 1 ? "connection" : "connections"}</small></span>}
    </div>}
    <Status {...runs} />
    {runs.data != null && !working.length && <Empty>Nothing is running right now.</Empty>}
    <div className="pp-runs">{working.map(r => <RunCard key={r.key} run={r} owner={people.find(p => p.id === r.ownerId)} trunk={names.get(r.agentId) || r.agentId} conns={conns} mine={!r.ownerId || r.ownerId === me} open={() => openConversation(r.key)} watch={() => setWatch(r)} />)}</div>
    {watch && <WatchDialog engine={engine} run={watch} owner={people.find(p => p.id === watch.ownerId)} trunk={names.get(watch.agentId) || watch.agentId} onClose={() => setWatch(null)} />}
  </>;
}

const SHARED = new Set(["shared", "read-only", "suggest"]);
function RunCard({ run, owner, trunk, conns, mine, open, watch }: { run: Row; owner?: Profile; trunk: string; conns: ReturnType<typeof presence>; mine: boolean; open: () => void; watch: () => void }) {
  const who = owner ? nameOf(owner) : run.ownerLabel || "Someone";
  const theirs = owner ? presenceOf(conns, owner.id) : [];
  const where = theirs.length ? [deviceName(theirs[0]), theirs[0].version && `Branch ${theirs[0].version}`].filter(Boolean).join(" · ") : "";
  const line = [run.preview, run.model].filter(Boolean).join(" · ");
  return <article className="pp-run">
    <div className="pp-run-h"><Avatar id={owner?.id ?? run.ownerId ?? run.key} name={who} size={30} activity={activityOf(theirs)} />
      <span className="grow"><b>{who}</b>{where && <small>{where}</small>}</span><span className="pill ok"><i />Working</span></div>
    <div className="pp-run-b"><Face size={30} label={trunk} state="work" />
      <span className="grow"><b>{trunk}{SHARED.has(run.visibility) && <> <span className="pp-tag">shared</span></>}</b><span>{run.title}</span>{line && <small>{line}</small>}</span></div>
    <div className="pp-acts">{mine ? <button type="button" className="btn sm" onClick={open}>Open</button>
      : <><button type="button" className="btn sm" onClick={watch}><Glyph name="eye" />Watch</button><button type="button" className="btn ghost sm" disabled title={shownWhy(ASK_TO_JOIN_OFF)}>Ask to join</button></>}</div>
  </article>;
}

/** Read-only steps of a run: the engine's preview of its latest items (sessions.preview). */
function WatchDialog({ engine, run, owner, trunk, onClose }: { engine: WindowEngine; run: Row; owner?: Profile; trunk: string; onClose: () => void }) {
  const preview = useResource<unknown>(engine, "sessions.preview", { keys: [run.key], limit: 12, maxChars: 240 });
  const first = firstName(owner ? nameOf(owner) : run.ownerLabel || "Someone");
  const entry = recs(rec(preview.data).previews).find(p => str(p.key) === run.key);
  const items = recs(entry?.items).filter(i => str(i.text));
  return <Dialog wide title={`${first}’s ${trunk}`} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Close</button><button type="button" className="btn" disabled title={shownWhy(ASK_TO_JOIN_OFF)}>Ask to join</button></>}>
    <p className="pp-hint" style={{ margin: 0 }}>Read-only. You see what {first} shares with the team: steps and questions, never their private files.</p>
    <div className="pp-peek"><b>{run.title}</b><Status {...preview} />
      {entry && !items.length && <p className="pp-hint">No steps to show yet.</p>}
      <ol className="pp-tl">{items.map((item, i) => { const last = i === items.length - 1;
        return <li key={i} className={last ? "run" : "ok"}><Glyph name={str(item.role) === "tool" ? "tool" : last ? "pulse" : "chat"} /><span>{str(item.text)}</span></li>; })}</ol>
    </div>
  </Dialog>;
}
