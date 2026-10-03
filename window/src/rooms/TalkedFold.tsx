// "<A> and <B> talked it through · <n> messages" (DESIGN-SPEC §4.2.4 "Talked it through (A2A)"): a fold, open
// by default, beside the 28 px face of the Trunk that started the exchange; each line is the speaker's 22 px face,
// their name in bold and what they said, with @mentions marked.
import { useState } from "react";
import { Face } from "../face/Face";
import { PRIORITY } from "../face/cap";
import { Icon, ICONS } from "../thread/icons";
import { talkSummary, type TalkItem } from "./fold";
import { lineText } from "./RoomMessage";
import "./rooms.css";

export function TalkedFold({ talk, ownName, trunkName }: { talk: TalkItem; ownName: string; trunkName: (agentId: string) => string }) {
  const [open, setOpen] = useState(true);
  const fromName = trunkName(talk.from);
  return (
    <div className="msg reply rm-talk-row" data-testid="talked-through">
      <span className="gutter">
        <Face size={28} label={fromName} priority={PRIORITY.row} />
      </span>
      <details className="rm-talk" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          <Icon d={ICONS.branch} size={15} />
          {talkSummary(fromName, ownName, talk.lines.length)}
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
