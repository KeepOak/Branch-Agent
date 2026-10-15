// "<n> messages with <k> agents" (Grok parity X06; DESIGN-SPEC §4.2.4 "Talked it through (A2A)"): Trunks talking to
// each other collapse into one closed row beside the 28 px face of the Trunk that started the exchange, so the room
// reads as their reports to you. The row names who talked; opened, each line is the speaker's 22 px face, their name
// in bold and what they said, with @mentions marked. The lines stay in the page while closed, so Find still reaches them.
import { useState } from "react";
import { Face } from "../face/Face";
import { PRIORITY } from "../face/cap";
import { Icon, ICONS } from "../thread/icons";
import { talkAgents, talkSummary, type TalkItem } from "./fold";
import { lineText } from "./RoomMessage";
import "./rooms.css";

/** "A and B", "A, B and C". */
function names(list: string[]): string {
  return list.length < 2 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

export function TalkedFold({ talk, ownName, trunkName }: { talk: TalkItem; ownName: string; trunkName: (agentId: string) => string }) {
  const [open, setOpen] = useState(false);
  const fromName = trunkName(talk.from);
  const agents = talkAgents(talk).map((id) => (id ? trunkName(id) : ownName));
  return (
    <div className="msg reply rm-talk-row" data-testid="talked-through">
      <span className="gutter">
        <Face size={28} label={fromName} priority={PRIORITY.row} />
      </span>
      <details className="rm-talk" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <Icon d={ICONS.branch} size={15} />
          <span className="rm-talk-n">{talkSummary(talk.lines.length, agents.length)}</span>
          <span className="rm-talk-who">{names(agents)}</span>
        </summary>
        {talk.lines.map((line) => {
          const name = line.agentId ? trunkName(line.agentId) : ownName;
          return (
            <div key={line.key} className="rm-talk-l">
              <Face size={22} label={name} priority={PRIORITY.row} />
              <span>
                <b>{name}</b> {lineText(line.text)}
              </span>
            </div>
          );
        })}
      </details>
    </div>
  );
}
