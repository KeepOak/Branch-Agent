// The room line (DESIGN-SPEC §4.2.4 "Room line"): centred, 12 px `--ink-3`, "Messages from <A> and <B>", a 14 px
// character before each name. The names are the Trunks that wrote here: the room's own Trunk when it replied, and
// each Trunk whose messages the engine forwarded in. It closes a room of Trunks; where people or outside agents
// write, their own names already say who is talking, so the line is left out (as the preview's group chat does).
import { Face } from "../face/Face";
import { PRIORITY } from "../face/cap";
import type { Block } from "../thread/model";
import { otherSender, type ThreadRoom } from "./thread-room";
import "./rooms.css";

export function roomWriters(history: readonly Block[], room: ThreadRoom, ownName: string): string[] {
  const names: string[] = [];
  for (const b of history) {
    if (b.kind === "user" && otherSender(b, room)) return [];
    if (b.kind !== "text") continue;
    const sender = b.meta?.sender;
    const name = sender?.kind === "trunk" ? room.trunkName(sender.agentId) : ownName;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function RoomLine({ history, room, ownName }: { history: readonly Block[]; room: ThreadRoom; ownName: string }) {
  const names = roomWriters(history, room, ownName);
  if (!room.isRoom || names.length < 2) return null;
  return (
    <div className="rm-line" data-testid="room-line">
      Messages from
      {names.map((name, i) => (
        <span key={name} className="rm-line-n">
          {i > 0 ? (i === names.length - 1 ? "and " : ", ") : null}
          <Face size={14} label={name} priority={PRIORITY.row} />
          {name}
        </span>
      ))}
    </div>
  );
}
