// A room's picture (DESIGN-SPEC §4.1.1 Avatar, §4.2.1 Character): two member characters stacked, each at 70%;
// the second ringed in the bar's colour. Trunks first (the room's own Trunk, then the others), then people and
// outside agents as their initials. One member shows alone at full size.
import { Face } from "../face/Face";
import { PRIORITY } from "../face/cap";
import type { Members } from "./members";
import { RoomAvatar } from "./RoomMessage";
import { trunkAppearance } from "../face/appearance";
import "./rooms.css";

export type RoomPick = { kind: "trunk"; name: string; avatar?: string } | { kind: "person"; id: string; name: string };

export function roomPicks(ownTrunk: string, members: Members, trunkName: (agentId: string) => string): RoomPick[] {
  const trunks = [ownTrunk, ...members.trunks.map(trunkName)].filter((n, i, all) => n && all.indexOf(n) === i);
  const others = [...members.people, ...members.agents];
  return [...trunks.map((name): RoomPick => ({ kind: "trunk", name })), ...others.map((m): RoomPick => ({ kind: "person", id: m.id, name: m.name }))].slice(0, 2);
}

function One({ pick, size, priority }: { pick: RoomPick; size: number; priority: number }) {
  if (pick.kind === "person") return <RoomAvatar id={pick.id} name={pick.name} size={size} />;
  const still = trunkAppearance(pick.avatar, pick.name)?.still;
  return still ? <RoomAvatar id={pick.name} name={pick.name} size={size} src={still} /> : <Face size={size} label={pick.name} priority={priority} />;
}

export function RoomFaces({ picks, size }: { picks: RoomPick[]; size: number }) {
  if (picks.length < 2) return picks[0] ? <One pick={picks[0]} size={size} priority={PRIORITY.open} /> : null;
  const inner = Math.round(size * 0.7);
  return (
    <span className="rm-stack" style={{ width: size, height: size }} role="img" aria-label={picks.map((p) => p.name).join(" and ")}>
      <span className="rm-stack-a">
        <One pick={picks[0]} size={inner} priority={PRIORITY.open} />
      </span>
      <span className="rm-stack-b">
        <One pick={picks[1]} size={inner} priority={PRIORITY.row} />
      </span>
    </span>
  );
}
