// People › Teams of specialists (§4.6.5.5): a read-only card per team task, from the engine's swarm summaries on
// conversation rows (sessions.list `swarm`): who asked, each member's Trunk and where it stands.
import { Face } from "../../face/Face";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../library/data";
import { num, recs, rows, str, trunkNames, type Row } from "./data";
import { Empty, Status } from "./ui";

type Member = { key: string; status: string };
type Team = { row: Row; round: number; members: Member[] };
const PILL: Record<string, { cls: string; word: string }> = {
  running: { cls: "pill work", word: "Working" }, queued: { cls: "pill idle", word: "Not yet" },
  done: { cls: "pill ok", word: "Done" }, failed: { cls: "pill bad", word: "Failed" },
};

/** Teams with work still going: a swarm group that has something queued or running. */
export function teams(all: Row[]): Team[] {
  return all.flatMap(row => {
    const groups = recs(row.swarm?.groups);
    const live = groups.filter(g => (num(g.running) ?? 0) + (num(g.queued) ?? 0) > 0);
    if (!live.length) return [];
    const members = live.flatMap(g => recs(g.children).map(c => ({ key: str(c.sessionKey), status: str(c.status) }))).filter(m => m.key);
    return [{ row, round: groups.length, members }];
  });
}

export function TeamsTab({ engine }: { engine: WindowEngine }) {
  const list = useResource<unknown>(engine, "sessions.list", { includeDerivedTitles: true, includeLastMessage: true });
  const agents = useResource<unknown>(engine, "agents.list");
  const all = rows(list.data);
  const names = trunkNames(agents.data);
  const found = teams(all);
  return <>
    <Status {...list} />
    {list.data != null && !found.length && <Empty>No team task is running.</Empty>}
    {found.map(team => { const lead = names.get(team.row.agentId) || team.row.agentId;
      return <section key={team.row.key} className="pp-team" aria-label={team.row.title}>
        <div className="th"><b>{team.row.title}</b><span className="pill work"><i />Working · round {team.round}</span></div>
        <p>A team of {team.members.length} Trunks. {team.row.ownerLabel ? `Asked by ${team.row.ownerLabel}; ` : ""}{lead} holds it now.</p>
        <div className="pp-rows flat">{team.members.map(m => { const child = all.find(r => r.key === m.key); const agent = child?.agentId || m.key.split(":")[1] || ""; const trunk = names.get(agent) || agent || "A Trunk"; const pill = PILL[m.status] ?? PILL.queued;
          return <div key={m.key} className="pp-prow"><Face size={30} label={trunk} state={m.status === "running" ? "work" : "idle"} />
            <span className="grow"><b>{trunk}</b><small>{child ? child.title : "Its conversation isn’t visible to you."}</small></span><span className={pill.cls}><i />{pill.word}</span></div>; })}</div>
        <p className="pp-hint" style={{ margin: "8px 0 0" }}>This card only looks; it changes nothing. It comes from the team’s tasks, and a Guest or a short-lived key doesn’t see it.</p>
      </section>; })}
  </>;
}
