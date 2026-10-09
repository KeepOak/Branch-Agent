// Inbox › Finished (§4.6.2.2) and Later (§4.6.2.4).
import { useState } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Icon } from "../../shell/icons";
import { Face } from "../../face/Face";
import { agentName, conversationTitle, type Agent, type Session } from "../overview/engine";
import { InboxRow } from "./Rows";


/** Conversations whose work has finished, newest first. */
export function finishedRows(list: Session[]): Session[] {
  return list.filter(s => !s.working && !s.helper && !s.automation && !s.archived && !s.global && (s.status === "done" || Boolean(s.lastRunId)));
}

export function Finished({ list, agents, loading, open }: { list: Session[]; agents: Agent[]; loading: boolean; open: (key: string) => void }) {
  const [shown, setShown] = useState(20);
  const done = finishedRows(list);
  if (!done.length) return loading ? null : <EmptyLine icon={<Icon name="inbox" />}>Nothing has finished yet.</EmptyLine>;
  return <>
    <div className="ib-list">{done.slice(0, shown).map(s => {
      const trunk = agentName(agents, s.agentId);
      return <InboxRow key={s.key} unread={s.unread} lead={<Face size={34} label={trunk} />} title={conversationTitle(s, trunk)} sub={[trunk, s.recap || s.preview].filter(Boolean).join(" · ")}>
        <button type="button" className="btn sm" onClick={() => open(s.key)}>Open</button>
      </InboxRow>;
    })}</div>
    {done.length > shown ? <div className="ib-show"><small>Showing {shown} of {done.length}</small><button type="button" className="btn ghost sm" onClick={() => setShown(shown + 20)}>Show more</button></div> : null}
  </>;
}

export function Later() {
  return <>
    <p className="ib-hint ib-lead">Work that finishes later: by a reply it waits for, a step only you can do, or a job handed over to another time.</p>
    <EmptyLine icon={<Icon name="clock" />}>Nothing is waiting to finish later.</EmptyLine>
  </>;
}
